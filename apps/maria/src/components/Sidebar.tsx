'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Bell, Brain, House, LogOut, Moon, PanelLeft, Plug, Plus, Search, Ticket, Users, type LucideProps } from 'lucide-react';
import { AgentAvatar, LoadBars } from './AgentAvatar';
import { mentionName, type AgentInfo } from '@/lib/mentions';

export type Page =
  | { kind: 'overview' }
  | { kind: 'teams' }
  | { kind: 'tickets' }
  | { kind: 'notifications' }
  | { kind: 'brains' }
  | { kind: 'connectors' }
  | { kind: 'new-agent' }
  | { kind: 'agent'; name: string };

type StaticKind = Exclude<Page['kind'], 'agent'>;

interface NavItem {
  kind: StaticKind;
  label: string;
  icon: ComponentType<LucideProps>;
}

export const NAV_LABEL: Record<StaticKind, string> = {
  overview: 'Overview',
  teams: 'Teams',
  tickets: 'Tickets',
  notifications: 'Notifications',
  brains: 'Brains',
  connectors: 'Connecteurs',
  'new-agent': 'Nouvel agent',
};

const SECTIONS: Array<{ title: string | null; items: NavItem[] }> = [
  { title: null, items: [{ kind: 'overview', label: NAV_LABEL.overview, icon: House }] },
  {
    title: 'Category',
    items: [
      { kind: 'teams', label: NAV_LABEL.teams, icon: Users },
      { kind: 'tickets', label: NAV_LABEL.tickets, icon: Ticket },
      { kind: 'notifications', label: NAV_LABEL.notifications, icon: Bell },
      { kind: 'brains', label: NAV_LABEL.brains, icon: Brain },
    ],
  },
  { title: 'Settings', items: [{ kind: 'connectors', label: NAV_LABEL.connectors, icon: Plug }] },
];

const COLLAPSED_KEY = 'maria.sidebarCollapsed';

function Logo() {
  return (
    <svg className="logo-mark" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M8 19V9.5l6 6 6-6V19" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  agents: AgentInfo[];
  /** Nombre de missions récentes où chaque agent a été mentionné (@agent). */
  agentLoad: Record<string, number>;
  dark: boolean;
  onToggleDark: () => void;
  email: string;
  notificationCount: number;
  onSignOut: () => void;
}

/** Barre latérale : navigation principale, agents disponibles et déconnexion. */
export function Sidebar({ page, onNavigate, agents, agentLoad, dark, onToggleDark, email, notificationCount, onSignOut }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Préférence mémorisée dans le navigateur ; sans stockage, la barre reste dépliée.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      /* stockage indisponible */
    }
  }, []);

  function toggle() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        /* stockage indisponible */
      }
      return !value;
    });
  }

  // ⌘K / Ctrl+K : focus sur la recherche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCollapsed(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => !q || i.label.toLowerCase().includes(q)) })).filter(
        (s) => s.items.length > 0,
      ),
    [q],
  );
  // Les agents les plus sollicités d'abord, puis par ordre alphabétique.
  const visibleAgents = useMemo(
    () =>
      agents
        .filter((a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
        .sort((a, b) => (agentLoad[b.name] ?? 0) - (agentLoad[a.name] ?? 0) || a.name.localeCompare(b.name)),
    [agents, agentLoad, q],
  );

  const isActive = (p: Page) => p.kind === page.kind && (p.kind !== 'agent' || (page.kind === 'agent' && page.name === p.name));
  const initial = (email[0] ?? '?').toUpperCase();

  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Navigation principale">
      <div className="sb-head">
        <button className="sb-brand" onClick={() => onNavigate({ kind: 'overview' })} title="MarIA">
          <Logo />
          <span className="sb-label sb-brand-name">MarIA</span>
        </button>
        <button className="sb-icon-btn" onClick={toggle} title={collapsed ? 'Déplier la barre' : 'Replier la barre'} aria-label={collapsed ? 'Déplier la barre' : 'Replier la barre'}>
          <PanelLeft size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className="sb-scroll">
        {collapsed ? (
          <button className="sb-item" onClick={toggle} title="Rechercher (⌘K)">
            <Search size={18} strokeWidth={1.75} />
          </button>
        ) : (
          <label className="sb-search">
            <Search size={16} strokeWidth={1.75} />
            <input ref={searchRef} placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
            <span className="sb-kbd">⌘</span>
            <span className="sb-kbd">K</span>
          </label>
        )}

        {sections.map((section) => (
          <div key={section.title ?? 'main'} className="sb-section">
            {section.title && <div className="sb-section-title sb-label">{section.title}</div>}
            {section.items.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                className={`sb-item ${isActive({ kind } as Page) ? 'active' : ''}`}
                onClick={() => onNavigate({ kind } as Page)}
                title={collapsed ? label : undefined}
                aria-current={isActive({ kind } as Page) ? 'page' : undefined}
              >
                <Icon size={18} strokeWidth={1.75} />
                <span className="sb-label">{label}</span>
                {kind === 'notifications' && notificationCount > 0 && <span className="sb-count">{notificationCount}</span>}
              </button>
            ))}
          </div>
        ))}

        {(visibleAgents.length > 0 || !q) && (
          <div className="sb-section sb-team">
            <div className="sb-team-head">
              <span className="sb-label">Agents</span>
              <button
                className={`sb-add ${page.kind === 'new-agent' ? 'active' : ''}`}
                onClick={() => onNavigate({ kind: 'new-agent' })}
                title="Ajouter un agent"
                aria-label="Ajouter un agent"
              >
                <Plus size={18} strokeWidth={1.75} />
              </button>
            </div>
            {agents.length === 0 && <p className="sb-empty sb-label">Aucun agent : lance le worker.</p>}
            {visibleAgents.map((agent) => {
              const target: Page = { kind: 'agent', name: agent.name };
              const count = agentLoad[agent.name] ?? 0;
              const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
              return (
                <button
                  key={agent.name}
                  className={`sb-member ${isActive(target) ? 'active' : ''}`}
                  onClick={() => onNavigate(target)}
                  title={agent.description ? `@${mentionName(agent.name)} — ${agent.description}` : `@${mentionName(agent.name)}`}
                >
                  <AgentAvatar name={agent.name} size={collapsed ? 30 : 26} />
                  <span className="sb-label sb-member-name">{agent.name}</span>
                  <span className="sb-label sb-member-load">
                    <LoadBars level={level} title={count === 0 ? 'Pas encore sollicité' : `Sollicité dans ${count} mission(s) récente(s)`} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="sb-foot">
        <button className="sb-theme" onClick={onToggleDark} role="switch" aria-checked={dark} title="Mode sombre">
          <Moon size={18} strokeWidth={1.75} />
          <span className="sb-label">Mode sombre</span>
          <span className={`sb-switch sb-label ${dark ? 'on' : ''}`} aria-hidden="true">
            <span />
          </span>
        </button>
        <div className="sb-user">
          <span className="sb-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="sb-label sb-user-text">
            <strong>{email.split('@')[0]}</strong>
            <span>{email}</span>
          </span>
        </div>
        <button className="sb-signout" onClick={onSignOut} title="Se déconnecter">
          <LogOut size={18} strokeWidth={1.75} />
          <span className="sb-label">Sign out</span>
        </button>
      </div>
    </nav>
  );
}
