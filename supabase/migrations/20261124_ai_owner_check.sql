-- ═══════════════════════════════════════════════════════════════════════════
-- AI server function "ai" (PO request 2026-11-12), Stage 2. Migration 59.
-- Run once in Supabase → SQL Editor. Additive only (one function); safe to re-run.
--
--   ai_owner_check(user, owner token) → true when it is a signed-in Helix Hub owner. Used only by the "ai" Edge Function
--   (service role) so Owner Console → Platform → AI can list the models the provider offers with the server-side key.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function rcm.ai_owner_check(p_by_user text, p_by_password text)
returns boolean
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select rcm._is_owner(p_by_user, p_by_password);
$$;
revoke all on function rcm.ai_owner_check(text, text) from public, anon, authenticated;
grant execute on function rcm.ai_owner_check(text, text) to service_role;

notify pgrst, 'reload schema';
