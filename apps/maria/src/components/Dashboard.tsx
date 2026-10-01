'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { Mission, Workspace } from '@/lib/types';
import { MissionForm } from './MissionForm';
import { MissionList } from './MissionList';
import { MissionView } from './MissionView';

const WORKSPACE_REFRESH_MS = 30_000;

export function Dashboard({ email }: { email: string }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, (payload) => {
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

  const selected = missions.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <strong>MarIA</strong>
        <span className="muted">{email}</span>
        <button className="link" onClick={() => getSupabase().auth.signOut()}>
          Déconnexion
        </button>
      </header>
      {error && <p className="error banner">{error}</p>}
      <aside className="sidebar">
        <MissionForm workspaces={workspaces} onCreated={(m) => setSelectedId(m.id)} />
        <MissionList missions={missions} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>
      <section className="main">
        {selected ? (
          <MissionView key={selected.id} mission={selected} onFollowUp={(m) => setSelectedId(m.id)} />
        ) : (
          <p className="muted empty">Lance une mission ou sélectionne-en une dans la liste.</p>
        )}
      </section>
    </div>
  );
}
