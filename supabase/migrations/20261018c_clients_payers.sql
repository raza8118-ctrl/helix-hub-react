-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 0.5 — master tables: clients (agencies we bill for) and payers
-- (base payer list with aliases), plus per-user access grants.
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run.
-- Afterwards, click "↻ Sync structure" in the Owner Console so every added
-- company gets the new tables and column.
-- Rows are never deleted — they are marked inactive instead.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.clients (
  id          bigint generated always as identity primary key,
  name        text        not null,
  code        text,
  project     text,                       -- links to processes.project (e.g. 'PMB')
  notes       text,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create unique index if not exists clients_name_lower_key on rcm.clients (lower(name));

create table if not exists rcm.payers (
  id          bigint generated always as identity primary key,
  name        text        not null,
  aliases     text[]      not null default '{}',   -- e.g. {BCBSTX, Blue Cross Texas}
  payer_type  text,                                 -- Medicare, Medicaid, MCO, Commercial…
  notes       text,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create unique index if not exists payers_name_lower_key on rcm.payers (lower(name));

-- Extra access an admin grants to a user beyond their role, e.g. {"masters_edit": true}
alter table rcm.users add column if not exists access_grants jsonb not null default '{}'::jsonb;

grant select, insert, update on rcm.clients to anon, authenticated;
grant select, insert, update on rcm.payers  to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
