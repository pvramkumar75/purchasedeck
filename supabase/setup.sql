-- Run once in the Supabase SQL editor of the project the app uses.
-- The whole board is one JSON document; `version` lets saves detect each other.
create table if not exists public.app_store (
  id text primary key,
  doc jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Only the server (secret / service role key) may touch the board: it holds plant
-- passwords. Row level security with no policies blocks the public keys entirely.
alter table public.app_store enable row level security;
revoke all on public.app_store from anon, authenticated;
grant all on public.app_store to service_role;
