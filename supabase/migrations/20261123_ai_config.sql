-- ═══════════════════════════════════════════════════════════════════════════
-- AI server function "ai" (PO request 2026-11-12), Stage 1. Migration 58.
-- Run once in Supabase → SQL Editor. Additive only; safe to re-run.
--
--   • helix_ai_config (one row, locked): which AI provider / model the "ai" Edge Function uses, Testing or Production mode,
--     and whether a BAA is signed. Keys are NOT here — they are Supabase secrets (GEMINI_API_KEY / ANTHROPIC_API_KEY).
--     Default: Gemini, gemini-3.8-flash, Testing. Gemini (AI Studio key) has no BAA → Production needs Claude + BAA.
--   • ai_config_public(): provider / model / mode for the app's banner (no secrets).
--   • owner_ai_config_get / owner_ai_config_save: Owner Console → Platform → AI (owner only, owner-logged).
--   • helix_ai_usage + feature, provider; ai_session_check / ai_log_usage_v2 for the "ai" function (service role only).
--     Usage = counts only, never the text.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.helix_ai_config (
  id             int         primary key default 1 check (id = 1),
  provider       text        not null default 'gemini' check (provider in ('gemini', 'claude')),
  model          text        not null default 'gemini-3.8-flash',
  mode           text        not null default 'testing' check (mode in ('testing', 'production')),
  baa_confirmed  boolean     not null default false,
  updated_by     text,
  updated_at     timestamptz not null default now(),
  constraint helix_ai_config_production check (mode = 'testing' or (provider = 'claude' and baa_confirmed))
);
insert into rcm.helix_ai_config (id) values (1) on conflict (id) do nothing;
alter table rcm.helix_ai_config enable row level security;
revoke all on rcm.helix_ai_config from anon, authenticated;

alter table rcm.helix_ai_usage add column if not exists feature text;
alter table rcm.helix_ai_usage add column if not exists provider text;
create index if not exists helix_ai_usage_feature on rcm.helix_ai_usage (feature, at);

-- The app: which provider / model / mode (for the Testing banner) — never a key
create or replace function rcm.ai_config_public()
returns jsonb
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select jsonb_build_object('provider', provider, 'model', model, 'mode', mode) from rcm.helix_ai_config where id = 1;
$$;
revoke all on function rcm.ai_config_public() from public;
grant execute on function rcm.ai_config_public() to anon, authenticated;

-- Owner Console → Platform → AI
create or replace function rcm.owner_ai_config_get(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  return (select to_jsonb(c) from rcm.helix_ai_config c where id = 1)
    || jsonb_build_object('usage', coalesce((
         select jsonb_agg(u order by u.calls desc) from (
           select coalesce(nullif(prefix, ''), '__home__') as company, coalesce(feature, '(before 2026-11-12)') as feature,
                  coalesce(provider, 'claude') as provider, count(*) as calls, count(*) filter (where status between 200 and 299) as ok,
                  coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens
           from rcm.helix_ai_usage where at > now() - interval '30 days' group by 1, 2, 3) u), '[]'::jsonb));
end;
$$;
revoke all on function rcm.owner_ai_config_get(text, text) from public;
grant execute on function rcm.owner_ai_config_get(text, text) to anon, authenticated;

create or replace function rcm.owner_ai_config_save(p_by_user text, p_by_password text, p_provider text, p_model text, p_mode text, p_baa boolean)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_old jsonb;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if p_provider not in ('gemini', 'claude') then return jsonb_build_object('ok', false, 'error', 'provider'); end if;
  if p_mode not in ('testing', 'production') then return jsonb_build_object('ok', false, 'error', 'mode'); end if;
  if coalesce(trim(p_model), '') !~ '^[a-z0-9][a-z0-9.\-]{2,60}$' then return jsonb_build_object('ok', false, 'error', 'model'); end if;
  if p_mode = 'production' and p_provider <> 'claude' then return jsonb_build_object('ok', false, 'error', 'gemini_production'); end if;
  if p_mode = 'production' and not coalesce(p_baa, false) then return jsonb_build_object('ok', false, 'error', 'baa'); end if;
  select to_jsonb(c) into v_old from rcm.helix_ai_config c where id = 1;
  update rcm.helix_ai_config set provider = p_provider, model = trim(p_model), mode = p_mode, baa_confirmed = coalesce(p_baa, false),
         updated_by = upper(trim(p_by_user)), updated_at = now() where id = 1;
  perform rcm._owner_log(upper(trim(p_by_user)), 'ai_config', 'PLATFORM', format('%s · %s · %s', p_provider, trim(p_model), p_mode),
    jsonb_build_object('before', v_old - 'updated_at', 'baa_confirmed', coalesce(p_baa, false)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function rcm.owner_ai_config_save(text, text, text, text, text, boolean) from public;
grant execute on function rcm.owner_ai_config_save(text, text, text, text, text, boolean) to anon, authenticated;

-- ── Used only by the "ai" Edge Function (service role) ──────────────────────
-- → { prefix, emp_id, as_owner, provider, model, mode } or { error: SESSION | AI_OFF }
create or replace function rcm.ai_session_check(p_token text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  s     rcm.helix_user_sessions;
  v_off boolean := false;
  c     rcm.helix_ai_config;
begin
  if p_token is null or not rcm.session_check(p_token) then return jsonb_build_object('error', 'SESSION'); end if;
  select * into s from rcm.helix_user_sessions where token = p_token;
  if s.prefix = '' then
    select (value->'ai') = 'false'::jsonb into v_off from rcm.rcm_store where key = 'home_features';
  else
    select (features->'ai') = 'false'::jsonb into v_off from rcm.companies where prefix = s.prefix;
  end if;
  if coalesce(v_off, false) then return jsonb_build_object('error', 'AI_OFF'); end if;
  select * into c from rcm.helix_ai_config where id = 1;
  return jsonb_build_object('prefix', s.prefix, 'emp_id', s.emp_id, 'as_owner', s.as_owner,
                            'provider', c.provider, 'model', c.model, 'mode', c.mode);
end;
$$;
revoke all on function rcm.ai_session_check(text) from public, anon, authenticated;
grant execute on function rcm.ai_session_check(text) to service_role;

create or replace function rcm.ai_log_usage_v2(p_prefix text, p_emp_id text, p_as_owner text, p_feature text, p_provider text,
                                               p_model text, p_status int, p_input int, p_output int)
returns void
language sql security definer
set search_path = rcm, pg_temp
as $$
  insert into rcm.helix_ai_usage (prefix, emp_id, as_owner, feature, provider, model, status, input_tokens, output_tokens)
  values (coalesce(p_prefix, ''), p_emp_id, p_as_owner, left(p_feature, 40), p_provider, left(p_model, 60), p_status, p_input, p_output);
$$;
revoke all on function rcm.ai_log_usage_v2(text, text, text, text, text, text, int, int, int) from public, anon, authenticated;
grant execute on function rcm.ai_log_usage_v2(text, text, text, text, text, text, int, int, int) to service_role;

notify pgrst, 'reload schema';
