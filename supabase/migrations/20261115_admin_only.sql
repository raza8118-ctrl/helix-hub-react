-- ═══════════════════════════════════════════════════════════════════════════
-- Company Admin vs Manager (PO request 2026-11-09). Migration 50.
-- Run once in Supabase → SQL Editor. Replaces four of our own functions and re-creates the change rules of the rcm_store
-- tables; no tables, columns or data are changed. Safe to re-run.
--
--   Settings, Team (users, roles, access), Clients & Payers and the Audit Log are now admin-only by default, matching
--   src/lib/access.js. Before, the database let a manager change everything an admin can.
--   • _may: a manager still passes every rule EXCEPT the admin-only ones (page_settings, page_team, masters_edit,
--     audit_view) — those need the admin role or a grant an admin gave on the Team page. So managers can no longer save
--     task targets, processes or clients; everything else they save (payers, SOPs, denial guides, codes, worklists…) works.
--   • Users guard: only an admin (or someone with the "Team management" grant) changes other people's accounts.
--     Everyone can still change their own name / photo / password; supervisors can still reset passwords.
--   • AI key: admin, the Settings grant, or the owner (was also any manager).
--   • rcm_store (saved settings): shift timing (shift_dst) and the Quality "skip" list (quality_skip_procs) need Settings /
--     Team; all other keys keep their current rule (supervisor and above, own prefs, packet naming, allocations).
--   At the time of this migration neither company has a manager, so nobody loses access.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Who may change data guarded by p_keys ───────────────────────────────────
create or replace function rcm._may(p_prefix text, p_keys text)
returns boolean
language plpgsql stable security definer
set search_path = rcm, pg_temp
as $$
declare
  m   jsonb;
  k   text;
begin
  if not coalesce((select role_rules from rcm.helix_rls_settings where prefix = p_prefix), true) then return true; end if;
  m := rcm._me(p_prefix);
  if m is null then return false; end if;
  if (m->>'owner')::boolean then return true; end if;
  if m->>'role' = 'admin' then return true; end if;
  foreach k in array string_to_array(p_keys, '|') loop
    -- managers: everything except the admin-only permissions (PO 2026-11-09)
    if m->>'role' = 'manager' and k not in ('page_settings', 'page_team', 'masters_edit', 'audit_view') then return true; end if;
    if k = 'MONITORS' and m->>'role' = 'supervisor' then return true; end if;
    if coalesce((m->'grants'->>k)::boolean, false) then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function rcm._may(text, text) from public;
grant execute on function rcm._may(text, text) to anon, authenticated;

-- ── Users guard: only admins / the Team-management grant change other people's accounts ─────
create or replace function rcm._guard_users_trg()
returns trigger
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix  text := left(tg_table_name, length(tg_table_name) - length('users'));
  s         rcm.helix_user_sessions;
  v_me      jsonb;
  v_role    text;
  v_changed text[];
begin
  if not coalesce((select enforce from rcm.helix_rls_settings where prefix = v_prefix), true) then return coalesce(new, old); end if;
  if rcm._owner_key_ok() then return coalesce(new, old); end if;
  s := rcm.current_session();
  if s.token is null or s.as_owner is not null then return coalesce(new, old); end if;   -- system / owner (no session = table rule refuses)

  execute format('select to_jsonb(u) from rcm.%I u where emp_id = $1', tg_table_name) into v_me using s.emp_id;
  v_role := coalesce(v_me->>'role', '');
  if v_role = 'admin' or coalesce((v_me->'access_grants'->>'page_team')::boolean, false) then
    return coalesce(new, old);
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'Only an admin can add or remove users';
  end if;

  select coalesce(array_agg(e.key), '{}') into v_changed
    from jsonb_each(to_jsonb(new)) e where e.value is distinct from to_jsonb(old)->e.key;
  if upper(old.emp_id) = s.emp_id and upper(new.emp_id) = s.emp_id
     and v_changed <@ array['name', 'avatar_url', 'theme', 'password'] then
    return new;
  end if;
  if v_role = 'supervisor' and v_changed <@ array['password'] then
    return new;
  end if;
  raise exception 'You can only change your own name, photo and password';
