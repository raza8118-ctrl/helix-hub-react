-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 1.1 — Payer Directory tables (all hang off rcm.payers from step 0.5)
-- Run once in Supabase → SQL Editor, AFTER 20261018c_clients_payers.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the same tables.
--
-- Conventions
--   • payer_id → rcm.payers.id; plan_id → rcm.payer_plans.id (null = whole payer);
--     client_id → rcm.clients.id (null = base value; set = that client's override, step 1.5).
--     Linked by id + index rather than foreign keys, because company copies made by
--     "Sync structure" don't carry foreign keys — the app enforces the links.
--   • Rows are never deleted: active = false hides them.
--   • verified_at / verified_by feed the "last verified" flags in step 1.6.
--   • No patient data (PHI) belongs in any of these tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- Plans / lines of business under a payer (e.g. BCBSTX → "Blue Advantage HMO")
create table if not exists rcm.payer_plans (
  id                bigint generated always as identity primary key,
  payer_id          bigint      not null,
  plan_name         text        not null,
  line_of_business  text,                     -- Medicare Advantage, Medicaid MCO, Commercial PPO…
  state             text,                     -- e.g. TX
  is_delegated      boolean     not null default false,
  delegated_group   text,                     -- IPA / medical group that manages auth & claims
  bluecard_role     text check (bluecard_role in ('home', 'host')),
  notes             text,
  active            boolean     not null default true,
  verified_at       timestamptz,
  verified_by       text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_by        text,
  updated_at        timestamptz not null default now()
);
create index if not exists payer_plans_payer_idx on rcm.payer_plans (payer_id);

-- Electronic payer IDs, per clearinghouse or direct
create table if not exists rcm.payer_ids (
  id                   bigint generated always as identity primary key,
  payer_id             bigint      not null,
  plan_id              bigint,
  clearinghouse        text,                  -- Waystar, Availity…; null = direct to payer
  electronic_payer_id  text        not null,
  transaction_type     text,                  -- Claims (837), ERA (835), Eligibility (270), Claim status (276)
  enrollment_required  boolean     not null default false,
  notes                text,
  active               boolean     not null default true,
  verified_at          timestamptz,
  verified_by          text,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_by           text,
  updated_at           timestamptz not null default now()
);
create index if not exists payer_ids_payer_idx on rcm.payer_ids (payer_id);

-- Phone / fax / email / mailing address per department
create table if not exists rcm.payer_contacts (
  id               bigint generated always as identity primary key,
  payer_id         bigint      not null,
  plan_id          bigint,
  department       text        not null,      -- claims, auth, appeals, provider_relations, eligibility, other
  phone            text,
  phone_ext        text,
  fax              text,
  email            text,
  portal_url       text,
  mailing_address  text,
  attention_line   text,                      -- "Attn: Appeals Dept"
  hours            text,
  notes            text,
  active           boolean     not null default true,
  verified_at      timestamptz,
  verified_by      text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_by       text,
  updated_at       timestamptz not null default now()
);
create index if not exists payer_contacts_payer_idx on rcm.payer_contacts (payer_id);

-- Filing / appeal limits: TFL, CCTFL (corrected claim), AFL (appeal), recon levels
create table if not exists rcm.payer_limits (
  id             bigint generated always as identity primary key,
  payer_id       bigint      not null,
  plan_id        bigint,
  client_id      bigint,                      -- null = base limit; set = client contract override (1.5)
  limit_type     text        not null,        -- TFL, CCTFL, AFL, RECON
  level          int,                         -- appeal / recon level (1, 2, …) where it applies
  days           int,
  measured_from  text,                        -- DOS, discharge date, denial / EOB date, paid date
  notes          text,
  active         boolean     not null default true,
  verified_at    timestamptz,
  verified_by    text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_by     text,
  updated_at     timestamptz not null default now()
);
create index if not exists payer_limits_payer_idx on rcm.payer_limits (payer_id);

-- Payer forms (files themselves go to a private Storage bucket in step 1.4)
create table if not exists rcm.payer_forms (
  id            bigint generated always as identity primary key,
  payer_id      bigint      not null,
  plan_id       bigint,
  form_type     text        not null,         -- appeal, recon, auth, corrected_claim, other
  title         text        not null,
  file_path     text,                         -- path inside the Storage bucket
  file_name     text,
  version_date  date,
  notes         text,
  active        boolean     not null default true,
  verified_at   timestamptz,
  verified_by   text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now()
);
create index if not exists payer_forms_payer_idx on rcm.payer_forms (payer_id);

-- Free-text tips per payer (e.g. "Recon must go by fax only")
create table if not exists rcm.payer_notes (
  id           bigint generated always as identity primary key,
  payer_id     bigint      not null,
  plan_id      bigint,
  category     text,                          -- general, claims, auth, appeals, portal…
  note         text        not null,
  pinned       boolean     not null default false,
  active       boolean     not null default true,
  verified_at  timestamptz,
  verified_by  text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create index if not exists payer_notes_payer_idx on rcm.payer_notes (payer_id);

-- Read / add / edit only — no delete grant (rows are made inactive instead)
grant select, insert, update on
  rcm.payer_plans, rcm.payer_ids, rcm.payer_contacts,
  rcm.payer_limits, rcm.payer_forms, rcm.payer_notes
to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
