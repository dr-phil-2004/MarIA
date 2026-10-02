'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { Mission, Workspace } from '@/lib/types';

const ONLINE_WINDOW_MS = 90_000;

export function isOnline(ws: Workspace): boolean {
  return Date.now() - new Date(ws.last_seen_at).getTime() < ONLINE_WINDOW_MS;
}

interface Props {
  workspaces: Workspace[];
  onCreated: (mission: Mission) => void;
}

export function MissionForm({ workspaces, onCreated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Préférence mémorisée dans le navigateur (simple confort, sans conséquence si le stockage est indisponible).
  useEffect(() => {
    try {
      setUseWorktree(localStorage.getItem('maria.useWorktree') === '1');
    } catch {
      /* stockage indisponible */
    }
  }, []);

  function toggleWorktree(value: boolean) {
    setUseWorktree(value);
    try {
      localStorage.setItem('maria.useWorktree', value ? '1' : '0');
    } catch {
      /* stockage indisponible */
    }
  }

  useEffect(() => {
    if (!workspace && workspaces.length > 0) setWorkspace(workspaces[0].name);
  }, [workspaces, workspace]);

  const current = workspaces.find((w) => w.name === workspace);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !workspace) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await getSupabase()
      .from('missions')
      .insert({ prompt: prompt.trim(), workspace, use_worktree: useWorktree })
      .select()
      .single();
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setPrompt('');
    onCreated(data as Mission);
  }

  return (
    <form className="card mission-form" onSubmit={submit}>
      <textarea
        placeholder="Décris la mission… ex. « Ajoute des tests au module de paiement »"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
        rows={4}
      />
      <div className="row">
        <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} disabled={workspaces.length === 0}>
          {workspaces.length === 0 && <option value="">Aucun dossier (lance le worker)</option>}
          {workspaces.map((w) => (
            <option key={w.name} value={w.name}>
              {isOnline(w) ? '●' : '○'} {w.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !prompt.trim() || !workspace}>
          {busy ? '…' : 'Lancer'}
        </button>
      </div>
      <label className="check small">
        <input type="checkbox" checked={useWorktree} onChange={(e) => toggleWorktree(e.target.checked)} />
        Branche isolée (worktree) : la mission travaille sur sa propre branche, en parallèle des autres
      </label>
      {current && !isOnline(current) && (
        <p className="muted small">Worker hors ligne : la mission attendra son redémarrage.</p>
      )}
      {error && <p className="error small">{error}</p>}
    </form>
  );
}
