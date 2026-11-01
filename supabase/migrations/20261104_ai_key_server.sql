-- ═══════════════════════════════════════════════════════════════════════════
-- Security stage 4 — AI key on the server (PO approved 2026-11-01)
-- Run once in Supabase → SQL Editor. Additive; safe to re-run. No "Sync structure" needed.
--
--   • Each company's Anthropic key moves into a locked table (helix_ai_keys). The browser never receives it again:
--     the app sends AI requests to the Supabase Edge Function "helix-ai", which checks the session, adds the key and
--     forwards the request to Anthropic (supabase/functions/helix-ai/index.ts).
--   • The existing key in rcm_store 'anthropic_key' (home + every company) is copied over, then that value is emptied
--     (the setting row stays). PO said yes ("Go", 2026-11-01).
--   • Settings can only ask "is a key saved, ending in …?" and save / clear it (admins, managers, the Settings grant,
--     or the owner).
--   • helix_ai_usage logs who used AI, when, which model and token counts — never the question or the answer.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rcm.helix_ai_keys (
  prefix      text        primary key,        -- '' = home company
  key         text        not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create table if not exists rcm.helix_ai_usage (
  id             bigint      generated always as identity primary key,
  prefix         text        not null,
  emp_id         text,
  as_owner       text,
  model          text,
  status         int,
  input_tokens   int,
  output_tokens  int,
  at             timestamptz not null default now()
);
create index if not exists helix_ai_usage_at on rcm.helix_ai_usage (prefix, at);
alter table rcm.helix_ai_keys  enable row level security;
alter table rcm.helix_ai_usage enable row level security;
revoke all on rcm.helix_ai_keys, rcm.helix_ai_usage from anon, authenticated;

-- ── Move the saved keys (home + every company) ──────────────────────────────
do $$
declare
  v_prefix text;
  v_key    text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'rcm_store')) is null then continue; end if;
    execute format('select value #>> ''{}'' from rcm.%I where key = ''anthropic_key''', v_prefix || 'rcm_store') into v_key;
    if coalesce(trim(v_key), '') <> '' then
      insert into rcm.helix_ai_keys (prefix, key, updated_by) values (v_prefix, trim(v_key), 'MIGRATION')
      on conflict (prefix) do nothing;
    end if;
    execute format('update rcm.%I set value = null where key = ''anthropic_key'' and value is not null', v_prefix || 'rcm_store');
  end loop;
end $$;

-- ── Who may manage the key: admin / manager / Settings grant / owner (from the request's session) ──
create or replace function rcm._can_manage_ai_key()
returns text   -- the company prefix, or null when not allowed
language plpgsql stable security definer
set search_path = rcm, pg_temp
as $$
declare
  s    rcm.helix_user_sessions := rcm.current_session();
  v_me jsonb;
begin
  if s.token is null then return null; end if;
  if s.as_owner is not null then return s.prefix; end if;
  execute format('select to_jsonb(u) from rcm.%I u where emp_id = $1 and active is not false', s.prefix || 'users')
     into v_me using s.emp_id;
  if v_me is null then return null; end if;
  if (v_me->>'role') in ('admin', 'manager') or coalesce((v_me->'access_grants'->>'page_settings')::boolean, false) then
    return s.prefix;
  end if;
  return null;
end;
$$;
revoke all on function rcm._can_manage_ai_key() from public, anon, authenticated;

-- Settings: { saved, ending } for the signed-in company — never the key
create or replace function rcm.ai_key_status()
returns jsonb
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select case when s.token is null then jsonb_build_object('saved', false)
         else coalesce((select jsonb_build_object('saved', true, 'ending', right(k.key, 4), 'updated_at', k.updated_at)
                          from rcm.helix_ai_keys k where k.prefix = s.prefix),
                       jsonb_build_object('saved', false)) end
  from (select (rcm.current_session()).*) s;
$$;
revoke all on function rcm.ai_key_status() from public;
grant execute on function rcm.ai_key_status() to anon, authenticated;

create or replace function rcm.set_ai_key(p_key text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text := rcm._can_manage_ai_key();
  v_key    text := trim(coalesce(p_key, ''));
begin
  if v_prefix is null then raise exception 'Only an admin can change the AI key'; end if;
  if v_key !~ '^sk-ant-' or length(v_key) < 30 then raise exception 'That does not look like an Anthropic API key (it starts with sk-ant-)'; end if;
  insert into rcm.helix_ai_keys (prefix, key, updated_at, updated_by)
  values (v_prefix, v_key, now(), (rcm.current_session()).emp_id)
  on conflict (prefix) do update set key = excluded.key, updated_at = now(), updated_by = excluded.updated_by;
end;
$$;
revoke all on function rcm.set_ai_key(text) from public;
grant execute on function rcm.set_ai_key(text) to anon, authenticated;

create or replace function rcm.clear_ai_key()
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text := rcm._can_manage_ai_key();
begin
  if v_prefix is null then raise exception 'Only an admin can change the AI key'; end if;
  delete from rcm.helix_ai_keys where prefix = v_prefix;
end;
$$;
revoke all on function rcm.clear_ai_key() from public;
grant execute on function rcm.clear_ai_key() to anon, authenticated;

-- ── Used only by the helix-ai Edge Function (service role) ──────────────────
-- → { key, prefix, emp_id, as_owner } or { error: SESSION | AI_OFF | NO_KEY }
create or replace function rcm.ai_key_for_session(p_token text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  s     rcm.helix_user_sessions;
  v_off boolean := false;
  v_key text;
begin
  if p_token is null or not rcm.session_check(p_token) then return jsonb_build_object('error', 'SESSION'); end if;
  select * into s from rcm.helix_user_sessions where token = p_token;

  if s.prefix = '' then
    select (value->'ai') = 'false'::jsonb into v_off from rcm.rcm_store where key = 'home_features';
  else
    select (features->'ai') = 'false'::jsonb into v_off from rcm.companies where prefix = s.prefix;
  end if;
  if coalesce(v_off, false) then return jsonb_build_object('error', 'AI_OFF'); end if;

  select key into v_key from rcm.helix_ai_keys where prefix = s.prefix;
  if v_key is null then return jsonb_build_object('error', 'NO_KEY'); end if;
  return jsonb_build_object('key', v_key, 'prefix', s.prefix, 'emp_id', s.emp_id, 'as_owner', s.as_owner);
end;
$$;
revoke all on function rcm.ai_key_for_session(text) from public, anon, authenticated;
grant execute on function rcm.ai_key_for_session(text) to service_role;

create or replace function rcm.ai_log_usage(p_prefix text, p_emp_id text, p_as_owner text, p_model text,
                                            p_status int, p_input int, p_output int)
returns void
language sql security definer
set search_path = rcm, pg_temp
as $$
  insert into rcm.helix_ai_usage (prefix, emp_id, as_owner, model, status, input_tokens, output_tokens)
  values (coalesce(p_prefix, ''), p_emp_id, p_as_owner, p_model, p_status, p_input, p_output);
$$;
revoke all on function rcm.ai_log_usage(text, text, text, text, int, int, int) from public, anon, authenticated;
grant execute on function rcm.ai_log_usage(text, text, text, text, int, int, int) to service_role;

grant usage on schema rcm to service_role;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
