-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 3.6 — Quizzes per SOP with scores
-- Run once in Supabase → SQL Editor, AFTER 20261021b_learning_paths.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new tables and column.
--
--   • One quiz per SOP (sop_id). questions = [{ "id", "text", "type": "choice" | "truefalse",
--     "options": [...], "correct": <index>, "why": "..." }].
--   • Every attempt is kept with a copy of the questions it was scored against,
--     so editing the quiz later never changes an earlier result or pass.
--   • learning_path_items.needs_quiz: an SOP item in a learning path is done only
--     when the person acknowledged the SOP AND passed its quiz.
--   • Scoring happens in the app (no server yet). No patient data (PHI) here.
--     Nothing is deleted — a quiz is switched off with active = false.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.sop_quizzes (
  id          bigint generated always as identity primary key,
  sop_id      bigint      not null,               -- rcm.sops.id
  pass_pct    int         not null default 80,
  questions   jsonb       not null default '[]'::jsonb,
  active      boolean     not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create unique index if not exists sop_quizzes_sop_key on rcm.sop_quizzes (sop_id);

create table if not exists rcm.sop_quiz_attempts (
  id           bigint generated always as identity primary key,
  quiz_id      bigint      not null,              -- rcm.sop_quizzes.id
  sop_id       bigint      not null,              -- rcm.sops.id
  emp_id       text        not null,              -- users.emp_id
  correct      int         not null,
  total        int         not null,
  score_pct    int         not null,
  passed       boolean     not null,
  answers      jsonb       not null default '[]'::jsonb,   -- chosen option index per question
  questions    jsonb       not null default '[]'::jsonb,   -- the questions as they were when taken
  taken_at     timestamptz not null default now()
);
create index if not exists sop_quiz_attempts_sop_idx on rcm.sop_quiz_attempts (sop_id);
create index if not exists sop_quiz_attempts_emp_idx on rcm.sop_quiz_attempts (emp_id);

alter table rcm.learning_path_items add column if not exists needs_quiz boolean not null default false;

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.sop_quizzes, rcm.sop_quiz_attempts to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
