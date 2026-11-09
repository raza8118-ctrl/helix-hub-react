-- ═══════════════════════════════════════════════════════════════════════════
-- Owner 2-step verification + sign-in logging (PO request 2026-11-09). Migration 45.
-- Run once in Supabase → SQL Editor. Additive; safe to re-run. No "Sync structure" needed (helix_* tables are never copied).
--
--   • TOTP (authenticator app) is calculated and checked HERE, in the database. The browser never decides.
--     password → owner_login gives a 5-minute pass (not a session) → owner_verify_code gives the real session key.
--     A code can't be used twice. 8 one-time recovery codes, stored scrambled.
--   • Optional for now: an owner without 2-step still signs in with the password alone (Owner Console shows a warning).
--   • Gaps closed:
--       _is_owner accepts session keys only — before, the password also worked, which would have skipped the code.
--       owner_change_password needs a signed-in session (and a code when 2-step is on, via owner_change_password_checked).
--       Lockout: 5 wrong passwords / codes in 15 minutes → locked for 15 minutes (owners had none).
--   • Every sign-in, including failed ones, goes to helix_owner_log with the IP address. Failures are RETURNED, not raised:
--     a raised error would roll back the log row. An unknown username is logged as (UNKNOWN), never the typed text
--     (people sometimes type their password into that box).
--   • Limit: the code secret must be readable by the database, so it sits in a locked table the app can't read;
--     someone with Supabase admin access could still read it.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── Tables (owner-only: no API access at all) ───────────────────────────────
create table if not exists rcm.helix_owner_2fa (
  username      text primary key,
  secret        bytea not null,
  confirmed_at  timestamptz,          -- null = setup started, not switched on
  last_step     bigint,               -- last code used; older or equal is refused
  created_at    timestamptz not null default now()
);
create table if not exists rcm.helix_owner_recovery (
  id         bigint generated always as identity primary key,
  username   text not null,
  code_hash  text not null,
  used_at    timestamptz
);
create index if not exists helix_owner_recovery_user on rcm.helix_owner_recovery (username);
create table if not exists rcm.helix_owner_challenges (
  token       text primary key,
  username    text not null,
  expires_at  timestamptz not null
);
create table if not exists rcm.helix_owner_attempts (
  id        bigint generated always as identity primary key,
  username  text not null,
  at        timestamptz not null default now()
);
create index if not exists helix_owner_attempts_user on rcm.helix_owner_attempts (username, at);

alter table rcm.helix_owner_2fa        enable row level security;
alter table rcm.helix_owner_recovery   enable row level security;
alter table rcm.helix_owner_challenges enable row level security;
alter table rcm.helix_owner_attempts   enable row level security;
revoke all on rcm.helix_owner_2fa, rcm.helix_owner_recovery, rcm.helix_owner_challenges, rcm.helix_owner_attempts from anon, authenticated;

-- ── TOTP (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits) ────────────────────────
create or replace function rcm._totp(p_secret bytea, p_step bigint)
returns text
language plpgsql immutable
set search_path = rcm, pg_temp
as $$
declare
  h   bytea := extensions.hmac(decode(lpad(to_hex(p_step), 16, '0'), 'hex'), p_secret, 'sha1');
  o   int   := get_byte(h, 19) & 15;
  v   bigint := ((get_byte(h, o) & 127)::bigint << 24) | (get_byte(h, o + 1)::bigint << 16)
              | (get_byte(h, o + 2)::bigint << 8) | get_byte(h, o + 3)::bigint;
begin
  return lpad((v % 1000000)::text, 6, '0');
end;
$$;
revoke all on function rcm._totp(bytea, bigint) from public, anon, authenticated;

-- Step of the matching code (now, or one step either side for clock drift), newer than p_last. Null = no match.
create or replace function rcm._totp_match(p_secret bytea, p_code text, p_last bigint)
returns bigint
language plpgsql stable
set search_path = rcm, pg_temp
as $$
declare
  v_now bigint := floor(extract(epoch from now()) / 30)::bigint;
  s     bigint;
