-- ═══════════════════════════════════════════════════════════════════════════
-- Roadmap 6.1 — Claim Note Generator: each client's claim note format
-- Run once in Supabase → SQL Editor, AFTER 20261021g_payer_form_fields.sql.
-- Additive only; safe to re-run. Afterwards click "↻ Sync structure" in the
-- Owner Console so every added company gets the new table.
--
--   • body is the note text with {PLACEHOLDERS} such as {DATE} {INITIALS}
--     {PAYER} {STATUS}; "[ … ]" parts are dropped when their placeholder is empty.
--   • action: one of the generator's actions (call, portal, submit, corrected,
--     appeal, records, escalate, adjust) or 'any'. client_id null = all clients.
--   • date_style: 'mdy2' (10/20/26), 'mdy4' (10/20/2026) or 'iso' (2026-10-20);
--     name_style: 'initials' or 'full'; max_length: the EMR's note limit, if any.
--   • Formats hold placeholders only. Notes themselves are built in the browser
--     and never stored or logged. Nothing is deleted (active = false).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.note_formats (
  id           bigint generated always as identity primary key,
  name         text        not null,
  client_id    bigint,                            -- rcm.clients.id; null = all clients
  action       text        not null default 'any',
  body         text        not null,
  date_style   text        not null default 'mdy2',
  upper_case   boolean     not null default false,
  max_length   int,
  name_style   text        not null default 'initials',
  source       text        not null default 'manual',
  reviewed_at  timestamptz,
  reviewed_by  text,                              -- users.emp_id
  active       boolean     not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);

-- Read / add / edit only — no delete grant
grant select, insert, update on rcm.note_formats to anon, authenticated;
grant usage, select on all sequences in schema rcm to anon, authenticated;

notify pgrst, 'reload schema';
