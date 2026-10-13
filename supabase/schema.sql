-- Baseline: one table of JSON documents per user, mirroring the app's collections
-- (apple, strava, journal, planWeeks, plans, plan, settings, meta).
create table if not exists public.docs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  coll       text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, coll, id)
);
create index if not exists docs_user_coll on public.docs (user_id, coll);

alter table public.docs enable row level security;
drop policy if exists "own docs" on public.docs;
create policy "own docs" on public.docs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- live updates in the app when the server writes (Strava webhook, iPhone ingest)
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
