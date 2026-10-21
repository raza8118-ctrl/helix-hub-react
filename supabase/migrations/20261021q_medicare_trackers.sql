-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 7.5 — Medicare trackers (Workbench → 🏛️ Medicare Trackers):
-- ADR tracker, overpayments / credit balances, RTP / suspense monitor.
-- Run once in Supabase → SQL Editor, AFTER 20261021p_handover_escalations.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
-- PHI (same rules as the Smart Worklist, PO decision 2026-10-20 — no BAA):
--   • Minimum fields only: no patient name / DOB / MBI / MRN / address columns.
--     RTP uploads drop patient columns in the browser before anything is saved.
--   • claim_number (claim # / DCN) is wiped (cleared = true) 90 days after the
--     item is closed / resolved. Rows, amounts and history are kept.
--   • Notes live in medicare_events and are checked for patient details.
--   • Statuses (app-defined):
--       ADR:  received, requested, records_in, submitted, approved, partial,
--             denied, appealed, closed
--       Overpayment: identified, validated, disputed, requested, refunded, closed
--       RTP work_status: new, working, released, cancelled, no_action
--   • medicare_events.tracker: adr, overpayment, rtp
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.medicare_adrs (
  id             bigint generated always as identity primary key,
  client_id      bigint,
  payer_id       bigint,                          -- the MAC (rcm.payers.id)
  claim_number   text,                            -- optional; wiped when cleared
  amount         numeric,                         -- $ at risk
  adr_date       date,                            -- ADR letter date
  due_date       date,                            -- response due (letter + 45 days by default)
  requested_on   date,                            -- records requested from the client
  received_on    date,                            -- records received from the client
  submitted_on   date,
  submit_method  text,                            -- esmd, portal, fax, mail
  decision       text,                            -- approved, partial, denied
  decision_on    date,
  status         text        not null default 'received',
  owner_emp_id   text,
  closed_at      timestamptz,
  cleared        boolean     not null default false,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_by     text,
  updated_at     timestamptz not null default now()
);

create table if not exists rcm.medicare_overpayments (
  id               bigint generated always as identity primary key,
  kind             text        not null default 'overpayment',   -- overpayment, credit_balance, refund_request
  source           text,                          -- payer_letter, era_offset, internal, credit_report
  client_id        bigint,
  payer_id         bigint,
  claim_number     text,                          -- optional; wiped when cleared
  amount           numeric,
  reason           text,                          -- duplicate, msp, wrong_payer, rate, other
  identified_on    date,
  due_date         date,                          -- refund due (identified + 60 days by default)
  refund_method    text,                          -- check, offset, recoupment
  refunded_on      date,
  refunded_amount  numeric,
  status           text        not null default 'identified',
  owner_emp_id     text,
  closed_at        timestamptz,
  cleared          boolean     not null default false,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_by       text,
  updated_at       timestamptz not null default now()
);

create table if not exists rcm.medicare_rtp_uploads (
  id             bigint generated always as identity primary key,
  client_id      bigint,
  file_rows      int         not null default 0,
  added          int         not null default 0,
  updated        int         not null default 0,
  cleared_count  int         not null default 0,
  uploaded_by    text,
  uploaded_at    timestamptz not null default now()
);

create table if not exists rcm.medicare_rtp_items (
  id                 bigint generated always as identity primary key,
  client_id          bigint,
  claim_number       text,                        -- claim # / DCN; wiped when cleared
  location           text,                        -- FISS status / location, e.g. T B9997, S B6001
  reason_code        text,                        -- FISS reason code
  amount             numeric,
  in_status_since    date,
  first_seen_upload  bigint,                      -- rcm.medicare_rtp_uploads.id
  last_seen_upload   bigint,
  in_fiss            boolean     not null default true,   -- false = no longer on the latest upload
  work_status        text        not null default 'new',
  owner_emp_id       text,
  resolved_at        timestamptz,
  cleared            boolean     not null default false,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_by         text,
  updated_at         timestamptz not null default now()
);
create index if not exists medicare_rtp_items_client_idx on rcm.medicare_rtp_items (client_id, in_fiss);

create table if not exists rcm.medicare_events (
  id          bigint generated always as identity primary key,
  tracker     text        not null,               -- adr, overpayment, rtp
  item_id     bigint      not null,
  kind        text        not null,               -- added, edited, status, assigned, note, uploaded, cleared_fiss
  note        text,
  emp_id      text,
  created_at  timestamptz not null default now()
);
create index if not exists medicare_events_item_idx on rcm.medicare_events (tracker, item_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.medicare_adrs, rcm.medicare_overpayments, rcm.medicare_rtp_uploads,
  rcm.medicare_rtp_items, rcm.medicare_events to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
