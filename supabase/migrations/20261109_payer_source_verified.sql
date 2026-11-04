-- ═══════════════════════════════════════════════════════════════════════════
-- Payer source + verification (PO request 2026-11-04: payer starter file + Claim.MD payer list imports)
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run. No "Sync structure" needed.
--
--   • payers.source             where the payer came from, e.g. 'Payer Directory Starter', 'Claim.MD'
--   • payers.source_links       the web pages the details were taken from
--   • payers.verified_at / _by  when / by whom the payer was confirmed on an official source (null = not verified →
--                               Payer Directory shows the ⚠ needs-verification flag)
--   • payers.verification_note  why it isn't verified yet, e.g. 'No – contact details missing'
--   Added to the home company's payers table and every company's copy. Existing rows keep null (nothing changes).
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_prefix text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'payers')) is null then continue; end if;
    execute format('alter table rcm.%I add column if not exists source text', v_prefix || 'payers');
    execute format('alter table rcm.%I add column if not exists source_links text', v_prefix || 'payers');
    execute format('alter table rcm.%I add column if not exists verified_at timestamptz', v_prefix || 'payers');
    execute format('alter table rcm.%I add column if not exists verified_by text', v_prefix || 'payers');
    execute format('alter table rcm.%I add column if not exists verification_note text', v_prefix || 'payers');
  end loop;
end $$;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
