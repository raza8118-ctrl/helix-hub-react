-- ═══════════════════════════════════════════════════════════════════════════
-- Coding Assistant (PO request 2026-11-11), Stage 2. Migration 56.
-- Run once in Supabase → SQL Editor. Additive only (one new table per company); safe to re-run.
--
--   coding_results — the coder's FINAL code list, saved for QA stats: who, when, the codes in order with their check
--   result, what the AI suggested, and counts (kept / changed / added / removed). CODES ONLY — never the pasted text,
--   never patient, client or claim details. One table per company (home, every company, master), the usual company rules.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.coding_results (
  id           bigint generated always as identity primary key,
  emp_id       text        not null,
  coder_name   text,
  codes        jsonb       not null default '[]'::jsonb,   -- [{ code, order, status, conflict, sequencing, source }] — final list, in order
  ai_codes     text[]      not null default '{}',          -- what the AI suggested (no dot)
  final_codes  text[]      not null default '{}',          -- the final list (no dot), in order
  ai_count     int         not null default 0,
  final_count  int         not null default 0,
  kept         int         not null default 0,             -- AI codes kept exactly
  changed      int         not null default 0,             -- AI codes the coder changed (e.g. more digits)
  added        int         not null default 0,             -- codes the coder typed in
  removed      int         not null default 0,             -- AI codes dropped
  problems     int         not null default 0,             -- final codes still not valid / needing digits / in conflict
  fiscal_year  int,
  created_at   timestamptz not null default now()
);
create index if not exists coding_results_emp on rcm.coding_results (emp_id, created_at desc);
create index if not exists coding_results_at on rcm.coding_results (created_at desc);

do $$
declare
  v_prefix text;
begin
  for v_prefix in select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'coding_results')) is null then
      perform rcm._clone_table('coding_results', v_prefix || 'coding_results');
    end if;
  end loop;
end;
$$;
grant usage, select on all sequences in schema rcm to anon, authenticated, service_role;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
