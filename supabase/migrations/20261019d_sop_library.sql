-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 3.1 — SOP Library structure: Category → Software → Task → SOP
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run.
-- Afterwards click "↻ Sync structure" in the Owner Console so every added
-- company gets the same tables.
--
-- Conventions (same as the Payer Directory)
--   • category_id → rcm.sop_categories.id; software_id → rcm.sop_software.id;
--     task_id → rcm.sop_tasks.id. Linked by id + index rather than foreign keys,
--     because company copies made by "Sync structure" don't carry foreign keys.
--   • Rows are never deleted: active = false hides them.
--   • sops holds only the SOP "shell" in 3.1; the page content (3.2/3.3),
--     client-specific versions and acknowledgements (3.4) add columns later.
--   • No patient data (PHI) belongs in any of these tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- Top-level groups: EMR, Clearinghouse, Payments/ERA, Payer portals, Medicare DDE…
create table if not exists rcm.sop_categories (
  id          bigint generated always as identity primary key,
  name        text        not null,
  sort_order  int         not null default 0,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- Software / systems used by the teams (e.g. Waystar, Availity, HCHB)
create table if not exists rcm.sop_software (
  id           bigint generated always as identity primary key,
  category_id  bigint      not null,
  name         text        not null,
  vendor       text,
  portal_url   text,                         -- login page; never credentials
  notes        text,
  sort_order   int         not null default 0,
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create index if not exists sop_software_category_idx on rcm.sop_software (category_id);

-- Tasks done in a software (e.g. "Check claim status", "Submit a recon")
create table if not exists rcm.sop_tasks (
  id           bigint generated always as identity primary key,
  software_id  bigint      not null,
  name         text        not null,
  sort_order   int         not null default 0,
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create index if not exists sop_tasks_software_idx on rcm.sop_tasks (software_id);

-- SOPs under a task
create table if not exists rcm.sops (
  id          bigint generated always as identity primary key,
  task_id     bigint      not null,
  title       text        not null,
  summary     text,
  owner       text,                          -- users.emp_id of the person who keeps it current
  status      text        not null default 'draft' check (status in ('draft', 'published')),
  sort_order  int         not null default 0,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create index if not exists sops_task_idx on rcm.sops (task_id);

-- Starting categories (only added when missing, so re-running is safe)
insert into rcm.sop_categories (name, sort_order, created_by)
select v.name, v.sort_order, 'system'
from (values
  ('EMR', 1), ('Clearinghouse', 2), ('Payments/ERA', 3),
  ('Payer portals', 4), ('Medicare DDE', 5), ('Other', 6)
) as v(name, sort_order)
where not exists (select 1 from rcm.sop_categories c where lower(c.name) = lower(v.name));

-- Read / add / edit only — no delete grant (rows are made inactive instead)
grant select, insert, update on
  rcm.sop_categories, rcm.sop_software, rcm.sop_tasks, rcm.sops
to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
