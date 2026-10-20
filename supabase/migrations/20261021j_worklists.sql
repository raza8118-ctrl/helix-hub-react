-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 6.4 — Smart Worklist: prioritised claim worklists assigned to people
-- Run once in Supabase → SQL Editor, AFTER 20261021i_ref_codes.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
-- PHI (product-owner decision 2026-10-20: no BAA with Supabase):
--   • MINIMUM fields only. There are NO columns for patient name, date of birth,
--     member ID, MRN or address — uploads drop those columns in the browser.
--   • claim_number and the dates of service are still sensitive: the app wipes
--     them (cleared = true) when a worklist is closed, or 90 days after upload.
--     Rows are kept (nothing is deleted) so status, counts and $ totals remain.
--   • No free-text notes are stored on claims.
--   • Ids rather than foreign keys (company copies don't carry foreign keys).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.worklists (
  id             bigint generated always as identity primary key,
  name           text        not null,
  client_id      bigint,                           -- rcm.clients.id
  team           text,                             -- users.team the worklist is for (supervisors manage their own)
  count_task     text,                             -- Daily Report task worked claims count towards
  weights        jsonb       not null default '{"deadline":1,"dollars":1,"payer":1}'::jsonb,
  starred_payers bigint[]    not null default '{}', -- rcm.payers.id
  status         text        not null default 'open' check (status in ('open', 'closed')),
  row_count      int,
  dropped_columns int,
  uploaded_by    text,
  uploaded_at    timestamptz not null default now(),
  closed_at      timestamptz,
  cleared_at     timestamptz,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_by     text,
  updated_at     timestamptz not null default now()
);

create table if not exists rcm.worklist_items (
  id              bigint generated always as identity primary key,
  worklist_id     bigint      not null,           -- rcm.worklists.id
  claim_number    text,                           -- wiped when cleared
  payer_id        bigint,                         -- rcm.payers.id (matched)
  payer_name      text,                           -- as in the file
  client_id       bigint,
  dos_from        date,                           -- wiped when cleared
  dos_to          date,                           -- wiped when cleared
  billed          numeric,
  balance         numeric,
  aging_days      int,
  denial_date     date,
  last_billed     date,
  deadline        date,
  deadline_type   text,                           -- TFL / AFL / …
  priority_score  numeric,
  band            text,                           -- high / medium / low
  reason          text,                           -- "TFL in 6 days · $4,200" (no claim details)
  assigned_to     text,                           -- users.emp_id
  status          text        not null default 'new',
  follow_up       date,
  worked_at       timestamptz,
  worked_by       text,                           -- users.emp_id
  cleared         boolean     not null default false,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz not null default now()
);
create index if not exists worklist_items_list_idx on rcm.worklist_items (worklist_id);
create index if not exists worklist_items_assigned_idx on rcm.worklist_items (assigned_to);
create index if not exists worklist_items_worked_idx on rcm.worklist_items (worked_by, worked_at);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.worklists, rcm.worklist_items to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
