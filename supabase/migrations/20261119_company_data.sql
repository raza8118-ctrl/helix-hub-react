-- ═══════════════════════════════════════════════════════════════════════════
-- Owner Company Data → "Save to Master" (PO request 2026-11-10), Stage 3. Migration 54.
-- Run once in Supabase → SQL Editor. Additive only (new functions); safe to re-run. Migration 52's functions are untouched.
--
--   Like Copy to Master (migration 52), but from ANY company (home or an added company), plus code lists:
--     payer    → the payer + its plans, payer IDs, contacts, standard limits, notes, auth rules, current forms
--     code     → the denial code + its common steps
--     sop      → the SOP (not client SOPs) + its category / software / task (by name, or added) + its current published
--                version (a new master version) + its screenshots / videos
--     ref_code → the revenue / HIPPS / ICD-10 code
--   • Preview first (owner_master_copy_from_preview); then owner_master_copy_from with mode 'add' or 'update'.
--     Already in the master + 'add' → skipped. Nothing is ever deleted; the company's rows are not changed.
--   • File paths move from the company's folder (co_xxx/…) to the master's (co_master/…); the app copies the files.
--   • Owner log: one "master_copy" line naming the company, plus the usual master change history.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function rcm._lib_copy_from(p_prefix text, p_kind text, p_id bigint, p_mode text, p_apply boolean, p_owner text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m        text := (select prefix from rcm.companies where is_master);
  s        text := coalesce(p_prefix, '');
  mf       text;
  sf       text;
  v_from   text;
  v_label  text;
  v_mid    bigint;
  v_exists boolean;
  v_added  int := 0;
  v_upd    int := 0;
  v_files  jsonb := '[]'::jsonb;
  v_detail jsonb := '{}'::jsonb;
  c        record;
  r        record;
  v_tid    bigint;
  v_set    jsonb;
  v_plans  jsonb := '{}'::jsonb;
  src      jsonb;
  v_cat    bigint; v_sw bigint; v_task bigint;
  v_ver    jsonb;
  v_text   text;
  v_path   text;
begin
  if m is null then return jsonb_build_object('ok', false, 'error', 'no_master'); end if;
  if s = m then return jsonb_build_object('ok', false, 'error', 'is_master'); end if;
  mf := rtrim(m, '_') || '/';
  sf := case when s = '' then '' else rtrim(s, '_') || '/' end;
  v_from := coalesce((select name from rcm.companies where prefix = s), 'the home company');

  if p_kind = 'payer' then
    execute format('select to_jsonb(p) from rcm.%I p where p.id = $1', s || 'payers') into src using p_id;
    if src is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_label := src->>'name';
    execute format('select id from rcm.%I where lower(name) = lower($1) order by id limit 1', m || 'payers') into v_mid using src->>'name';
    v_exists := v_mid is not null;
    if v_exists and p_mode <> 'update' then return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', true, 'skipped', true); end if;
    if p_apply then v_mid := rcm._lib_put_row(s || 'payers', m || 'payers', p_id, '{}'::jsonb, v_mid); end if;
    if v_exists then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
    for c in select * from rcm._lib_payer_children() order by ord loop
      continue when to_regclass(format('rcm.%I', s || c.tbl)) is null or to_regclass(format('rcm.%I', m || c.tbl)) is null;
      for r in execute format('select s.* from rcm.%I s where s.payer_id = $1 and %s order by s.id', s || c.tbl, c.filter) using p_id loop
        v_tid := null;
        if v_mid is not null then
          execute format('select t.id from rcm.%I t, rcm.%I s where s.id = $1 and t.payer_id = $2 and (%s) order by t.id limit 1', m || c.tbl, s || c.tbl, c.natkey)
            into v_tid using r.id, v_mid;
        end if;
        if v_tid is not null then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
        if p_apply then
          v_set := jsonb_build_object('payer_id', v_mid);
          if c.tbl <> 'payer_plans' then v_set := v_set || jsonb_build_object('plan_id', v_plans->>(r.plan_id::text)); end if;
          if c.tbl = 'payer_forms' then
            v_path := null;
            if r.file_path is not null then
              v_path := case when r.file_path like mf || '%' then r.file_path
                             when sf <> '' and r.file_path like sf || '%' then mf || substr(r.file_path, length(sf) + 1)
                             else mf || r.file_path end;
              if v_path <> r.file_path then
                v_files := v_files || jsonb_build_object('bucket', 'payer-forms', 'from', r.file_path, 'to', v_path);
              end if;
            end if;
            v_set := v_set || jsonb_build_object('family_id', null, 'superseded_at', null, 'file_path', v_path);
          end if;
          v_tid := rcm._lib_put_row(s || c.tbl, m || c.tbl, r.id, v_set, v_tid);
          if c.tbl = 'payer_plans' then v_plans := v_plans || jsonb_build_object(r.id::text, v_tid); end if;
        end if;
        v_detail := v_detail || jsonb_build_object(c.tbl, coalesce((v_detail->>c.tbl)::int, 0) + 1);
      end loop;
    end loop;

  elsif p_kind = 'code' then
    execute format('select to_jsonb(d) from rcm.%I d where d.id = $1', s || 'denial_codes') into src using p_id;
    if src is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_label := upper(src->>'code_type') || ' ' || (src->>'code');
    execute format('select id from rcm.%I where code_type = $1 and upper(code) = upper($2) limit 1', m || 'denial_codes') into v_mid using src->>'code_type', src->>'code';
    v_exists := v_mid is not null;
    if v_exists and p_mode <> 'update' then return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', true, 'skipped', true); end if;
    if p_apply then v_mid := rcm._lib_put_row(s || 'denial_codes', m || 'denial_codes', p_id, '{}'::jsonb, v_mid); end if;
    if v_exists then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
    for r in execute format('select x.* from rcm.%I x where x.code_id = $1 and x.scope = ''common'' and x.client_id is null and x.active is not false order by x.id', s || 'denial_steps') using p_id loop
      v_tid := null;
      if v_mid is not null then
        execute format('select t.id from rcm.%I t where t.code_id = $1 and t.scope = ''common'' and t.client_id is null order by t.id limit 1', m || 'denial_steps')
          into v_tid using v_mid;
      end if;
      if v_tid is not null then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
      if p_apply then
        perform rcm._lib_put_row(s || 'denial_steps', m || 'denial_steps', r.id, jsonb_build_object('code_id', v_mid, 'sop_id', null, 'payer_id', null), v_tid);
      end if;
      v_detail := v_detail || jsonb_build_object('denial_steps', coalesce((v_detail->>'denial_steps')::int, 0) + 1);
    end loop;

  elsif p_kind = 'sop' then
    execute format('select to_jsonb(x) from rcm.%I x where x.id = $1', s || 'sops') into src using p_id;
    if src is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if src->>'client_id' is not null then return jsonb_build_object('ok', false, 'error', 'client_sop'); end if;
    v_label := src->>'title';
    for r in execute format('select sc.id as cat_id, sc.name as cat_name, sw.id as sw_id, sw.name as sw_name, st.id as task_id, st.name as task_name
                             from rcm.%I st join rcm.%I sw on sw.id = st.software_id join rcm.%I sc on sc.id = sw.category_id where st.id = $1',
                             s || 'sop_tasks', s || 'sop_software', s || 'sop_categories') using (src->>'task_id')::bigint loop
      execute format('select id from rcm.%I where lower(name) = lower($1) order by id limit 1', m || 'sop_categories') into v_cat using r.cat_name;
      if v_cat is null then
        v_detail := v_detail || '{"new category": 1}';
        if p_apply then v_cat := rcm._lib_put_row(s || 'sop_categories', m || 'sop_categories', r.cat_id, '{}'::jsonb, null); end if;
      end if;
      if v_cat is not null then
        execute format('select id from rcm.%I where category_id = $1 and lower(name) = lower($2) order by id limit 1', m || 'sop_software') into v_sw using v_cat, r.sw_name;
      end if;
      if v_sw is null then
        v_detail := v_detail || '{"new software": 1}';
        if p_apply then v_sw := rcm._lib_put_row(s || 'sop_software', m || 'sop_software', r.sw_id, jsonb_build_object('category_id', v_cat), null); end if;
      end if;
      if v_sw is not null then
        execute format('select id from rcm.%I where software_id = $1 and lower(name) = lower($2) order by id limit 1', m || 'sop_tasks') into v_task using v_sw, r.task_name;
      end if;
      if v_task is null then
        v_detail := v_detail || '{"new task": 1}';
        if p_apply then v_task := rcm._lib_put_row(s || 'sop_tasks', m || 'sop_tasks', r.task_id, jsonb_build_object('software_id', v_sw), null); end if;
      end if;
    end loop;
    if v_task is not null then
      execute format('select id from rcm.%I where task_id = $1 and lower(title) = lower($2) and client_id is null order by id limit 1', m || 'sops') into v_mid using v_task, src->>'title';
    end if;
    v_exists := v_mid is not null;
    if v_exists and p_mode <> 'update' then return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', true, 'skipped', true); end if;
    if v_exists then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
    if p_apply then
      -- media paths in the steps / walkthrough: company folder → master folder
      v_text := coalesce(src->'steps', '[]'::jsonb)::text;
      if sf <> '' then v_text := replace(v_text, '"path": "' || sf, '"path": "'); end if;
      v_set := jsonb_build_object('task_id', v_task, 'owner', null, 'copied_from', null, 'client_id', null,
                 'steps', replace(v_text, '"path": "', '"path": "' || mf)::jsonb);
      if src->'walkthrough_video' is not null and src->'walkthrough_video' <> 'null'::jsonb then
        v_text := (src->'walkthrough_video')::text;
        if sf <> '' then v_text := replace(v_text, '"path": "' || sf, '"path": "'); end if;
        v_set := v_set || jsonb_build_object('walkthrough_video', replace(v_text, '"path": "', '"path": "' || mf)::jsonb);
      else
        v_set := v_set || jsonb_build_object('walkthrough_video', null);
      end if;
      v_mid := rcm._lib_put_row(s || 'sops', m || 'sops', p_id, v_set, v_mid);
    end if;
    -- current published version → a new master version
    if to_regclass(format('rcm.%I', s || 'sop_versions')) is not null then
      execute format('select to_jsonb(x) from rcm.%I x where x.sop_id = $1 and x.effective_date <= current_date order by x.version_no desc limit 1', s || 'sop_versions')
        into v_ver using p_id;
    end if;
    if v_ver is not null then
      v_detail := v_detail || jsonb_build_object('version', (v_ver->>'version_no')::int);
      if p_apply then
        v_text := coalesce(v_ver->'snapshot', '{}'::jsonb)::text;
        if sf <> '' then v_text := replace(v_text, '"path": "' || sf, '"path": "'); end if;
        execute format('insert into rcm.%1$I (sop_id, version_no, snapshot, change_note, effective_date, requires_ack, published_by)
                        values ($1, coalesce((select max(version_no) from rcm.%1$I where sop_id = $1), 0) + 1, $2, $3, current_date, true, $4)', m || 'sop_versions')
          using v_mid, replace(v_text, '"path": "', '"path": "' || mf)::jsonb, format('Copied from %s (version %s)', v_from, v_ver->>'version_no'), p_owner;
        execute format('update rcm.%I set status = ''published'' where id = $1', m || 'sops') using v_mid;
      end if;
    end if;
    -- screenshots / videos
    if to_regclass(format('rcm.%I', s || 'sop_media')) is not null then
      for r in execute format('select x.* from rcm.%I x where x.sop_id = $1 and x.active is not false order by x.id', s || 'sop_media') using p_id loop
        v_detail := v_detail || jsonb_build_object('sop_media', coalesce((v_detail->>'sop_media')::int, 0) + 1);
        if p_apply then
          v_path := case when r.path like mf || '%' then r.path
                         when sf <> '' and r.path like sf || '%' then mf || substr(r.path, length(sf) + 1)
                         else mf || r.path end;
          execute format('select id from rcm.%I where sop_id = $1 and path = $2 limit 1', m || 'sop_media') into v_tid using v_mid, v_path;
          if v_tid is null then
            perform rcm._lib_put_row(s || 'sop_media', m || 'sop_media', r.id, jsonb_build_object('sop_id', v_mid, 'path', v_path), null);
          end if;
          if v_path <> r.path then
            v_files := v_files || jsonb_build_object('bucket', 'sop-media', 'from', r.path, 'to', v_path);
          end if;
        end if;
      end loop;
    end if;

  elsif p_kind = 'ref_code' then
    execute format('select to_jsonb(x) from rcm.%I x where x.id = $1', s || 'ref_codes') into src using p_id;
    if src is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_label := upper(src->>'code_set') || ' ' || (src->>'code');
    execute format('select id from rcm.%I where code_set = $1 and code = $2 limit 1', m || 'ref_codes') into v_mid using src->>'code_set', src->>'code';
    v_exists := v_mid is not null;
    if v_exists and p_mode <> 'update' then return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', true, 'skipped', true); end if;
    if v_exists then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
    if p_apply then v_mid := rcm._lib_put_row(s || 'ref_codes', m || 'ref_codes', p_id, '{}'::jsonb, v_mid); end if;

  else
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;

  if p_apply then
    perform rcm._owner_log(p_owner, 'master_copy', p_code, v_label,
      jsonb_build_object('kind', p_kind, 'mode', p_mode, 'from', v_from, 'updated_master', v_exists, 'detail', v_detail));
  end if;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'from', v_from, 'exists', v_exists, 'added', v_added, 'updated', v_upd,
                            'detail', v_detail, 'files', v_files, 'master_id', v_mid);
end;
$$;
revoke all on function rcm._lib_copy_from(text, text, bigint, text, boolean, text, text) from public, anon, authenticated;

-- ── Owner calls (company by its code; '__home__' = the home company) ────────────
create or replace function rcm._lib_prefix_of(p_code text)
returns text
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select case when p_code = '__home__' then '' else (select prefix from rcm.companies where code = p_code and not coalesce(is_master, false)) end;
$$;
revoke all on function rcm._lib_prefix_of(text) from public, anon, authenticated;

create or replace function rcm.owner_master_copy_from_preview(p_by_user text, p_by_password text, p_code text, p_kind text, p_id bigint)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  v_prefix := rcm._lib_prefix_of(p_code);
  if v_prefix is null then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;
  return rcm._lib_copy_from(v_prefix, p_kind, p_id, 'update', false, upper(trim(p_by_user)), p_code);
end;
$$;
revoke all on function rcm.owner_master_copy_from_preview(text, text, text, text, bigint) from public;
grant execute on function rcm.owner_master_copy_from_preview(text, text, text, text, bigint) to anon, authenticated;

create or replace function rcm.owner_master_copy_from(p_by_user text, p_by_password text, p_code text, p_kind text, p_id bigint, p_mode text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_prefix text;
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if p_mode not in ('add', 'update') then return jsonb_build_object('ok', false, 'error', 'bad_mode'); end if;
  v_prefix := rcm._lib_prefix_of(p_code);
  if v_prefix is null then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;
  return rcm._lib_copy_from(v_prefix, p_kind, p_id, p_mode, true, upper(trim(p_by_user)), p_code);
end;
$$;
revoke all on function rcm.owner_master_copy_from(text, text, text, text, bigint, text) from public;
grant execute on function rcm.owner_master_copy_from(text, text, text, text, bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';
