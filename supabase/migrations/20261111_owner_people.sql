-- ═══════════════════════════════════════════════════════════════════════════
-- Owner Command Center → People: change a user's role (PO request 2026-11-09). Migration 46.
-- Run once in Supabase → SQL Editor. Additive (one new function, no tables or columns); safe to re-run.
--
--   • owner_set_user_role(owner, owner key, company code, emp_id, role) → { ok, from, to } | { ok: false, error }
--     Roles: employee, supervisor, manager, admin. Only a signed-in owner (session key) can call it.
--     The change, the sign-out and both log entries happen together: the person's sessions end (so the new
--     role applies on their next sign-in), the company's Audit Log gets "owner_change_role" marked as the
--     owner, and the owner log gets the same.
--   • Reset password and switch off need nothing new: the existing triggers already end that person's sessions.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function rcm.owner_set_user_role(p_by_user text, p_by_password text, p_code text, p_emp_id text, p_role text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_code   text := upper(trim(coalesce(p_code, '')));
  v_emp    text := upper(trim(coalesce(p_emp_id, '')));
  v_role   text := lower(trim(coalesce(p_role, '')));
  v_prefix text;
  v_name   text;
  v_old    text;
  o        rcm.helix_owners;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if v_role not in ('employee', 'supervisor', 'manager', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'bad_role');
  end if;

  if v_code = '__HOME__' then
    v_prefix := '';
  else
    select prefix into v_prefix from rcm.companies where upper(code) = v_code;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;
  end if;

  execute format('select name, coalesce(role, ''employee'') from rcm.%I where upper(emp_id) = $1', v_prefix || 'users')
     into v_name, v_old using v_emp;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_old = v_role then return jsonb_build_object('ok', true, 'from', v_old, 'to', v_role, 'unchanged', true); end if;

  execute format('update rcm.%I set role = $1 where upper(emp_id) = $2', v_prefix || 'users') using v_role, v_emp;
  delete from rcm.helix_user_sessions where prefix = v_prefix and emp_id = v_emp;

  select * into o from rcm.helix_owners where username = upper(trim(p_by_user));
  execute format('insert into rcm.%I (actor_emp_id, actor_name, actor_role, action, target_emp_id, target_name, details)
                  values ($1, $2, $3, $4, $5, $6, $7)', v_prefix || 'audit_log')
    using 'HELIX_OWNER', format('%s (Helix Hub owner %s)', o.name, o.username), 'owner', 'owner_change_role',
          v_emp, v_name, jsonb_build_object('from', v_old, 'to', v_role);
  perform rcm._owner_log(p_by_user, 'owner_change_role', case when v_prefix = '' then '__home__' else v_code end,
                         format('%s (%s)', coalesce(v_name, ''), v_emp), jsonb_build_object('from', v_old, 'to', v_role));
  return jsonb_build_object('ok', true, 'from', v_old, 'to', v_role);
end;
$$;
revoke all on function rcm.owner_set_user_role(text, text, text, text, text) from public;
grant execute on function rcm.owner_set_user_role(text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
