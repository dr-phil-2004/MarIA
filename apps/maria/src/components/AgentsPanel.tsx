'use client';

import type { AgentsSummary, AgentStatus } from '@/lib/agents';
import type { RufloAgent } from '@/lib/types';

const STATUS: Record<AgentStatus, { label: string; className: string }> = {
  running: { label: 'En cours', className: 'running' },
  done: { label: 'Terminé', className: 'completed' },
  error: { label: 'Erreur', className: 'failed' },
  interrupted: { label: 'Interrompu', className: 'cancelled' },
};

interface Props {
  summary: AgentsSummary;
  rufloAgents: RufloAgent[] | null;
  finished: boolean;
}

/** Qui travaille sur la mission : agent principal, sous-agents Claude Code, et registre Ruflo. */
export function AgentsPanel({ summary, rufloAgents, finished }: Props) {
  const { mainActions, subAgents, rufloCalls } = summary;
  const running = subAgents.filter((a) => a.status === 'running').length;
  const rufloEntries = Object.entries(rufloCalls);

  return (
    <div className="agents card">
      <h2>
        Agents
        {running > 0 && <span className="muted small"> · {running} en cours</span>}
      </h2>
      <ul className="agent-list">
        <li className="agent-item">
          <div className="agent-head">
            <span className="agent">MarIA</span>
            <span className="muted small">agent principal · {mainActions} action(s)</span>
          </div>
        </li>
        {subAgents.map((a) => (
          <li key={a.id} className={`agent-item ${a.parentId ? 'nested' : ''}`}>
            <div className="agent-head">
              <span className="agent">{a.type}</span>
              <span className={`badge ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
            </div>
            {a.description && <div className="small">{a.description}</div>}
            <div className="muted small agent-last">
              {a.actions} action(s){a.lastAction ? ` · ${a.lastAction}` : ''}
            </div>
          </li>
        ))}
      </ul>
      {subAgents.length === 0 && (
        <p className="muted small">{finished ? 'Aucun sous-agent lancé.' : 'Pas encore de sous-agent.'}</p>
      )}

      {(rufloEntries.length > 0 || rufloAgents) && (
        <div className="ruflo">
          <h3 className="small">Ruflo</h3>
          {rufloEntries.length > 0 && (
            <p className="muted small">
              Appels : {rufloEntries.map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')}
            </p>
          )}
          {rufloAgents === null && rufloEntries.length > 0 && (
            <p className="muted small">{finished ? 'Lecture du registre…' : 'Registre lu en fin de mission.'}</p>
          )}
          {rufloAgents && rufloAgents.length === 0 && <p className="muted small">Registre vide.</p>}
          {rufloAgents && rufloAgents.length > 0 && (
            <ul className="agent-list">
              {rufloAgents.map((a) => (
                <li key={a.agentId} className="agent-item">
                  <div className="agent-head">
                    <span className="agent">{a.agentType}</span>
                    <span className="muted small">{a.status}</span>
                  </div>
                  <div className="muted small">{a.agentId}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
