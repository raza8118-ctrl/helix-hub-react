-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 6.3 — Code lookup: revenue codes, HIPPS and ICD-10-CM reference lists
-- Run once in Supabase → SQL Editor, AFTER 20261021h_note_formats.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
--   • code_set: 'revenue' (UB-04 revenue codes), 'hipps', 'icd10' (ICD-10-CM).
--     CARC / RARC stay in rcm.denial_codes (Denial library, step 4.1).
--   • code is stored in UPPER case without dots for ICD-10 (I509 shown as I50.9).
--   • source: 'starter' (our own wording, to be verified), 'import', 'manual'.
--   • list_year: the yearly list a code came from (e.g. 2027 for ICD-10-CM FY2027).
--   • retired = true when a newer yearly list no longer contains the code.
--   • Reference data only — no patient data (PHI). Nothing is deleted.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.ref_codes (
  id           bigint generated always as identity primary key,
  code_set     text        not null check (code_set in ('revenue', 'hipps', 'icd10')),
  code         text        not null,
  description  text,
  notes        text,
  source       text        not null default 'manual',
  list_year    int,
  retired      boolean     not null default false,
  verified_at  timestamptz,
  verified_by  text,                              -- users.emp_id
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create unique index if not exists ref_codes_set_code_key on rcm.ref_codes (code_set, code);
create index if not exists ref_codes_code_idx on rcm.ref_codes (code);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.ref_codes to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
