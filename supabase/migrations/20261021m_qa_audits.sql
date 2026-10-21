-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 7.1 — QA Audit module (Workbench → ✅ QA Audits)
-- Run once in Supabase → SQL Editor, AFTER 20261021l_client_portals.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
-- The existing quality tracking (daily_logs.quality, Quality Monitor) is NOT
-- changed — audit scores live only in these tables.
--
-- PHI (same rules as the Smart Worklist, PO decision 2026-10-20 — no BAA):
--   • Minimum fields only: no patient name / DOB / member ID / MRN columns.
--   • claim_number is wiped (cleared = true) 90 days after the audit is closed
--     (acknowledged or dispute resolved). Rows, scores and errors are kept.
--   • Comments are short coaching notes; the app blocks text that looks like
--     patient details.
--   • results (jsonb) = a copy of each checkpoint at audit time:
--     [{ checkpoint_id, text, weight, critical, result: pass|fail|na,
--        category_id, sop_id, comment, overturned }]
--   • status: queued (picked by sampling) → draft → sent → acknowledged |
--     disputed → resolved.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.qa_categories (
  id           bigint generated always as identity primary key,
  name         text        not null,
  description  text,
  sort_order   int         not null default 0,
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);

create table if not exists rcm.qa_scorecards (
  id           bigint generated always as identity primary key,
  name         text        not null,
  team         text,                              -- users.team it is meant for (null = any)
  description  text,
  pass_mark    numeric     not null default 95,
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);

create table if not exists rcm.qa_checkpoints (
  id            bigint generated always as identity primary key,
  scorecard_id  bigint      not null,             -- rcm.qa_scorecards.id
  text          text        not null,
  weight        numeric     not null default 1,
  critical      boolean     not null default false,   -- failing it makes the audit score 0
  category_id   bigint,                           -- default error category when it fails
  sop_id        bigint,                           -- rcm.sops.id: the SOP that explains it
  sort_order    int         not null default 0,
  active        boolean     not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now()
);
create index if not exists qa_checkpoints_card_idx on rcm.qa_checkpoints (scorecard_id);

create table if not exists rcm.qa_audits (
  id                bigint generated always as identity primary key,
  scorecard_id      bigint,
  agent_emp_id      text        not null,         -- whose work was audited
  auditor_emp_id    text,
  client_id         bigint,
  payer_id          bigint,
  claim_number      text,                         -- wiped when cleared
  work_date         date,
  worklist_item_id  bigint,                       -- rcm.worklist_items.id when picked by sampling
  source            text        not null default 'manual' check (source in ('manual', 'sample')),
  results           jsonb       not null default '[]'::jsonb,
  score             numeric,
  passed            boolean,
  fatal             boolean     not null default false,
  comment           text,
  status            text        not null default 'draft'
                    check (status in ('queued', 'draft', 'sent', 'acknowledged', 'disputed', 'resolved')),
  sent_at           timestamptz,
  ack_at            timestamptz,
  dispute_reason    text,
  disputed_at       timestamptz,
  resolution        text        check (resolution in ('upheld', 'overturned')),
  resolution_note   text,
  resolved_by       text,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  cleared           boolean     not null default false,
  active            boolean     not null default true,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_by        text,
  updated_at        timestamptz not null default now()
);
create index if not exists qa_audits_agent_idx on rcm.qa_audits (agent_emp_id, status);
create index if not exists qa_audits_status_idx on rcm.qa_audits (status, work_date);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.qa_categories, rcm.qa_scorecards, rcm.qa_checkpoints, rcm.qa_audits to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
