'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Dashboard } from '@/components/Dashboard';
import { LoginForm } from '@/components/LoginForm';
import { getSupabase } from '@/lib/supabase';

export default function Home() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (err) {
      setConfigError((err as Error).message);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (configError) return <main className="center"><p className="error">{configError}</p></main>;
  if (session === undefined) return <main className="center"><p className="muted">Chargement…</p></main>;
  if (!session) return <LoginForm />;
  return <Dashboard email={session.user.email ?? ''} />;
}
