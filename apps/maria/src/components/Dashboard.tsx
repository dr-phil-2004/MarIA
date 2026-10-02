'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Bot, Plug, Ticket, Users, type LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { mentionName, parseMentions, type AgentInfo } from '@/lib/mentions';
import { getSupabase, MARIA_SCHEMA } from '@/lib/supabase';
import type { Mission, Workspace } from '@/lib/types';
import { MemoryView } from './MemoryView';
import { MissionForm } from './MissionForm';
import { MissionList } from './MissionList';
import { MissionView } from './MissionView';
import { PermissionPrompt } from './PermissionPrompt';
import { NAV_LABEL, Sidebar, type Page } from './Sidebar';

const WORKSPACE_REFRESH_MS = 30_000;

/** Page courante <-> ancre d'URL (#/overview, #/agents/coder), pour garder la page au rechargement. */
function pageFromHash(hash: string): Page {
  const [, section, rest] = hash.replace(/^#\/?/, '/').split('/');
  if (section === 'agents' && rest) return { kind: 'agent', name: decodeURIComponent(rest) };
  if (section && section in NAV_LABEL) return { kind: section as Exclude<Page['kind'], 'agent'> };
  return { kind: 'overview' };
}

function hashFromPage(page: Page): string {
  return page.kind === 'agent' ? `#/agents/${encodeURIComponent(page.name)}` : `#/${page.kind}`;
}

const PLACEHOLDERS: Record<'teams' | 'tickets' | 'notifications' | 'connectors' | 'new-agent', { icon: ComponentType<LucideProps>; text: string }> = {
  teams: { icon: Users, text: 'Les équipes d’agents arrivent bientôt.' },
  tickets: { icon: Ticket, text: 'Les tickets arrivent bientôt.' },
  notifications: { icon: Bell, text: 'Les demandes d’autorisation et les questions des agents s’affichent en fenêtre dès qu’elles arrivent. L’historique des notifications arrive bientôt.' },
  connectors: { icon: Plug, text: 'La gestion des connecteurs arrive bientôt.' },
  'new-agent': {
    icon: Bot,
    text: 'La création d’agents depuis MarIA arrive bientôt. En attendant, un agent est un fichier Markdown dans .claude/agents/ du dossier : il apparaît ici au prochain passage du worker.',
  },
};

export function Dashboard({ email }: { email: string }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>({ kind: 'overview' });
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    const sync = () => setPage(pageFromHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const navigate = useCallback((next: Page) => {
    setPage(next);
    if (window.location.hash !== hashFromPage(next)) window.history.pushState(null, '', hashFromPage(next));
  }, []);

  useEffect(() => {
    const supabase = getSupabase();

    const upsert = (row: Mission) =>
      setMissions((prev) => {
        const rest = prev.filter((m) => m.id !== row.id);
        return [row, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at));
      });

    // Abonnement avant le chargement initial pour ne rien rater entre les deux.
    const channel = supabase
      .channel('missions')
      .on('postgres_changes', { event: '*', schema: MARIA_SCHEMA, table: 'missions' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as Partial<Mission>).id;
          setMissions((prev) => prev.filter((m) => m.id !== id));
        } else {
          upsert(payload.new as Mission);
        }
      })
      .subscribe();

    supabase
      .from('missions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else (data as Mission[]).forEach(upsert);
      });

    const loadWorkspaces = () =>
      supabase
        .from('workspaces')
        .select('*')
        .order('name')
        .then(({ data, error: err }) => {
          if (err) setError(err.message);
          else setWorkspaces(data as Workspace[]);
        });
    loadWorkspaces();
    const timer = setInterval(loadWorkspaces, WORKSPACE_REFRESH_MS);

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  // Agents de tous les dossiers, sans doublon.
  const agents = useMemo(() => {
    const byName = new Map<string, AgentInfo>();
    for (const w of workspaces) for (const a of w.agents ?? []) if (!byName.has(a.name)) byName.set(a.name, a);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [workspaces]);

  // Charge de chaque agent : nombre de missions chargées (les 50 dernières) qui le mentionnent.
  const agentLoad = useMemo(() => {
    const names = agents.map((a) => a.name);
    const load: Record<string, number> = {};
    for (const m of missions) for (const name of parseMentions(m.prompt, names).agents) load[name] = (load[name] ?? 0) + 1;
    return load;
  }, [agents, missions]);

  const selected = missions.find((m) => m.id === selectedId) ?? null;
  const openMission = (m: Mission) => {
    setSelectedId(m.id);
    navigate({ kind: 'overview' });
  };

  const title = page.kind === 'agent' ? page.name : NAV_LABEL[page.kind];

  return (
    <div className="app">
      <Sidebar
        page={page}
        onNavigate={navigate}
        agents={agents}
        agentLoad={agentLoad}
        dark={theme === 'dark'}
        onToggleDark={toggleTheme}
        email={email}
        notificationCount={pendingCount}
        onSignOut={() => getSupabase().auth.signOut()}
      />
      <PermissionPrompt missions={missions} onCountChange={setPendingCount} />
      <main className="main">
        <header className="page-head">
          <h1>{title}</h1>
        </header>
        {error && <p className="error banner">{error}</p>}

        {page.kind === 'overview' && (
          <div className="overview">
            <section className="overview-side">
              <MissionForm workspaces={workspaces} onCreated={openMission} />
              <MissionList missions={missions} selectedId={selectedId} onSelect={setSelectedId} />
            </section>
            <section className="overview-main">
              {selected ? (
                <MissionView key={selected.id} mission={selected} onFollowUp={openMission} />
              ) : (
                <p className="muted empty">Lance une mission ou sélectionne-en une dans la liste.</p>
              )}
            </section>
          </div>
        )}

        {page.kind === 'brains' && <MemoryView workspaces={workspaces} />}

        {page.kind === 'agent' && (
          <AgentPage key={page.name} agent={agents.find((a) => a.name === page.name) ?? null} name={page.name} workspaces={workspaces} onCreated={openMission} />
        )}

        {(page.kind === 'teams' || page.kind === 'tickets' || page.kind === 'notifications' || page.kind === 'connectors' || page.kind === 'new-agent') && (
          <Placeholder {...PLACEHOLDERS[page.kind]} />
        )}
      </main>
    </div>
  );
}

const THEME_KEY = 'maria.theme';

/** Thème clair/sombre : sombre par défaut, choix mémorisé dans le navigateur (appliqué avant l'affichage par layout.tsx). */
function useTheme(): ['dark' | 'light', () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* stockage indisponible : le choix vaut pour cette visite */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

function Placeholder({ icon: Icon, text }: { icon: ComponentType<LucideProps>; text: string }) {
  return (
    <div className="placeholder">
      <Icon size={28} strokeWidth={1.5} />
      <p>{text}</p>
    </div>
  );
}

function AgentPage({
  agent,
  name,
  workspaces,
  onCreated,
}: {
  agent: AgentInfo | null;
  name: string;
  workspaces: Workspace[];
  onCreated: (m: Mission) => void;
}) {
  const where = workspaces.filter((w) => w.agents?.some((a) => a.name === name)).map((w) => w.name);
  return (
    <div className="agent-page">
      <div className="card agent-card">
        <code className="agent-mention">@{mentionName(name)}</code>
        <p>{agent?.description || 'Pas de description.'}</p>
        {where.length > 0 && <p className="muted small">Disponible dans : {where.join(', ')}</p>}
      </div>
      <h2>Confier une mission à cet agent</h2>
      <MissionForm workspaces={workspaces} onCreated={onCreated} initialPrompt={`@${mentionName(name)} `} />
    </div>
  );
}
