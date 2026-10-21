-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 7.2 — Error library “Mistakes & fixes” (QA Audits → 📖 tab)
-- Run once in Supabase → SQL Editor, AFTER 20261021m_qa_audits.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
-- General know-how only: an entry is never tied to a specific claim and has no
-- patient columns. The app checks every text field for patient details.
-- A failed QA checkpoint can point to an entry via mistake_id inside
-- qa_audits.results (jsonb) — no column change needed there.
--   • severity: low, medium, high
--   • status:   suggested (anyone can suggest) → published (editors)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.qa_mistakes (
  id              bigint generated always as identity primary key,
  title           text        not null,
  team            text,                           -- users.team (null = any)
  category_id     bigint,                         -- rcm.qa_categories.id
  severity        text        not null default 'medium' check (severity in ('low', 'medium', 'high')),
  what_happened   text,
  why_it_matters  text,
  fix_steps       text,                           -- one step per line
  prevent_steps   text,                           -- one step per line
  sop_id          bigint,                         -- rcm.sops.id
  client_id       bigint,                         -- rcm.clients.id
  payer_id        bigint,                         -- rcm.payers.id
  denial_code     text,                           -- e.g. CO-29 (Denial library)
  status          text        not null default 'published' check (status in ('suggested', 'published')),
  suggested_by    text,
  verified_at     timestamptz,
  verified_by     text,
  active          boolean     not null default true,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz not null default now()
);
create index if not exists qa_mistakes_category_idx on rcm.qa_mistakes (category_id);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.qa_mistakes to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
