-- ═══════════════════════════════════════════════════════════════════════════
-- Master copy → Push to companies (PO request 2026-11-09), Stage 2. Migration 48.
-- Run once in Supabase → SQL Editor. Additive only (one column, one table, new functions); safe to re-run.
--
--   • A push only ADDS or UPDATES rows that came from the master (master_id / master_hash set). It never deletes, and never
--     changes a company's own rows (no master_hash) or client-specific rows (client limits, client steps, client SOPs).
--   • master_hash = fingerprint of a pushed row's content as pushed. If the company edited the row afterwards, the fingerprint
--     no longer matches → "Kept: changed here" (the company's edit stays).
--   • A master row with the same name / code as a company's own row → "Kept: company's own" (not linked, not changed).
--     Payer details (IDs, contacts, limits, notes, plans, auth rules) under a company's own payer are not added.
--     Containers (SOP categories / software / tasks, denial codes) are different: master SOPs and denial steps ARE added under
--     the company's own matching category / code — the company's own row itself is not changed.
--   • Preview = the real push run inside the database and then cancelled, so it shows exactly what a push will do.
--   • Every push: owner log + the company's Audit Log + rcm.helix_master_pushes (push history).
--   • An updated SOP that is published in the master gets a new version in the company (staff acknowledge as usual).
--   • Not pushed yet (Stage 3): payer form files, SOP screenshots / videos (walkthrough_video is left as it is).
-- Sections: payers · denials · codes · sops · targets
-- ═══════════════════════════════════════════════════════════════════════════

-- ── master_hash in home + every company + the master ───────────────────────
do $$
declare
  v_prefix text;
  t        text;
begin
  for v_prefix in select '' union all select prefix from rcm.companies loop
    foreach t in array rcm._master_tables() loop
      if to_regclass(format('rcm.%I', v_prefix || t)) is not null then
        execute format('alter table rcm.%I add column if not exists master_hash text', v_prefix || t);
      end if;
    end loop;
  end loop;
end;
$$;

-- ── Push history ────────────────────────────────────────────────────────────
create table if not exists rcm.helix_master_pushes (
  id            bigint generated always as identity primary key,
  pushed_at     timestamptz not null default now(),
  owner         text        not null,
  company_code  text        not null,           -- '__home__' = home company
  sections      text[]      not null,
  summary       jsonb       not null            -- per table: new / updated / unchanged / kept_own / kept_changed / skipped_parent / conflict
);
alter table rcm.helix_master_pushes enable row level security;
revoke all on rcm.helix_master_pushes from anon, authenticated;

-- ── What a push covers: order (parents first), section, links, which rows, "same row" rule, label ───────
-- fks: column → parent table ("?sops" = optional: left empty when that SOP isn't in the company).
-- natkey: how a company's own row is recognised (t = company row, s = master row, {col} = the link translated to the company).
create or replace function rcm._master_push_spec()
returns table (ord int, section text, tbl text, fks jsonb, filter text, natkey text, label text)
language sql immutable
as $$
  values
    (1,  'payers',  'payers',           '{}'::jsonb, 'true',
         'lower(t.name) = lower(s.name)', 's.name'),
    (2,  'payers',  'payer_plans',      '{"payer_id": "payers"}'::jsonb, 'true',
         't.payer_id = {payer_id} and lower(t.plan_name) = lower(s.plan_name)', '{PAYER} || '' · '' || s.plan_name'),
    (3,  'payers',  'payer_ids',        '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
         't.payer_id = {payer_id} and t.electronic_payer_id = s.electronic_payer_id and coalesce(t.clearinghouse, '''') = coalesce(s.clearinghouse, '''') and coalesce(t.transaction_type, '''') = coalesce(s.transaction_type, '''')',
         '{PAYER} || '' · '' || s.electronic_payer_id'),
    (4,  'payers',  'payer_contacts',   '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
         't.payer_id = {payer_id} and t.department = s.department and coalesce(t.phone, '''') = coalesce(s.phone, '''')',
         '{PAYER} || '' · '' || s.department'),
    (5,  'payers',  'payer_limits',     '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 's.client_id is null',
         't.payer_id = {payer_id} and t.limit_type = s.limit_type and coalesce(t.level, 0) = coalesce(s.level, 0) and t.client_id is null',
         '{PAYER} || '' · '' || s.limit_type'),
    (6,  'payers',  'payer_notes',      '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
         't.payer_id = {payer_id} and t.note = s.note', '{PAYER} || '' · '' || left(s.note, 40)'),
    (7,  'payers',  'payer_auth_rules', '{"payer_id": "payers", "plan_id": "payer_plans"}'::jsonb, 'true',
         't.payer_id = {payer_id} and lower(coalesce(t.service, '''')) = lower(coalesce(s.service, ''''))',
         '{PAYER} || '' · '' || coalesce(s.service, ''auth rule'')'),
    (8,  'sops',    'sop_categories',   '{}'::jsonb, 'true',
         'lower(t.name) = lower(s.name)', 's.name'),
    (9,  'sops',    'sop_software',     '{"category_id": "sop_categories"}'::jsonb, 'true',
         't.category_id = {category_id} and lower(t.name) = lower(s.name)', 's.name'),
    (10, 'sops',    'sop_tasks',        '{"software_id": "sop_software"}'::jsonb, 'true',
         't.software_id = {software_id} and lower(t.name) = lower(s.name)', 's.name'),
    (11, 'sops',    'sops',             '{"task_id": "sop_tasks"}'::jsonb, 's.client_id is null',
         't.task_id = {task_id} and lower(t.title) = lower(s.title) and t.client_id is null', 's.title'),
    (12, 'denials', 'denial_codes',     '{}'::jsonb, 'true',
         't.code_type = s.code_type and upper(t.code) = upper(s.code)', 'upper(s.code_type) || '' '' || s.code'),
    (13, 'denials', 'denial_steps',     '{"code_id": "denial_codes", "payer_id": "payers", "sop_id": "?sops"}'::jsonb, 's.client_id is null and s.scope <> ''client''',
         't.code_id = {code_id} and t.scope = s.scope and t.client_id is null and coalesce(t.payer_id, 0) = coalesce({payer_id}, 0)',
         '(select upper(c.code_type) || '' '' || c.code from rcm.{M}denial_codes c where c.id = s.code_id) || '' · '' || s.scope || '' steps'''),
    (14, 'codes',   'ref_codes',        '{}'::jsonb, 'true',
         't.code_set = s.code_set and t.code = s.code', 's.code_set || '' '' || s.code'),
    (15, 'targets', 'task_configs',     '{}'::jsonb, 'true',
         't.process = s.process and t.name = s.name', 's.process || '' · '' || s.name');
$$;

-- The company's id for a master parent row. Containers (SOP categories / software / tasks, denial codes) also match the
-- company's own row with the same name / code, so master children can go under it; everything else matches pushed rows only.
create or replace function rcm._master_map_expr(p_parent text, p_ref text, p_master text, p_target text, p_depth int default 1)
returns text
language plpgsql immutable
as $$
declare
  d    text := 'd' || p_depth;
  p    text := 'p' || p_depth;
  base text := format('(select %1$s.id from rcm.%2$I %1$s where %1$s.master_id = %3$s)', d, p_target || p_parent, p_ref);
  own  text;
begin
  own := case p_parent
    when 'sop_categories' then format(
      '(select %1$s.id from rcm.%2$I %1$s join rcm.%3$I %4$s on lower(%1$s.name) = lower(%4$s.name) where %4$s.id = %5$s and %1$s.master_hash is null order by %1$s.id limit 1)',
      d, p_target || 'sop_categories', p_master || 'sop_categories', p, p_ref)
    when 'sop_software' then format(
      '(select %1$s.id from rcm.%2$I %1$s join rcm.%3$I %4$s on lower(%1$s.name) = lower(%4$s.name) where %4$s.id = %5$s and %1$s.master_hash is null and %1$s.category_id = %6$s order by %1$s.id limit 1)',
      d, p_target || 'sop_software', p_master || 'sop_software', p, p_ref,
      rcm._master_map_expr('sop_categories', p || '.category_id', p_master, p_target, p_depth + 1))
    when 'sop_tasks' then format(
      '(select %1$s.id from rcm.%2$I %1$s join rcm.%3$I %4$s on lower(%1$s.name) = lower(%4$s.name) where %4$s.id = %5$s and %1$s.master_hash is null and %1$s.software_id = %6$s order by %1$s.id limit 1)',
      d, p_target || 'sop_tasks', p_master || 'sop_tasks', p, p_ref,
      rcm._master_map_expr('sop_software', p || '.software_id', p_master, p_target, p_depth + 1))
    when 'denial_codes' then format(
      '(select %1$s.id from rcm.%2$I %1$s join rcm.%3$I %4$s on %1$s.code_type = %4$s.code_type and upper(%1$s.code) = upper(%4$s.code) where %4$s.id = %5$s and %1$s.master_hash is null order by %1$s.id limit 1)',
      d, p_target || 'denial_codes', p_master || 'denial_codes', p, p_ref)
    else null
  end;
  return case when own is null then base else format('coalesce(%s, %s)', base, own) end;
end;
$$;

-- Adds one row's outcome to the result: counts per kind, and up to 30 names per kind (none for "unchanged")
create or replace function rcm._mp_note(p_res jsonb, p_section text, p_tbl text, p_kind text, p_label text)
returns jsonb
language plpgsql immutable
as $$
declare
  e     jsonb := coalesce(p_res->p_tbl, jsonb_build_object('section', p_section));
  names jsonb := coalesce(e->'names'->p_kind, '[]'::jsonb);
begin
  e := e || jsonb_build_object(p_kind, coalesce((e->>p_kind)::int, 0) + 1);
  if p_kind <> 'unchanged' and jsonb_array_length(names) < 30 then
    e := jsonb_set(e, '{names}', coalesce(e->'names', '{}'::jsonb) || jsonb_build_object(p_kind, names || to_jsonb(coalesce(p_label, '(no name)'))));
  end if;
  return p_res || jsonb_build_object(p_tbl, e);
end;
$$;

-- ── The push itself, for one company (internal; preview and push both call it) ─────────────
create or replace function rcm._master_push_company(p_master text, p_target text, p_sections text[], p_now timestamptz)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  sp       record;
  c        record;
  v_t      text;
  v_m      text;
  v_has_id boolean;
  v_cols   text;
  v_map    text;
  v_tcols  text;
  v_miss   text;
  v_nat    text;
  v_label  text;
  v_key    text;
  v_link   text;
  v_tid_e  text;
  v_tid_m  text;
  v_extra_ins_c text;
  v_extra_ins_v text;
  v_extra_upd   text;
  v_fk     text;
  v_par    text;
  v_expr   text;
  r        record;
  v_tid    text;
  v_cur    text;
  v_last   text;
  v_own    boolean;
  v_kind   text;
  v_res    jsonb := '{}'::jsonb;
  v_sid    bigint;
  v_status text;
begin
  for sp in select * from rcm._master_push_spec() where section = any(p_sections) order by ord loop
    v_t := p_target || sp.tbl;
    v_m := p_master || sp.tbl;
    if to_regclass(format('rcm.%I', v_t)) is null or to_regclass(format('rcm.%I', v_m)) is null then continue; end if;
    v_has_id := exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_m and column_name = 'id');

    -- Content columns (both tables), how each is translated for the company, and what counts as a missing parent
    v_cols := null; v_map := null; v_tcols := null; v_miss := null;
    for c in
      select col.column_name as name from information_schema.columns col
      where col.table_schema = 'rcm' and col.table_name = v_t
        and col.column_name not in ('id', 'master_id', 'master_pushed_at', 'master_hash', 'created_at', 'created_by',
                                    'updated_at', 'updated_by', 'walkthrough_video', 'owner', 'copied_from')
        and exists (select 1 from information_schema.columns x where x.table_schema = 'rcm' and x.table_name = v_m and x.column_name = col.column_name)
      order by col.ordinal_position
    loop
      if sp.fks ? c.name then
        v_fk := sp.fks->>c.name;
        v_par := ltrim(v_fk, '?');
        v_expr := rcm._master_map_expr(v_par, format('s.%I', c.name), p_master, p_target);
        if left(v_fk, 1) <> '?' then
          v_miss := concat_ws(' or ', v_miss, format('(s.%I is not null and %s is null)', c.name, v_expr));
        end if;
      else
        v_expr := format('s.%I', c.name);
      end if;
      v_cols  := concat_ws(', ', v_cols, quote_ident(c.name));
      v_map   := concat_ws(', ', v_map, v_expr);
      v_tcols := concat_ws(', ', v_tcols, format('t.%I', c.name));
    end loop;
    v_miss := coalesce(v_miss, 'false');

    v_nat := sp.natkey;
    for v_fk in select jsonb_object_keys(sp.fks) loop
      v_nat := replace(v_nat, '{' || v_fk || '}', rcm._master_map_expr(ltrim(sp.fks->>v_fk, '?'), format('s.%I', v_fk), p_master, p_target));
    end loop;
    v_label := replace(replace(sp.label, '{PAYER}', format('(select pp.name from rcm.%I pp where pp.id = s.payer_id)', p_master || 'payers')), '{M}', p_master);

    if v_has_id then
      v_key  := 's.id::text';
      v_link := 't.master_id = s.id';
      v_tid_e := 't.id::text';
      v_tid_m := 't.id = $4::bigint';
    else   -- task_configs: no id, matched by process + task name
      v_key  := 's.process || ''|'' || s.name';
      v_link := 't.process = s.process and t.name = s.name and t.master_hash is not null';
      v_tid_e := 't.ctid::text';
      v_tid_m := 't.ctid = $4::tid';
    end if;
    v_extra_ins_c := ''; v_extra_ins_v := ''; v_extra_upd := '';
    if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_t and column_name = 'created_by') then
      v_extra_ins_c := v_extra_ins_c || ', created_by'; v_extra_ins_v := v_extra_ins_v || ', ''HELIX_MASTER''';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_t and column_name = 'updated_at') then
      v_extra_upd := v_extra_upd || ', updated_at = $3';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = v_t and column_name = 'updated_by') then
      v_extra_upd := v_extra_upd || ', updated_by = ''HELIX_MASTER''';
    end if;

    for r in execute format('select %s as k, %s as label, md5(jsonb_build_array(%s)::text) as h, (%s) as missing from rcm.%I s where %s order by 1',
                            v_key, v_label, v_map, v_miss, v_m, sp.filter)
    loop
      v_tid := null; v_cur := null; v_last := null;
      execute format('select %s, md5(jsonb_build_array(%s)::text), t.master_hash from rcm.%I t, rcm.%I s where %s and %s = $1 limit 1',
                     v_tid_e, v_tcols, v_t, v_m, v_link, v_key)
        into v_tid, v_cur, v_last using r.k;

      if v_tid is not null then
        if v_last is not null and v_cur is distinct from v_last then
          v_kind := 'kept_changed';
        elsif v_cur = r.h then
          v_kind := 'unchanged';
        elsif r.missing then
          v_kind := 'skipped_parent';
        else
          begin
            execute format('update rcm.%I t set (%s) = (select %s from rcm.%I s where %s = $1), master_hash = $2, master_pushed_at = $3%s where %s',
                           v_t, v_cols, v_map, v_m, v_key, v_extra_upd, v_tid_m)
              using r.k, r.h, p_now, v_tid;
            v_kind := 'updated';
          exception when others then
            v_kind := 'conflict'; r.label := coalesce(r.label, '') || ' — ' || sqlerrm;
          end;
        end if;
      else
        execute format('select exists (select 1 from rcm.%I t, rcm.%I s where %s = $1 and t.master_hash is null and (%s))', v_t, v_m, v_key, v_nat)
          into v_own using r.k;
        if v_own then
          v_kind := 'kept_own';
        elsif r.missing then
          v_kind := 'skipped_parent';
        else
          begin
            if v_has_id then
              execute format('insert into rcm.%I (%s, master_id, master_hash, master_pushed_at%s) select %s, s.id, $2, $3%s from rcm.%I s where %s = $1',
                             v_t, v_cols, v_extra_ins_c, v_map, v_extra_ins_v, v_m, v_key)
                using r.k, r.h, p_now;
            else
              execute format('insert into rcm.%I (%s, master_hash, master_pushed_at) select %s, $2, $3 from rcm.%I s where %s = $1',
                             v_t, v_cols, v_map, v_m, v_key)
                using r.k, r.h, p_now;
            end if;
            v_kind := 'new';
          exception when others then
            v_kind := 'conflict'; r.label := coalesce(r.label, '') || ' — ' || sqlerrm;
          end;
        end if;
      end if;

      -- A new or updated SOP that is published in the master becomes a new version in the company
      if sp.tbl = 'sops' and v_kind in ('new', 'updated')
         and to_regclass(format('rcm.%I', p_target || 'sop_versions')) is not null then
        execute format('select t.id, t.status from rcm.%I t where t.master_id = $1::bigint', v_t) into v_sid, v_status using r.k;
        if v_status = 'published' then
          execute format('insert into rcm.%1$I (sop_id, version_no, snapshot, change_note, effective_date, requires_ack, published_by)
                          select t.id, coalesce((select max(v.version_no) from rcm.%1$I v where v.sop_id = t.id), 0) + 1,
                                 jsonb_build_object(''title'', t.title, ''summary'', t.summary, ''purpose'', t.purpose,
                                   ''audience_teams'', t.audience_teams, ''audience_notes'', t.audience_notes, ''prerequisites'', t.prerequisites,
                                   ''steps'', t.steps, ''expected_result'', t.expected_result, ''troubleshooting'', t.troubleshooting,
                                   ''walkthrough_video'', t.walkthrough_video),
                                 ''Updated from the Helix Hub master copy'', current_date, true, ''HELIX_MASTER''
                          from rcm.%2$I t where t.id = $1', p_target || 'sop_versions', v_t) using v_sid;
        end if;
      end if;

      v_res := rcm._mp_note(v_res, sp.section, sp.tbl, v_kind, r.label);
    end loop;
  end loop;
  return v_res;
end;
$$;
revoke all on function rcm._master_push_company(text, text, text[], timestamptz) from public, anon, authenticated;

-- Counts only (no names), for the logs
create or replace function rcm._mp_counts(p_res jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_object_agg(key, value - 'names'), '{}'::jsonb) from jsonb_each(p_res);
$$;

-- Company code → table prefix ('__home__' = home). Null = not found or the master itself.
create or replace function rcm._master_target(p_code text)
returns text
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select case when upper(trim(p_code)) = '__HOME__' then ''
              else (select prefix from rcm.companies where upper(code) = upper(trim(p_code)) and not is_master) end;
$$;
revoke all on function rcm._master_target(text) from public, anon, authenticated;

-- ── Preview: the real push, then cancelled ────────────────────────────────────
create or replace function rcm.owner_master_preview(p_by_user text, p_by_password text, p_code text, p_sections text[])
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m      rcm.companies;
  v_tgt  text;
  v_res  jsonb;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  select * into m from rcm.companies where is_master;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_master'); end if;
  v_tgt := rcm._master_target(p_code);
  if v_tgt is null then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;
  if coalesce(array_length(p_sections, 1), 0) = 0
     or not p_sections <@ array['payers', 'denials', 'codes', 'sops', 'targets'] then
    return jsonb_build_object('ok', false, 'error', 'bad_sections');
  end if;
  begin
    v_res := rcm._master_push_company(m.prefix, v_tgt, p_sections, now());
    raise exception using errcode = 'HH001', message = 'preview only';
  exception when sqlstate 'HH001' then
    null;   -- everything above is undone; v_res keeps the result
  end;
  return jsonb_build_object('ok', true, 'code', p_code, 'result', v_res);
end;
$$;
revoke all on function rcm.owner_master_preview(text, text, text, text[]) from public;
grant execute on function rcm.owner_master_preview(text, text, text, text[]) to anon, authenticated;

-- ── Push (one company per call, all or nothing) ───────────────────────────────
create or replace function rcm.owner_master_push(p_by_user text, p_by_password text, p_code text, p_sections text[])
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m       rcm.companies;
  o       rcm.helix_owners;
  v_tgt   text;
  v_code  text := case when upper(trim(p_code)) = '__HOME__' then '__home__' else upper(trim(p_code)) end;
  v_res   jsonb;
  v_cnt   jsonb;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  select * into m from rcm.companies where is_master;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_master'); end if;
  v_tgt := rcm._master_target(p_code);
  if v_tgt is null then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;
  if coalesce(array_length(p_sections, 1), 0) = 0
     or not p_sections <@ array['payers', 'denials', 'codes', 'sops', 'targets'] then
    return jsonb_build_object('ok', false, 'error', 'bad_sections');
  end if;

  v_res := rcm._master_push_company(m.prefix, v_tgt, p_sections, now());
  v_cnt := rcm._mp_counts(v_res);

  select * into o from rcm.helix_owners where username = upper(trim(p_by_user));
  insert into rcm.helix_master_pushes (owner, company_code, sections, summary) values (o.username, v_code, p_sections, v_cnt);
  perform rcm._owner_log(p_by_user, 'master_push', v_code, array_to_string(p_sections, ', '), v_cnt);
  if to_regclass(format('rcm.%I', v_tgt || 'audit_log')) is not null then
    execute format('insert into rcm.%I (actor_emp_id, actor_name, actor_role, action, details) values ($1, $2, $3, $4, $5)', v_tgt || 'audit_log')
      using 'HELIX_OWNER', format('%s (Helix Hub owner %s)', o.name, o.username), 'owner', 'master_push',
            jsonb_build_object('sections', p_sections, 'summary', v_cnt);
  end if;
  return jsonb_build_object('ok', true, 'code', v_code, 'result', v_res);
end;
$$;
revoke all on function rcm.owner_master_push(text, text, text, text[]) from public;
grant execute on function rcm.owner_master_push(text, text, text, text[]) to anon, authenticated;

-- ── Push history ────────────────────────────────────────────────────────────
create or replace function rcm.owner_master_push_history(p_by_user text, p_by_password text, p_limit int default 50)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.pushed_at desc)
                   from (select * from rcm.helix_master_pushes order by pushed_at desc limit greatest(1, least(coalesce(p_limit, 50), 500))) h), '[]'::jsonb);
end;
$$;
revoke all on function rcm.owner_master_push_history(text, text, int) from public;
grant execute on function rcm.owner_master_push_history(text, text, int) to anon, authenticated;

select rcm.protect_all_tables();

notify pgrst, 'reload schema';
