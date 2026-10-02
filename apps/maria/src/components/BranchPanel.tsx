'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { Mission } from '@/lib/types';

const STATE_LABEL = {
  active: { label: 'À valider', className: 'running' },
  merged: { label: 'Fusionnée', className: 'completed' },
  discarded: { label: 'Abandonnée', className: 'cancelled' },
} as const;

/** Branche git isolée de la mission : fusion dans le dossier principal ou abandon. */
export function BranchPanel({ mission, finished }: { mission: Mission; finished: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (!mission.branch || !mission.worktree_state) return null;

  const state = STATE_LABEL[mission.worktree_state];
  const pending = mission.worktree_action;
  const canAct = finished && mission.worktree_state === 'active' && !pending;

  async function request(action: 'merge' | 'discard') {
    const question =
      action === 'merge'
        ? `Fusionner ${mission.branch} dans la branche actuelle du dossier « ${mission.workspace} » ?`
        : `Abandonner ${mission.branch} ? Le worktree et la branche seront supprimés, et les modifications perdues.`;
    if (!window.confirm(question)) return;
    setError(null);
    const { error: err } = await getSupabase().rpc('request_worktree_action', { p_id: mission.id, p_action: action });
    if (err) setError(err.message);
  }

  return (
    <div className="branch card">
      <h2>Branche</h2>
      <div className="agent-head">
        <code>{mission.branch}</code>
        <span className={`badge ${state.className}`}>{state.label}</span>
      </div>
      {mission.worktree_path && mission.worktree_state === 'active' && (
        <p className="muted small">Worktree : {mission.worktree_path}</p>
      )}
      {!finished && mission.worktree_state === 'active' && (
        <p className="muted small">Les modifications seront commitées sur la branche à la fin de la mission.</p>
      )}
      {pending && <p className="muted small">{pending === 'merge' ? 'Fusion en cours…' : 'Suppression en cours…'}</p>}
      {mission.worktree_error && <p className="error small">{mission.worktree_error}</p>}
      {error && <p className="error small">{error}</p>}
      {canAct && (
        <div className="row">
          <button onClick={() => request('merge')}>Fusionner</button>
          <button className="danger" onClick={() => request('discard')}>
            Abandonner
          </button>
        </div>
      )}
    </div>
  );
}