begin
  if coalesce(p_code, '') !~ '^[0-9]{6}$' then return null; end if;
  for s in v_now - 1 .. v_now + 1 loop
    if s > coalesce(p_last, 0) and rcm._totp(p_secret, s) = p_code then return s; end if;
  end loop;
  return null;
end;
$$;
revoke all on function rcm._totp_match(bytea, text, bigint) from public, anon, authenticated;

create or replace function rcm._base32(p_data bytea)
returns text
language plpgsql immutable
set search_path = rcm, pg_temp
as $$
declare
  a   text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  out text := '';
  buf int := 0;
  n   int := 0;
  i   int;
begin
  for i in 0 .. length(p_data) - 1 loop
    buf := (buf << 8) | get_byte(p_data, i);
    n := n + 8;
    while n >= 5 loop
      out := out || substr(a, ((buf >> (n - 5)) & 31) + 1, 1);
      n := n - 5;
    end loop;
    buf := buf & ((1 << n) - 1);
  end loop;
  if n > 0 then out := out || substr(a, ((buf << (5 - n)) & 31) + 1, 1); end if;
  return out;
end;
$$;
revoke all on function rcm._base32(bytea) from public, anon, authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Best guess at the caller's address, for the log only
create or replace function rcm._client_ip()
returns text
language sql stable
as $$
  select left(coalesce(rcm._hdr('cf-connecting-ip'), trim(split_part(coalesce(rcm._hdr('x-forwarded-for'), ''), ',', 1))), 64);
$$;
revoke all on function rcm._client_ip() from public, anon, authenticated;

create or replace function rcm._owner_locked(p_user text)
returns boolean
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select count(*) >= 5 from rcm.helix_owner_attempts where username = p_user and at > now() - interval '15 minutes';
$$;
revoke all on function rcm._owner_locked(text) from public, anon, authenticated;

create or replace function rcm._owner_new_session(p_user text)
returns text
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from rcm.helix_owner_sessions where expires_at < now();          -- expired keys only
  delete from rcm.helix_owner_challenges where expires_at < now() or username = p_user;
  delete from rcm.helix_owner_attempts where username = p_user or at < now() - interval '1 day';
  insert into rcm.helix_owner_sessions (token, username, expires_at) values (v_token, p_user, now() + interval '12 hours');
  return v_token;
end;
$$;
revoke all on function rcm._owner_new_session(text) from public, anon, authenticated;

-- Checks and uses up a code. → 'code', 'recovery', or null when wrong. Only a switched-on 2-step counts.
create or replace function rcm._owner_use_code(p_user text, p_code text)
returns text
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  t      rcm.helix_owner_2fa;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_step bigint;
  r      record;
begin
  select * into t from rcm.helix_owner_2fa where username = p_user and confirmed_at is not null;
  if not found then return null; end if;
  v_step := rcm._totp_match(t.secret, v_code, t.last_step);
  if v_step is not null then
    update rcm.helix_owner_2fa set last_step = v_step where username = p_user and coalesce(last_step, 0) < v_step;
    if found then return 'code'; end if;
    return null;
  end if;
  if v_code ~ '^[A-Z2-9]{4}-?[A-Z2-9]{4}$' then
    v_code := left(v_code, 4) || '-' || right(v_code, 4);
    for r in select id, code_hash from rcm.helix_owner_recovery where username = p_user and used_at is null loop
      if r.code_hash = extensions.crypt(v_code, r.code_hash) then
        update rcm.helix_owner_recovery set used_at = now() where id = r.id;
        return 'recovery';
      end if;
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function rcm._owner_use_code(text, text) from public, anon, authenticated;

-- ── Close the gap: only a session key proves an owner (password no longer works here) ───────
create or replace function rcm._is_owner(p_username text, p_password text)
returns boolean
language sql security definer
set search_path = rcm, pg_temp
as $$
  select exists (
    select 1 from rcm.helix_owner_sessions s
    join rcm.helix_owners o on o.username = s.username and o.active
    where s.username = upper(trim(p_username)) and s.token = p_password and s.expires_at > now()
  );
$$;
revoke all on function rcm._is_owner(text, text) from public, anon, authenticated;

