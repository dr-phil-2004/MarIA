'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Moon, Search, Sun } from 'lucide-react';
import { mentionName, type AgentInfo } from '@/lib/mentions';
import type { Mission } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { SECTIONS, type Page } from './Sidebar';

const MAX_RESULTS = 8;

type Result =
  | { type: 'page'; key: string; label: string; page: Page }
  | { type: 'agent'; key: string; label: string; detail: string; page: Page }
  | { type: 'mission'; key: string; label: string; detail: string; mission: Mission };

interface Props {
  title: string;
  /** Bouton d'action propre à la page (ex. « Nouvelle mission »), affiché à gauche de la recherche. */
  action?: ReactNode;
  agents: AgentInfo[];
  missions: Mission[];
  dark: boolean;
  onToggleDark: () => void;
  onNavigate: (page: Page) => void;
  onOpenMission: (mission: Mission) => void;
}

/** En-tête des pages : titre à gauche ; recherche (pages, agents, missions) et bascule clair/sombre à droite. */
export function TopBar({ title, action, agents, missions, dark, onToggleDark, onNavigate, onOpenMission }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K : focus sur la recherche.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pages: Result[] = SECTIONS.flatMap((s) => s.items)
      .filter((i) => i.label.toLowerCase().includes(q))
      .map((i) => ({ type: 'page', key: `p-${i.kind}`, label: i.label, page: { kind: i.kind } as Page }));
    const agentHits: Result[] = agents
      .filter((a) => mentionName(a.name).toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      .map((a) => ({ type: 'agent', key: `a-${a.name}`, label: a.name, detail: a.description, page: { kind: 'agent', name: a.name } }));
    const missionHits: Result[] = missions
      .filter((m) => m.prompt.toLowerCase().includes(q))
      .map((m) => ({ type: 'mission', key: `m-${m.id}`, label: m.prompt.split('\n')[0], detail: m.workspace, mission: m }));
    return [...pages, ...agentHits, ...missionHits].slice(0, MAX_RESULTS);
  }, [query, agents, missions]);

  function choose(result: Result) {
    if (result.type === 'mission') onOpenMission(result.mission);
    else onNavigate(result.page);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQuery('');
      setOpen(false);
      e.currentTarget.blur();
    } else if (results.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <header className="topbar">
      <h1>{title}</h1>
      <div className="topbar-actions">
        {action}
        <div className="tb-search-wrap">
          <label className="tb-search">
            <Search size={16} strokeWidth={1.75} />
            <input
              ref={inputRef}
              placeholder="Search..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKeyDown}
              aria-label="Rechercher une page, un agent ou une mission"
            />
            <span className="tb-kbd">⌘</span>
            <span className="tb-kbd">K</span>
          </label>
          {open && query.trim() && (
            <ul className="tb-results" role="listbox">
              {results.length === 0 && <li className="tb-none">Aucun résultat</li>}
              {results.map((r, i) => (
                <li
                  key={r.key}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'active' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {r.type === 'agent' ? <AgentAvatar name={r.label} size={22} /> : <span className={`tb-kind ${r.type}`}>{r.type === 'page' ? 'Page' : 'Mission'}</span>}
                  <span className="tb-label">{r.label}</span>
                  {r.type !== 'page' && r.detail && <span className="tb-detail">{r.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          className="tb-toggle"
          onClick={onToggleDark}
          title={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
          aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
        >
          {dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </button>
      </div>
    </header>
  );
}
