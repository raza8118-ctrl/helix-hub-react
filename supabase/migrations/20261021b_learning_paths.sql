-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 3.5 — Learning paths by role, with completion tracking
-- Run once in Supabase → SQL Editor, AFTER 20261021_sop_versions.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables.
--
--   • A path (e.g. "New AR joiner – Week 1") has Day 1…N, each with items:
--     kind 'sop' (done when the person has acknowledged that SOP — read from
--     rcm.sop_reads), 'task' or 'link' (ticked by the person, or by a trainer
--     when needs_trainer = true). Step 3.6 adds quiz items.
--   • Assignments give a person a path with a start date; Day N is due on the
--     (N−1)th working day after it (weekends skipped, worked out in the app).
--   • learning_progress records each tick; an undone tick is set active = false.
--   • Ids rather than foreign keys (company copies don't carry foreign keys).
--   • No patient data (PHI) belongs here. Nothing is deleted.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.learning_paths (
  id           bigint generated always as identity primary key,
  name         text        not null,
  description  text,
  team         text,                              -- users.team (AR, Auth, …); null = any team
  days         int         not null default 5,
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);

create table if not exists rcm.learning_path_items (
  id             bigint generated always as identity primary key,
  path_id        bigint      not null,            -- rcm.learning_paths.id
  day_no         int         not null default 1,
  sort_order     int         not null default 0,
  kind           text        not null check (kind in ('sop', 'task', 'link')),
  sop_id         bigint,                          -- rcm.sops.id (kind = 'sop')
  title          text,                            -- task/link text; optional label for an SOP
  url            text,                            -- kind = 'link'
  needs_trainer  boolean     not null default false,
  active         boolean     not null default true,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_by     text,
  updated_at     timestamptz not null default now()
);
create index if not exists learning_path_items_path_idx on rcm.learning_path_items (path_id);

create table if not exists rcm.learning_assignments (
  id            bigint generated always as identity primary key,
  path_id       bigint      not null,             -- rcm.learning_paths.id
  emp_id        text        not null,             -- users.emp_id
  start_date    date        not null default current_date,
  assigned_by   text,
  assigned_at   timestamptz not null default now(),
  completed_at  timestamptz,
  active        boolean     not null default true
);
create index if not exists learning_assignments_emp_idx  on rcm.learning_assignments (emp_id);
create index if not exists learning_assignments_path_idx on rcm.learning_assignments (path_id);

create table if not exists rcm.learning_progress (
  id             bigint generated always as identity primary key,
  assignment_id  bigint      not null,            -- rcm.learning_assignments.id
  item_id        bigint      not null,            -- rcm.learning_path_items.id
  done_at        timestamptz not null default now(),
  done_by        text,                            -- users.emp_id: the person, or the trainer who confirmed
  active         boolean     not null default true
);
create index if not exists learning_progress_assignment_idx on rcm.learning_progress (assignment_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on
  rcm.learning_paths, rcm.learning_path_items, rcm.learning_assignments, rcm.learning_progress
to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
