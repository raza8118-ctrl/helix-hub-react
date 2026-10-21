-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 10.3 — 📌 Notice Board (lasting notices by category, audience, dates,
-- must-read tracking). The existing Announcements (feedback / feedback_acks)
-- and Team Feed are NOT changed.
-- Run once in Supabase → SQL Editor, AFTER 20261021w_worklist_denial_code.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
-- No patient data: the app checks title / text for patient details.
--   • category: process, client, payer, system, hr, wins
--   • teams: users.team values; empty = everyone
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.board_notices (
  id               bigint generated always as identity primary key,
  title            text        not null,
  body             text,
  category         text        not null default 'process',
  teams            text[]      not null default '{}',
  client_id        bigint,                        -- optional client the notice is about
  pinned           boolean     not null default false,
  must_read        boolean     not null default false,
  show_from        date        not null default current_date,
  show_until       date,                          -- null = until archived
  sop_id           bigint,                        -- optional links
  payer_id         bigint,
  payer_update_id  bigint,
  active           boolean     not null default true,   -- false = archived
  posted_by        text,
  created_at       timestamptz not null default now(),
  updated_by       text,
  updated_at       timestamptz not null default now()
);
create index if not exists board_notices_active_idx on rcm.board_notices (active, show_from);

create table if not exists rcm.board_reads (
  notice_id  bigint      not null,              -- rcm.board_notices.id
  emp_id     text        not null,
  read_at    timestamptz not null default now(),
  primary key (notice_id, emp_id)
);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.board_notices, rcm.board_reads to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
