'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Pencil, Play, Plus, Webhook } from 'lucide-react';
import { describeCron } from '@/lib/cron';
import { parseMentions } from '@/lib/mentions';
import { getSupabase } from '@/lib/supabase';
import type { Mission, Routine, Workspace } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { fmtRun, RoutineDrawer } from './RoutineDrawer';
import { MissionBadge } from './StatusBadge';

const REFRESH_MS = 30_000;

function relative(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  const v = abs < 3600 ? `${Math.max(1, Math.round(abs / 60))} min` : abs < 86400 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} j`;
  return s >= 0 ? `dans ${v}` : `il y a ${v}`;
}

interface Props {
  workspaces: Workspace[];
  missions: Mission[];
  onOpenMission: (mission: Mission) => void;
}

/** Routines : missions lancées toutes seules, selon un planning ou par un webhook. */
export function RoutinesPage({ workspaces, missions, onOpenMission }: Props) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const load = useCallback(() => {
    getSupabase()
      .from('routines')
      .select('*')
      .order('created_at')
      .then(({ data, error: err }) => {
        if (err) {
          if (/does not exist|Could not find the table|schema cache/i.test(err.message)) setNeedsMigration(true);
          else setError(err.message);
          setRoutines([]);
        } else setRoutines(data as Routine[]);
      });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const runs = useMemo(() => {
    const by = new Map<string, Mission[]>();
    for (const m of missions) if (m.routine_id) by.set(m.routine_id, [...(by.get(m.routine_id) ?? []), m]);
    return by;
  }, [missions]);

  async function toggle(r: Routine, enabled: boolean) {
    setRoutines((all) => all?.map((x) => (x.id === r.id ? { ...x, enabled } : x)) ?? null);
    // À la réactivation, le worker recalcule la prochaine échéance (next_run_at remis à zéro).
    const { error: err } = await getSupabase()
      .from('routines')
      .update({ enabled, ...(enabled && r.trigger === 'schedule' ? { next_run_at: null } : {}) })
      .eq('id', r.id);
    if (err) {
      setError(err.message);
      load();
    }
  }

  async function runNow(r: Routine) {
    const { data, error: err } = await getSupabase()
      .from('missions')
      .insert({ prompt: r.prompt, workspace: r.workspace, use_worktree: r.use_worktree, routine_id: r.id })
      .select()
      .single();
    if (err) setError(err.message);
    else onOpenMission(data as Mission);
  }

  const save = (saved: Routine) => setRoutines((all) => [...(all ?? []).filter((r) => r.id !== saved.id), saved].sort((a, b) => a.created_at.localeCompare(b.created_at)));

  return (
    <div className="rt">
      <div className="cx-section-head">
        <p className="muted rt-intro">Des missions qui se lancent toutes seules : chaque matin, chaque lundi, ou quand un service externe appelle MarIA.</p>
        <button className="primary-btn small cx-add" onClick={() => setEditing('new')} disabled={workspaces.length === 0}>
          <Plus size={14} strokeWidth={2.4} /> Nouvelle routine
        </button>
      </div>

      {needsMigration && (
        <p className="cx-warn">
          Les routines ont besoin de la migration <code>supabase/migrations/0013_routines.sql</code> : exécute-la dans le SQL Editor de Supabase, puis{' '}
          <code>notify pgrst, &apos;reload schema&apos;;</code> et redémarre le worker.
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      {routines && routines.length === 0 && !needsMigration && (
        <div className="notifs-empty">
          <CalendarClock size={28} strokeWidth={1.5} />
          <p>Aucune routine. Exemple : « Du lundi au vendredi à 09:00, @tester lance la suite de tests et résume les échecs ».</p>
        </div>
      )}

      <div className="rt-grid">
        {routines?.map((r) => {
          const list = runs.get(r.id) ?? [];
          const last = list[0];
          const { agents } = parseMentions(r.prompt, (workspaces.find((w) => w.name === r.workspace)?.agents ?? []).map((a) => a.name));
          const Icon = r.trigger === 'schedule' ? CalendarClock : Webhook;
          return (
            <article key={r.id} className={`float-card rt-card ${r.enabled ? '' : 'off'}`}>
              <div className="cx-card-head">
                <span className="rt-icon">
                  <Icon size={19} strokeWidth={1.9} />
                </span>
                <label className="cx-switch" title={r.enabled ? 'Mettre en pause' : 'Activer'}>
                  <input type="checkbox" checked={r.enabled} onChange={(e) => void toggle(r, e.target.checked)} aria-label={`Activer ${r.name}`} />
                  <span aria-hidden="true" />
                </label>
              </div>
              <div>
                <h3>{r.name}</h3>
                <p className="rt-trigger">
                  {r.trigger === 'schedule' ? `${describeCron(r.cron ?? '')} · ${r.timezone}` : 'Webhook (appel HTTP avec jeton)'}
                </p>
              </div>
              <p className="muted small rt-prompt">{r.prompt}</p>
              <div className="rt-meta">
                {agents.length > 0 && (
                  <span className="rt-agents">
                    {agents.slice(0, 4).map((a) => (
                      <AgentAvatar key={a} name={a} size={22} />
                    ))}
                  </span>
                )}
                <span className="cx-tag">{r.workspace}</span>
                {r.use_worktree && <span className="cx-tag">branche isolée</span>}
              </div>
              <div className="rt-when small">
                {r.trigger === 'schedule' && r.enabled && (
                  <span>
                    Prochaine : {r.next_run_at ? `${fmtRun(new Date(r.next_run_at), r.timezone)} (${relative(r.next_run_at)})` : 'calculée par le worker'}
                  </span>
                )}
                {!r.enabled && <span className="muted">En pause</span>}
                {r.last_run_at && <span className="muted">Dernière : {relative(r.last_run_at)}</span>}
              </div>
              {list.length > 0 && (
                <div className="rt-runs">
                  {list.slice(0, 3).map((m) => (
                    <button key={m.id} className="drawer-run" onClick={() => onOpenMission(m)}>
                      <MissionBadge status={m.status} small />
                      <span className="muted small">{new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      {m.cost_usd != null && <span className="muted small">${m.cost_usd.toFixed(2)}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="rt-actions">
                <button className="ghost-btn" onClick={() => void runNow(r)} disabled={!!last && (last.status === 'queued' || last.status === 'running') && r.skip_if_running}>
                  <Play size={14} strokeWidth={2.2} /> Lancer maintenant
                </button>
                <button className="ghost-btn" onClick={() => setEditing(r)} aria-label="Modifier">
                  <Pencil size={14} strokeWidth={2} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {editing && (
        <RoutineDrawer
          routine={editing === 'new' ? null : editing}
          workspaces={workspaces}
          onClose={() => setEditing(null)}
          onSaved={save}
          onDeleted={(id) => {
            setRoutines((all) => all?.filter((r) => r.id !== id) ?? null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
