-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 4.1 — Denial library: CARC / RARC / group codes + plain-English reasons
-- Run once in Supabase → SQL Editor, AFTER 20261021c_sop_quizzes.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
--   • code_type: 'carc' (e.g. 16), 'rarc' (e.g. N290, MA130), 'group' (CO/PR/OA/PI/CR),
--     'other' (e.g. FISS reason codes, payer-specific codes). code is stored in UPPER case.
--   • official_text comes from the X12 lists the company imports (Excel/CSV);
--     plain_reason is our own wording and is never overwritten by an import.
--   • source: 'starter' (built-in starter set, to be verified), 'import', 'manual'.
--   • stopped_on: the date a code stopped being used (retired), if any.
--   • No patient data (PHI) belongs here — pasted ERA lines are searched in the
--     browser only and never saved. Nothing is deleted (active = false hides a code).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.denial_codes (
  id             bigint generated always as identity primary key,
  code_type      text        not null check (code_type in ('carc', 'rarc', 'group', 'other')),
  code           text        not null,
  official_text  text,
  plain_reason   text,
  category       text,
  notes          text,
  stopped_on     date,
  source         text        not null default 'manual',
  verified_at    timestamptz,
  verified_by    text,                           -- users.emp_id
  active         boolean     not null default true,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_by     text,
  updated_at     timestamptz not null default now()
);
create unique index if not exists denial_codes_type_code_key on rcm.denial_codes (code_type, upper(code));

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.denial_codes to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