end;
$$;
revoke all on function rcm._guard_users_trg() from public, anon, authenticated;

-- ── AI key: admin, the Settings grant, or the owner ─────────────────────────
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
  if (v_me->>'role') = 'admin' or coalesce((v_me->'access_grants'->>'page_settings')::boolean, false) then
    return s.prefix;
  end if;
  return null;
end;
$$;
revoke all on function rcm._can_manage_ai_key() from public, anon, authenticated;

-- ── Change rules: same as migration 43, except two admin-only setting keys in rcm_store ─────
create or replace function rcm._protect_roles(p_table text, p_prefix text)
returns void
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_rule text := rcm._role_rule_for(substr(p_table, length(p_prefix) + 1));
  v_in   text := format('(select rcm._allowed(%L))', p_prefix);
  v_may  text;
  v_pol  text;
begin
  if v_rule is null or to_regclass(format('rcm.%I', p_table)) is null then return; end if;
  v_may := case v_rule
    when 'OWN' then format('((select rcm._may(%L, %L)) or emp_id = (select rcm._my_emp(%L)))', p_prefix, 'MONITORS', p_prefix)
    when 'STORE' then format('(((select rcm._may(%L, %L)) and key not in (''shift_dst'', ''quality_skip_procs''))'
                             ' or (key in (''shift_dst'', ''quality_skip_procs'') and (select rcm._may(%L, %L)))'
                             ' or key = ''prefs_'' || (select rcm._my_emp(%L))'
                             ' or (key = ''packet_naming'' and (select rcm._may(%L, %L)))'
                             ' or (key like ''alloc\_%%'' and (select rcm._may(%L, %L))))',
                             p_prefix, 'MONITORS', p_prefix, 'page_settings|page_team', p_prefix,
                             p_prefix, 'packet_settings', p_prefix, 'page_allocation')
    else format('(select rcm._may(%L, %L))', p_prefix, v_rule)
  end;
  execute format('drop policy if exists helix_session on rcm.%I', p_table);
  foreach v_pol in array array['helix_read', 'helix_insert', 'helix_update', 'helix_delete'] loop
    if not exists (select 1 from pg_policies where schemaname = 'rcm' and tablename = p_table and policyname = v_pol) then
      execute case v_pol
        when 'helix_read'   then format('create policy helix_read on rcm.%I for select to anon, authenticated using (%s)', p_table, v_in)
        when 'helix_insert' then format('create policy helix_insert on rcm.%I for insert to anon, authenticated with check (%s and %s)', p_table, v_in, v_may)
        when 'helix_update' then format('create policy helix_update on rcm.%I for update to anon, authenticated using (%s and %s) with check (%s and %s)', p_table, v_in, v_may, v_in, v_may)
        else                     format('create policy helix_delete on rcm.%I for delete to anon, authenticated using (%s and %s)', p_table, v_in, v_may)
      end;
    end if;
  end loop;
end;
$$;
revoke all on function rcm._protect_roles(text, text) from public, anon, authenticated;

-- Re-create the three change rules of every rcm_store copy with the new STORE rule (read rule unchanged; data untouched)
do $$
declare
  v_prefix text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    if to_regclass(format('rcm.%I', v_prefix || 'rcm_store')) is not null then
      execute format('drop policy if exists helix_insert on rcm.%I', v_prefix || 'rcm_store');
      execute format('drop policy if exists helix_update on rcm.%I', v_prefix || 'rcm_store');
      execute format('drop policy if exists helix_delete on rcm.%I', v_prefix || 'rcm_store');
      perform rcm._protect_roles(v_prefix || 'rcm_store', v_prefix);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
