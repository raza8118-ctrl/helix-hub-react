-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 7.3 — Client Query Log with aging (Workbench → 💬 Client Queries)
-- Run once in Supabase → SQL Editor, AFTER 20261021n_error_library.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
-- PHI (same rules as the Smart Worklist, PO decision 2026-10-20 — no BAA):
--   • Minimum fields only: no patient name / DOB / member ID / MRN columns.
--   • question / answer / event notes are checked by the app for patient
--     details before saving.
--   • claim_number is optional and wiped (cleared = true) 90 days after the
--     query is closed or cancelled. Rows and history are kept.
--   • contact_name = the client's staff member we asked (not a patient).
--   • status:   open, waiting, answered, closed, cancelled
--   • category: documentation, authorization, demographics, coding,
--               billing_hold, credentialing, payment, other
--   • event kind: asked, edited, chased, answered, closed, cancelled,
--                 reopened, escalated, assigned, note
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.client_queries (
  id              bigint generated always as identity primary key,
  client_id       bigint      not null,           -- rcm.clients.id
  team            text,                           -- users.team
  category        text        not null default 'other',
  priority        text        not null default 'normal' check (priority in ('normal', 'urgent')),
  payer_id        bigint,                         -- rcm.payers.id (optional)
  claim_number    text,                           -- optional; wiped when cleared
  question        text        not null,
  asked_via       text        not null default 'email' check (asked_via in ('email', 'portal', 'call', 'meeting')),
  asked_on        date        not null default current_date,
  expected_on     date,
  contact_name    text,                           -- client staff member, not a patient
  owner_emp_id    text        not null,           -- users.emp_id (who follows up)
  status          text        not null default 'open'
                  check (status in ('open', 'waiting', 'answered', 'closed', 'cancelled')),
  escalated       boolean     not null default false,
  answer          text,
  answered_at     timestamptz,
  closed_at       timestamptz,
  chase_count     int         not null default 0,
  last_chased_at  timestamptz,
  cleared         boolean     not null default false,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz not null default now()
);
create index if not exists client_queries_client_idx on rcm.client_queries (client_id, status);
create index if not exists client_queries_owner_idx on rcm.client_queries (owner_emp_id, status);

create table if not exists rcm.client_query_events (
  id          bigint generated always as identity primary key,
  query_id    bigint      not null,               -- rcm.client_queries.id
  kind        text        not null,
  note        text,
  emp_id      text,
  created_at  timestamptz not null default now()
);
create index if not exists client_query_events_query_idx on rcm.client_query_events (query_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.client_queries, rcm.client_query_events to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
