'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { buildFeed, type FeedItem } from '@/lib/feed';
import { getSupabase, MARIA_SCHEMA } from '@/lib/supabase';
import { FINISHED_STATUSES, type Mission, type MissionEvent } from '@/lib/types';
import { STATUS_LABEL } from './MissionList';

interface Props {
  mission: Mission;
  onFollowUp: (mission: Mission) => void;
}

export function MissionView({ mission, onFollowUp }: Props) {
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getSupabase();
    const merge = (rows: MissionEvent[]) =>
      setEvents((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]));
        rows.forEach((r) => byId.set(r.id, r));
        return [...byId.values()].sort((a, b) => a.seq - b.seq);
      });

    const channel = supabase
      .channel(`events-${mission.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: MARIA_SCHEMA, table: 'mission_events', filter: `mission_id=eq.${mission.id}` },
        (payload) => merge([payload.new as MissionEvent]),
      )
      .subscribe();

    supabase
      .from('mission_events')
      .select('*')
      .eq('mission_id', mission.id)
      .order('seq')
      .limit(5000)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else merge(data as MissionEvent[]);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mission.id]);

  const feed = useMemo(() => buildFeed(events), [events]);
  const finished = FINISHED_STATUSES.includes(mission.status);

  useEffect(() => {
    if (!finished) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [feed.length, finished]);

  async function cancel() {
    const { error: err } = await getSupabase().rpc('cancel_mission', { p_id: mission.id });
    if (err) setError(err.message);
  }

  return (
    <div className="mission-view">
      <div className="mission-head">
        <div>
          <span className={`badge ${mission.status}`}>{STATUS_LABEL[mission.status]}</span>
          <span className="muted small"> {mission.workspace}{mission.cost_usd != null && ` · $${Number(mission.cost_usd).toFixed(4)}`}</span>
        </div>
        {(mission.status === 'queued' || mission.status === 'running') && (
          <button className="danger" onClick={cancel}>Annuler</button>
        )}
      </div>
      <p className="prompt">{mission.prompt}</p>
      {error && <p className="error small">{error}</p>}
      {mission.error && <p className="error">{mission.error}</p>}

      <div className="columns">
        <div className="feed card">
          <h2>Activité</h2>
          {feed.length === 0 && <p className="muted small">{mission.status === 'queued' ? 'En attente du worker…' : 'Aucun événement.'}</p>}
          <ol>
            {feed.map((item) => (
              <FeedRow key={item.key} item={item} />
            ))}
          </ol>
          <div ref={bottomRef} />
        </div>

        <div className="files card">
          <h2>Fichiers modifiés</h2>
          {!finished && <p className="muted small">Calculés à la fin de la mission.</p>}
          {finished && mission.files_changed.length === 0 && <p className="muted small">Aucun fichier modifié.</p>}
          <ul>
            {mission.files_changed.map((f) => (
              <li key={f}><code>{f}</code></li>
            ))}
          </ul>
        </div>
      </div>

      {finished && mission.session_id && <FollowUpForm parent={mission} onCreated={onFollowUp} />}
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case 'info':
      return <li className={`feed-info ${item.level}`}>{item.text}</li>;
    case 'text':
      return (
        <li className="feed-text">
          <span className="agent">{item.agent}</span>
          <div className="text">{item.text}</div>
        </li>
      );
    case 'tool':
      return (
        <li className="feed-tool">
          <span className="agent">{item.agent}</span>
          <span className="tool">{item.tool}</span>
          <code>{item.detail}</code>
        </li>
      );
    case 'tool_result':
      return <li className={`feed-result ${item.isError ? 'error' : ''}`}>↳ {item.text || '(vide)'}</li>;
    case 'done':
      return <li className={`feed-done ${item.isError ? 'error' : ''}`}>{item.text}</li>;
  }
}

function FollowUpForm({ parent, onCreated }: { parent: Mission; onCreated: (m: Mission) => void }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    const { data, error: err } = await getSupabase()
      .from('missions')
      .insert({ prompt: prompt.trim(), workspace: parent.workspace, parent_id: parent.id })
      .select()
      .single();
    setBusy(false);
    if (err) setError(err.message);
    else onCreated(data as Mission);
  }

  return (
    <form className="card follow-up" onSubmit={submit}>
      <input placeholder="Continuer cette mission (même conversation)…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button type="submit" disabled={busy || !prompt.trim()}>Continuer</button>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}
