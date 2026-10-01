-- MarIA : missions pilotées par l'interface, exécutées par le worker local.
-- Le front (clé anon + utilisateur connecté) crée et lit les missions ;
-- seul le worker (clé service_role) les passe en cours d'exécution et écrit les événements.

-- Dossiers de travail déclarés par le worker (heartbeat via last_seen_at).
create table public.workspaces (
  name text primary key,
  last_seen_at timestamptz not null default now()
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (char_length(prompt) between 1 and 20000),
  workspace text not null references public.workspaces (name),
  parent_id uuid references public.missions (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'cancel_requested', 'completed', 'failed', 'cancelled')),
  session_id text,
  result text,
  error text,
  files_changed jsonb not null default '[]'::jsonb,
  cost_usd numeric,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index missions_status_created_idx on public.missions (status, created_at);

-- Flux brut de Claude Code (--output-format stream-json) + messages du worker (type 'maria').
create table public.mission_events (
  id bigint generated always as identity primary key,
  mission_id uuid not null references public.missions (id) on delete cascade,
  seq integer not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (mission_id, seq)
);

-- ---------------------------------------------------------------------------
-- Droits : le front ne peut créer une mission qu'avec prompt/workspace/parent_id,
-- et ne peut changer son statut que via cancel_mission().
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.missions enable row level security;
alter table public.mission_events enable row level security;

revoke all on public.workspaces, public.missions, public.mission_events from anon, authenticated;
grant all on public.workspaces, public.missions, public.mission_events to service_role;
grant select on public.workspaces, public.missions, public.mission_events to authenticated;
grant insert (prompt, workspace, parent_id) on public.missions to authenticated;

create policy "authenticated read workspaces" on public.workspaces
  for select to authenticated using (true);
create policy "authenticated read missions" on public.missions
  for select to authenticated using (true);
create policy "authenticated create missions" on public.missions
  for insert to authenticated with check (created_by = auth.uid());
create policy "authenticated read events" on public.mission_events
  for select to authenticated using (true);

create function public.cancel_mission(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.missions
  set status = case when status = 'queued' then 'cancelled' else 'cancel_requested' end,
      finished_at = case when status = 'queued' then now() else finished_at end
  where id = p_id
    and status in ('queued', 'running')
    and auth.uid() is not null;
$$;

revoke execute on function public.cancel_mission(uuid) from public, anon;
grant execute on function public.cancel_mission(uuid) to authenticated;

-- Réservation atomique de la prochaine mission pour les dossiers libres du worker.
create function public.claim_next_mission(p_workspaces text[])
returns setof public.missions
language sql
security definer
set search_path = public
as $$
  update public.missions
  set status = 'running', started_at = now()
  where id = (
    select id from public.missions
    where status = 'queued' and workspace = any (p_workspaces)
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke execute on function public.claim_next_mission(text[]) from public, anon, authenticated;
grant execute on function public.claim_next_mission(text[]) to service_role;

-- Temps réel pour le fil d'activité.
alter publication supabase_realtime add table public.missions, public.mission_events;
