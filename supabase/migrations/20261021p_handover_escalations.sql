-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 7.4 — Shift handover notes + escalation tracker
-- (Workbench → 🔁 Handover & Escalations)
-- Run once in Supabase → SQL Editor, AFTER 20261021o_client_queries.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
-- PHI (same rules as the Smart Worklist, PO decision 2026-10-20 — no BAA):
--   • Minimum fields only: no patient name / DOB / member ID / MRN columns.
--   • All typed text is checked by the app for patient details before saving.
--   • claim_number is optional and wiped (cleared = true) 90 days after the
--     handover item is done or the escalation is closed. Rows are kept.
--   • handovers.status:      draft, submitted
--   • handover_items.status: open, picked, done
--   • escalations.type:      payer, client, system, access, claim_stuck,
--                            process, other
--   • escalations.severity:  low, medium, high, critical
--   • escalations.status:    open, in_progress, resolved, closed
--   • escalation_events.kind: raised, edited, assigned, status, reopened, note
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.handovers (
  id             bigint generated always as identity primary key,
  emp_id         text        not null,            -- users.emp_id (who wrote it)
  team           text,                            -- users.team at the time
  shift_date     date        not null,
  done_note      text,
  watch_note     text,
  blockers_note  text,
  status         text        not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists handovers_emp_date_key on rcm.handovers (emp_id, shift_date);
create index if not exists handovers_team_date_idx on rcm.handovers (team, shift_date);

create table if not exists rcm.handover_items (
  id             bigint generated always as identity primary key,
  handover_id    bigint      not null,            -- rcm.handovers.id
  client_id      bigint,
  payer_id       bigint,
  claim_number   text,                            -- optional; wiped when cleared
  what           text        not null,
  priority       text        not null default 'normal' check (priority in ('normal', 'urgent')),
  status         text        not null default 'open' check (status in ('open', 'picked', 'done')),
  picked_by      text,
  picked_at      timestamptz,
  done_by        text,
  done_at        timestamptz,
  escalation_id  bigint,                          -- rcm.escalations.id when escalated
  sort_order     int         not null default 0,
  active         boolean     not null default true,
  cleared        boolean     not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists handover_items_handover_idx on rcm.handover_items (handover_id);

create table if not exists rcm.handover_reads (
  handover_id  bigint      not null,
  emp_id       text        not null,
  read_at      timestamptz not null default now(),
  primary key (handover_id, emp_id)
);

create table if not exists rcm.escalations (
  id                bigint generated always as identity primary key,
  title             text        not null,
  type              text        not null default 'other',
  severity          text        not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  client_id         bigint,
  payer_id          bigint,
  claim_number      text,                         -- optional; wiped when cleared
  details           text,
  raised_by         text        not null,
  assigned_to       text,
  status            text        not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  target_date       date,
  resolution        text,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  handover_item_id  bigint,                       -- rcm.handover_items.id when raised from a handover
  cleared           boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_by        text,
  updated_at        timestamptz not null default now()
);
create index if not exists escalations_status_idx on rcm.escalations (status);
create index if not exists escalations_assigned_idx on rcm.escalations (assigned_to, status);

create table if not exists rcm.escalation_events (
  id             bigint generated always as identity primary key,
  escalation_id  bigint      not null,
  kind           text        not null,
  note           text,
  emp_id         text,
  created_at     timestamptz not null default now()
);
create index if not exists escalation_events_esc_idx on rcm.escalation_events (escalation_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.handovers, rcm.handover_items, rcm.handover_reads, rcm.escalations, rcm.escalation_events to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
