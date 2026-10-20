-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 6.5 — Follow-up tickler: personal reminders per claim
-- Run once in Supabase → SQL Editor, AFTER 20261021j_worklists.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
-- PHI (same rules as the Smart Worklist, PO decision 2026-10-20 — no BAA):
--   • Minimum fields only: no patient name / DOB / member ID columns and no
--     free-text column. claim_number is optional.
--   • claim_number is wiped (cleared = true) 90 days after the reminder is done,
--     or 90 days after its due date if it was never done. Rows are kept.
--   • action is one of: call_back, check_status, expect_payment,
--     expect_records_request, appeal_decision, other.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.followups (
  id             bigint generated always as identity primary key,
  emp_id         text        not null,             -- users.emp_id (whose reminder)
  client_id      bigint,                           -- rcm.clients.id
  payer_id       bigint,                           -- rcm.payers.id
  claim_number   text,                             -- optional; wiped when cleared
  action         text        not null default 'other',
  due_date       date        not null,
  status         text        not null default 'open' check (status in ('open', 'done')),
  snoozed_count  int         not null default 0,
  done_at        timestamptz,
  cleared        boolean     not null default false,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_by     text,
  updated_at     timestamptz not null default now()
);
create index if not exists followups_emp_idx on rcm.followups (emp_id, status, due_date);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.followups to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