-- ── Sign-in: step 1 (password) ──────────────────────────────────────────────
-- → { ok: false, error: 'invalid' | 'locked' } · { ok: true, needs_code: true, pass } · { ok: true, username, name, token }
create or replace function rcm.owner_login(p_username text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user  text := upper(trim(coalesce(p_username, '')));
  o       rcm.helix_owners;
  v_ip    jsonb := jsonb_build_object('ip', rcm._client_ip());
  v_pass  text;
begin
  select * into o from rcm.helix_owners where username = v_user;
  if not found then
    perform rcm._owner_log('(unknown)', 'owner_sign_in_unknown', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if rcm._owner_locked(v_user) then
    perform rcm._owner_log(v_user, 'owner_sign_in_locked', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if not rcm._owner_password_ok(v_user, p_password) then
    insert into rcm.helix_owner_attempts (username) values (v_user);
    perform rcm._owner_log(v_user, 'owner_sign_in_bad_password', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', case when rcm._owner_locked(v_user) then 'locked' else 'invalid' end);
  end if;
  if exists (select 1 from rcm.helix_owner_2fa where username = v_user and confirmed_at is not null) then
    v_pass := encode(extensions.gen_random_bytes(32), 'hex');
    delete from rcm.helix_owner_challenges where expires_at < now() or username = v_user;
    insert into rcm.helix_owner_challenges (token, username, expires_at) values (v_pass, v_user, now() + interval '5 minutes');
    perform rcm._owner_log(v_user, 'owner_sign_in_password_ok', null, null, v_ip);
    return jsonb_build_object('ok', true, 'needs_code', true, 'pass', v_pass);
  end if;
  perform rcm._owner_log(v_user, 'owner_sign_in', null, null, v_ip || jsonb_build_object('two_step', false));
  return jsonb_build_object('ok', true, 'username', o.username, 'name', o.name, 'token', rcm._owner_new_session(v_user), 'two_step', false);
end;
$$;
revoke all on function rcm.owner_login(text, text) from public;
grant execute on function rcm.owner_login(text, text) to anon, authenticated;

-- ── Sign-in: step 2 (code or recovery code) ─────────────────────────────────
create or replace function rcm.owner_verify_code(p_pass text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user text;
  o      rcm.helix_owners;
  v_kind text;
  v_ip   jsonb := jsonb_build_object('ip', rcm._client_ip());
begin
  select username into v_user from rcm.helix_owner_challenges where token = p_pass and expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  select * into o from rcm.helix_owners where username = v_user and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if rcm._owner_locked(v_user) then
    perform rcm._owner_log(v_user, 'owner_sign_in_locked', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  v_kind := rcm._owner_use_code(v_user, p_code);
  if v_kind is null then
    insert into rcm.helix_owner_attempts (username) values (v_user);
    perform rcm._owner_log(v_user, 'owner_sign_in_bad_code', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', case when rcm._owner_locked(v_user) then 'locked' else 'invalid' end);
  end if;
  perform rcm._owner_log(v_user, case when v_kind = 'recovery' then 'owner_sign_in_recovery' else 'owner_sign_in' end, null, null,
                         v_ip || jsonb_build_object('two_step', true));
  return jsonb_build_object('ok', true, 'username', o.username, 'name', o.name, 'token', rcm._owner_new_session(v_user), 'two_step', true);
end;
$$;
revoke all on function rcm.owner_verify_code(text, text) from public;
grant execute on function rcm.owner_verify_code(text, text) to anon, authenticated;

-- ── Setup ───────────────────────────────────────────────────────────────────
create or replace function rcm.owner_2fa_status(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user text := upper(trim(p_by_user));
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  return jsonb_build_object(
    'enabled', exists (select 1 from rcm.helix_owner_2fa where username = v_user and confirmed_at is not null),
    'recovery_left', (select count(*) from rcm.helix_owner_recovery where username = v_user and used_at is null));
end;
$$;
revoke all on function rcm.owner_2fa_status(text, text) from public;
grant execute on function rcm.owner_2fa_status(text, text) to anon, authenticated;

-- Needs the password again. → { ok: true, secret, uri } (shown once for the QR code); nothing is on until confirmed.
create or replace function rcm.owner_2fa_begin(p_by_user text, p_by_password text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user   text := upper(trim(p_by_user));
  v_secret bytea := extensions.gen_random_bytes(20);
  v_b32    text;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if rcm._owner_locked(v_user) then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not rcm._owner_password_ok(v_user, p_password) then
    insert into rcm.helix_owner_attempts (username) values (v_user);
    perform rcm._owner_log(v_user, 'owner_2fa_bad_password', null, null, jsonb_build_object('ip', rcm._client_ip()));
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;
  if exists (select 1 from rcm.helix_owner_2fa where username = v_user and confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'already_on');
  end if;
  insert into rcm.helix_owner_2fa (username, secret) values (v_user, v_secret)
    on conflict (username) do update set secret = excluded.secret, last_step = null, created_at = now();
  v_b32 := rcm._base32(v_secret);
  return jsonb_build_object('ok', true, 'secret', v_b32,
    'uri', format('otpauth://totp/Helix%%20Hub:%s?secret=%s&issuer=Helix%%20Hub&algorithm=SHA1&digits=6&period=30', v_user, v_b32));
end;
$$;
revoke all on function rcm.owner_2fa_begin(text, text, text) from public;
grant execute on function rcm.owner_2fa_begin(text, text, text) to anon, authenticated;

-- A correct code switches it on. → { ok: true, recovery: [8 codes] } — shown once, only the scrambled form is kept.
create or replace function rcm.owner_2fa_confirm(p_by_user text, p_by_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user  text := upper(trim(p_by_user));
  t       rcm.helix_owner_2fa;
  v_step  bigint;
  v_abc   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_rand  bytea;
  v_code  text;
  v_codes text[] := '{}';
  i       int;
  j       int;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  select * into t from rcm.helix_owner_2fa where username = v_user and confirmed_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_started'); end if;
  v_step := rcm._totp_match(t.secret, regexp_replace(coalesce(p_code, ''), '\s', '', 'g'), null);
  if v_step is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  update rcm.helix_owner_2fa set confirmed_at = now(), last_step = v_step where username = v_user;
  delete from rcm.helix_owner_recovery where username = v_user;
  for i in 1 .. 8 loop
    v_rand := extensions.gen_random_bytes(8);
    v_code := '';
    for j in 0 .. 7 loop
      v_code := v_code || substr(v_abc, (get_byte(v_rand, j) % 32) + 1, 1);
      if j = 3 then v_code := v_code || '-'; end if;
    end loop;
    insert into rcm.helix_owner_recovery (username, code_hash) values (v_user, extensions.crypt(v_code, extensions.gen_salt('bf', 8)));
    v_codes := v_codes || v_code;
  end loop;
  perform rcm._owner_log(v_user, 'owner_2fa_on', null, null, jsonb_build_object('ip', rcm._client_ip()));
  return jsonb_build_object('ok', true, 'recovery', to_jsonb(v_codes));
end;
$$;
revoke all on function rcm.owner_2fa_confirm(text, text, text) from public;
grant execute on function rcm.owner_2fa_confirm(text, text, text) to anon, authenticated;

-- Turn off your own: password + code (or a recovery code)
create or replace function rcm.owner_2fa_disable(p_by_user text, p_by_password text, p_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user text := upper(trim(p_by_user));
  v_ip   jsonb := jsonb_build_object('ip', rcm._client_ip());
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if rcm._owner_locked(v_user) then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not rcm._owner_password_ok(v_user, p_password) then
    insert into rcm.helix_owner_attempts (username) values (v_user);
    perform rcm._owner_log(v_user, 'owner_2fa_bad_password', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;
  if rcm._owner_use_code(v_user, p_code) is null then
    insert into rcm.helix_owner_attempts (username) values (v_user);
    perform rcm._owner_log(v_user, 'owner_2fa_bad_code', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  delete from rcm.helix_owner_2fa where username = v_user;
  delete from rcm.helix_owner_recovery where username = v_user;
  perform rcm._owner_log(v_user, 'owner_2fa_off', null, null, v_ip);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function rcm.owner_2fa_disable(text, text, text, text) from public;
grant execute on function rcm.owner_2fa_disable(text, text, text, text) to anon, authenticated;

-- Lost phone: ANOTHER owner resets it (needs their own password). Logged.
create or replace function rcm.owner_2fa_reset(p_by_user text, p_by_password text, p_password text, p_username text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_by     text := upper(trim(p_by_user));
  v_target text := upper(trim(p_username));
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if v_target = v_by then raise exception 'You can''t reset your own 2-step verification'; end if;
  if rcm._owner_locked(v_by) then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not rcm._owner_password_ok(v_by, p_password) then
    insert into rcm.helix_owner_attempts (username) values (v_by);
    perform rcm._owner_log(v_by, 'owner_2fa_bad_password', null, v_target, jsonb_build_object('ip', rcm._client_ip()));
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;
  delete from rcm.helix_owner_2fa where username = v_target;
  delete from rcm.helix_owner_recovery where username = v_target;
  perform rcm._owner_log(v_by, 'owner_2fa_reset', null, v_target, jsonb_build_object('ip', rcm._client_ip()));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function rcm.owner_2fa_reset(text, text, text, text) from public;
grant execute on function rcm.owner_2fa_reset(text, text, text, text) to anon, authenticated;

-- ── Owner list shows who has 2-step on ──────────────────────────────────────
create or replace function rcm.owner_list_owners(p_by_user text, p_by_password text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then
    raise exception 'Not authorised';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('username', o.username, 'name', o.name, 'active', o.active, 'created_at', o.created_at,
                     'two_step', exists (select 1 from rcm.helix_owner_2fa t where t.username = o.username and t.confirmed_at is not null))
                     order by o.created_at)
    from rcm.helix_owners o
  ), '[]'::jsonb);
end;
$$;
revoke all on function rcm.owner_list_owners(text, text) from public;
grant execute on function rcm.owner_list_owners(text, text) to anon, authenticated;

-- ── Changing the password: signed-in session + current password + code when 2-step is on ───
create or replace function rcm.owner_change_password_checked(p_by_user text, p_by_password text, p_password text, p_new_password text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_user text := upper(trim(p_by_user));
  v_ip   jsonb := jsonb_build_object('ip', rcm._client_ip());
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if rcm._owner_locked(v_user) then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not rcm._owner_password_ok(v_user, p_password) then
    insert into rcm.helix_owner_attempts (username) values (v_user);
    perform rcm._owner_log(v_user, 'owner_password_bad_current', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;
  if length(coalesce(p_new_password, '')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'too_short');
  end if;
  if exists (select 1 from rcm.helix_owner_2fa where username = v_user and confirmed_at is not null)
     and rcm._owner_use_code(v_user, p_code) is null then
    insert into rcm.helix_owner_attempts (username) values (v_user);
    perform rcm._owner_log(v_user, 'owner_2fa_bad_code', null, null, v_ip);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  update rcm.helix_owners set password = p_new_password where username = v_user;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function rcm.owner_change_password_checked(text, text, text, text, text) from public;
grant execute on function rcm.owner_change_password_checked(text, text, text, text, text) to anon, authenticated;

-- The older function stays for a page not yet reloaded, but can't skip the session or the code any more
create or replace function rcm.owner_change_password(p_username text, p_password text, p_new_password text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_username, rcm._hdr('x-helix-owner')) then
    raise exception 'Please sign in again to change the password';
  end if;
  if exists (select 1 from rcm.helix_owner_2fa where username = upper(trim(p_username)) and confirmed_at is not null) then
    raise exception 'Please reload the page to change the password';
  end if;
  if not rcm._owner_password_ok(p_username, p_password) then
    raise exception 'Current password is incorrect';
  end if;
  if length(coalesce(p_new_password, '')) < 8 then
    raise exception 'New password must be at least 8 characters';
  end if;
  update rcm.helix_owners set password = p_new_password where username = upper(trim(p_username));
end;
$$;
revoke all on function rcm.owner_change_password(text, text, text) from public;
grant execute on function rcm.owner_change_password(text, text, text) to anon, authenticated;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
