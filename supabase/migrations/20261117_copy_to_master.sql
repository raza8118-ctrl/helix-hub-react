-- ═══════════════════════════════════════════════════════════════════════════
-- Master Library → "Copy to Master" (PO request 2026-11-10), Stage 4. Migration 52.
-- Run once in Supabase → SQL Editor. Additive only (new functions); safe to re-run.
--
--   The owner promotes an item of the HOME company into the Master Library:
--     payer  → the payer + its plans, payer IDs, contacts, standard (non-client) limits, notes, auth rules, forms
--     code   → the denial code + its common steps
--     sop    → the SOP (not client SOPs) + its category / software / task (found by name or added) + its current
--              published version (a new master version) + its screenshots / videos
--   • Preview first (owner_master_copy_preview): is it already in the master, and what would be added / updated.
--   • Copy (owner_master_copy, mode 'add' or 'update'): already in the master + 'add' → skipped; 'update' → the master's
--     matching rows are updated, missing ones added. Nothing is ever deleted, and the home company's rows are not changed.
--   • File paths get the master folder (co_master/…); the app then copies the files (list returned).
--   • Owner log: one "master_copy" line, plus the usual master change history.
-- ═══════════════════════════════════════════════════════════════════════════

-- Copy one row's content from a home table into a master table (insert, or update p_dst_id). p_set overrides columns.
create or replace function rcm._lib_put_row(p_src text, p_dst text, p_id bigint, p_set jsonb, p_dst_id bigint default null)
returns bigint
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  v_cols text;
  v_row  jsonb;
  v_id   bigint;
  v_upd  text := '';
begin
  if exists (select 1 from information_schema.columns where table_schema = 'rcm' and table_name = p_dst and column_name = 'updated_at') then
    v_upd := ', updated_at = now()';
  end if;
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'rcm' and c.table_name = p_dst
    and c.column_name not in ('id', 'master_id', 'master_pushed_at', 'master_hash', 'created_at', 'updated_at')
    and exists (select 1 from information_schema.columns s where s.table_schema = 'rcm' and s.table_name = p_src and s.column_name = c.column_name);
  execute format('select to_jsonb(s) from rcm.%I s where s.id = $1', p_src) into v_row using p_id;
  if v_row is null then return null; end if;
  v_row := v_row || coalesce(p_set, '{}'::jsonb);
  if p_dst_id is null then
    execute format('insert into rcm.%1$I (%2$s) select %2$s from jsonb_populate_record(null::rcm.%1$I, $1) returning id', p_dst, v_cols)
      into v_id using v_row;
  else
    execute format('update rcm.%1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::rcm.%1$I, $1))%3$s where id = $2', p_dst, v_cols, v_upd)
      using v_row, p_dst_id;
    v_id := p_dst_id;
  end if;
  return v_id;
end;
$$;
revoke all on function rcm._lib_put_row(text, text, bigint, jsonb, bigint) from public, anon, authenticated;

-- Payer child tables: how a master row is recognised as the same one (t = master, s = home)
create or replace function rcm._lib_payer_children()
returns table (ord int, tbl text, natkey text, filter text)
language sql immutable
as $$
  values
    (1, 'payer_plans',      'lower(t.plan_name) = lower(s.plan_name)', 'true'),
    (2, 'payer_ids',        't.electronic_payer_id = s.electronic_payer_id and coalesce(t.clearinghouse, '''') = coalesce(s.clearinghouse, '''') and coalesce(t.transaction_type, '''') = coalesce(s.transaction_type, '''')', 'true'),
    (3, 'payer_contacts',   't.department = s.department and coalesce(t.phone, '''') = coalesce(s.phone, '''')', 'true'),
    (4, 'payer_limits',     't.limit_type = s.limit_type and coalesce(t.level, 0) = coalesce(s.level, 0) and t.client_id is null', 's.client_id is null'),
    (5, 'payer_notes',      't.note = s.note', 'true'),
    (6, 'payer_auth_rules', 'lower(coalesce(t.service, '''')) = lower(coalesce(s.service, ''''))', 'true'),
    (7, 'payer_forms',      't.form_type = s.form_type and lower(t.title) = lower(s.title) and t.version_date is not distinct from s.version_date', 's.superseded_at is null');
$$;

-- ── The work (internal): p_apply false = only count what would happen ───────────────────
create or replace function rcm._lib_copy(p_kind text, p_id bigint, p_mode text, p_apply boolean, p_owner text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
declare
  m        text := (select prefix from rcm.companies where is_master);
  mf       text;
  v_label  text;
  v_mid    bigint;          -- the master item (existing or new)
  v_exists boolean;
  v_added  int := 0;
  v_upd    int := 0;
  v_files  jsonb := '[]'::jsonb;
  v_detail jsonb := '{}'::jsonb;
  c        record;
  r        record;
  v_tid    bigint;
  v_set    jsonb;
  v_plans  jsonb := '{}'::jsonb;   -- home plan id → master plan id
  src      jsonb;
  v_cat    bigint; v_sw bigint; v_task bigint;
  v_ver    record;
  v_snap   jsonb;
begin
  if m is null then return jsonb_build_object('ok', false, 'error', 'no_master'); end if;
  mf := rtrim(m, '_') || '/';

  if p_kind = 'payer' then
    select to_jsonb(p) into src from rcm.payers p where p.id = p_id;
    if src is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_label := src->>'name';
    execute format('select id from rcm.%I where lower(name) = lower($1) order by id limit 1', m || 'payers') into v_mid using src->>'name';
    v_exists := v_mid is not null;
    if v_exists and p_mode <> 'update' then return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', true, 'skipped', true); end if;
    if p_apply then v_mid := rcm._lib_put_row('payers', m || 'payers', p_id, '{}'::jsonb, v_mid); end if;
    if v_exists then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
    for c in select * from rcm._lib_payer_children() order by ord loop
      for r in execute format('select s.* from rcm.%I s where s.payer_id = $1 and %s order by s.id', c.tbl, c.filter) using p_id loop
        v_tid := null;
        if v_mid is not null then
          execute format('select t.id from rcm.%I t, rcm.%I s where s.id = $1 and t.payer_id = $2 and (%s) order by t.id limit 1', m || c.tbl, c.tbl, c.natkey)
            into v_tid using r.id, v_mid;
        end if;
        if v_tid is not null then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
        if p_apply then
          v_set := jsonb_build_object('payer_id', v_mid);
          if c.tbl <> 'payer_plans' then v_set := v_set || jsonb_build_object('plan_id', v_plans->>(r.plan_id::text)); end if;
          if c.tbl = 'payer_forms' then
            v_set := v_set || jsonb_build_object('family_id', null, 'superseded_at', null,
                       'file_path', case when r.file_path is null or r.file_path like mf || '%' then r.file_path else mf || r.file_path end);
            if r.file_path is not null and r.file_path not like mf || '%' then
              v_files := v_files || jsonb_build_object('bucket', 'payer-forms', 'from', r.file_path, 'to', mf || r.file_path);
            end if;
          end if;
          v_tid := rcm._lib_put_row(c.tbl, m || c.tbl, r.id, v_set, v_tid);
          if c.tbl = 'payer_plans' then v_plans := v_plans || jsonb_build_object(r.id::text, v_tid); end if;
        end if;
        v_detail := v_detail || jsonb_build_object(c.tbl, coalesce((v_detail->>c.tbl)::int, 0) + 1);
      end loop;
    end loop;

  elsif p_kind = 'code' then
    select to_jsonb(d) into src from rcm.denial_codes d where d.id = p_id;
    if src is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_label := upper(src->>'code_type') || ' ' || (src->>'code');
    execute format('select id from rcm.%I where code_type = $1 and upper(code) = upper($2) limit 1', m || 'denial_codes') into v_mid using src->>'code_type', src->>'code';
    v_exists := v_mid is not null;
    if v_exists and p_mode <> 'update' then return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', true, 'skipped', true); end if;
    if p_apply then v_mid := rcm._lib_put_row('denial_codes', m || 'denial_codes', p_id, '{}'::jsonb, v_mid); end if;
    if v_exists then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
    for r in select s.* from rcm.denial_steps s where s.code_id = p_id and s.scope = 'common' and s.client_id is null and s.active is not false order by s.id loop
      v_tid := null;
      if v_mid is not null then
        execute format('select t.id from rcm.%I t where t.code_id = $1 and t.scope = ''common'' and t.client_id is null order by t.id limit 1', m || 'denial_steps')
          into v_tid using v_mid;
      end if;
      if v_tid is not null then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
      if p_apply then
        perform rcm._lib_put_row('denial_steps', m || 'denial_steps', r.id, jsonb_build_object('code_id', v_mid, 'sop_id', null, 'payer_id', null), v_tid);
      end if;
      v_detail := v_detail || jsonb_build_object('denial_steps', coalesce((v_detail->>'denial_steps')::int, 0) + 1);
    end loop;

  elsif p_kind = 'sop' then
    select to_jsonb(s) into src from rcm.sops s where s.id = p_id;
    if src is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if src->>'client_id' is not null then return jsonb_build_object('ok', false, 'error', 'client_sop'); end if;
    v_label := src->>'title';
    -- the tree: category → software → task, found in the master by name or added
    for r in select c.id as cat_id, c.name as cat_name, w.id as sw_id, w.name as sw_name, t.id as task_id, t.name as task_name
             from rcm.sop_tasks t join rcm.sop_software w on w.id = t.software_id join rcm.sop_categories c on c.id = w.category_id
             where t.id = (src->>'task_id')::bigint loop
      execute format('select id from rcm.%I where lower(name) = lower($1) order by id limit 1', m || 'sop_categories') into v_cat using r.cat_name;
      if v_cat is null then
        v_detail := v_detail || '{"new category": 1}';
        if p_apply then v_cat := rcm._lib_put_row('sop_categories', m || 'sop_categories', r.cat_id, '{}'::jsonb, null); end if;
      end if;
      if v_cat is not null then
        execute format('select id from rcm.%I where category_id = $1 and lower(name) = lower($2) order by id limit 1', m || 'sop_software') into v_sw using v_cat, r.sw_name;
      end if;
      if v_sw is null then
        v_detail := v_detail || '{"new software": 1}';
        if p_apply then v_sw := rcm._lib_put_row('sop_software', m || 'sop_software', r.sw_id, jsonb_build_object('category_id', v_cat), null); end if;
      end if;
      if v_sw is not null then
        execute format('select id from rcm.%I where software_id = $1 and lower(name) = lower($2) order by id limit 1', m || 'sop_tasks') into v_task using v_sw, r.task_name;
      end if;
      if v_task is null then
        v_detail := v_detail || '{"new task": 1}';
        if p_apply then v_task := rcm._lib_put_row('sop_tasks', m || 'sop_tasks', r.task_id, jsonb_build_object('software_id', v_sw), null); end if;
      end if;
    end loop;
    if v_task is not null then
      execute format('select id from rcm.%I where task_id = $1 and lower(title) = lower($2) and client_id is null order by id limit 1', m || 'sops') into v_mid using v_task, src->>'title';
    end if;
    v_exists := v_mid is not null;
    if v_exists and p_mode <> 'update' then return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', true, 'skipped', true); end if;
    if v_exists then v_upd := v_upd + 1; else v_added := v_added + 1; end if;
    if p_apply then
      v_mid := rcm._lib_put_row('sops', m || 'sops', p_id, jsonb_build_object(
                 'task_id', v_task, 'owner', null, 'copied_from', null, 'client_id', null,
                 'steps', replace(coalesce(src->'steps', '[]'::jsonb)::text, '"path": "', '"path": "' || mf)::jsonb,
                 'walkthrough_video', case when src->'walkthrough_video' is null or src->'walkthrough_video' = 'null'::jsonb then null
                                           else replace((src->'walkthrough_video')::text, '"path": "', '"path": "' || mf)::jsonb end), v_mid);
    end if;
    -- current published version → a new master version (what company readers will see)
    select v.* into v_ver from rcm.sop_versions v where v.sop_id = p_id and v.effective_date <= current_date order by v.version_no desc limit 1;
    if found then
      v_snap := replace(v_ver.snapshot::text, '"path": "', '"path": "' || mf)::jsonb;
      v_detail := v_detail || jsonb_build_object('version', v_ver.version_no);
      if p_apply then
        execute format('insert into rcm.%1$I (sop_id, version_no, snapshot, change_note, effective_date, requires_ack, published_by)
                        values ($1, coalesce((select max(version_no) from rcm.%1$I where sop_id = $1), 0) + 1, $2, $3, current_date, true, $4)', m || 'sop_versions')
          using v_mid, v_snap, format('Copied from the home company (version %s)', v_ver.version_no), p_owner;
        execute format('update rcm.%I set status = ''published'' where id = $1', m || 'sops') using v_mid;
      end if;
    end if;
    -- screenshots / videos
    for r in select s.* from rcm.sop_media s where s.sop_id = p_id and s.active is not false order by s.id loop
      v_detail := v_detail || jsonb_build_object('sop_media', coalesce((v_detail->>'sop_media')::int, 0) + 1);
      if p_apply then
        execute format('select id from rcm.%I where sop_id = $1 and path = $2 limit 1', m || 'sop_media') into v_tid using v_mid, mf || r.path;
        if v_tid is null then
          perform rcm._lib_put_row('sop_media', m || 'sop_media', r.id, jsonb_build_object('sop_id', v_mid, 'path', mf || r.path), null);
        end if;
        v_files := v_files || jsonb_build_object('bucket', 'sop-media', 'from', r.path, 'to', mf || r.path);
      end if;
    end loop;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;

  if p_apply then
    perform rcm._owner_log(p_owner, 'master_copy', '__home__', v_label,
      jsonb_build_object('kind', p_kind, 'mode', p_mode, 'updated_master', v_exists, 'detail', v_detail));
  end if;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'label', v_label, 'exists', v_exists, 'added', v_added, 'updated', v_upd,
                            'detail', v_detail, 'files', v_files, 'master_id', v_mid);
end;
$$;
revoke all on function rcm._lib_copy(text, bigint, text, boolean, text) from public, anon, authenticated;

-- ── Owner calls ─────────────────────────────────────────────────────────────
create or replace function rcm.owner_master_copy_preview(p_by_user text, p_by_password text, p_kind text, p_id bigint)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  return rcm._lib_copy(p_kind, p_id, 'update', false, upper(trim(p_by_user)));
end;
$$;
revoke all on function rcm.owner_master_copy_preview(text, text, text, bigint) from public;
grant execute on function rcm.owner_master_copy_preview(text, text, text, bigint) to anon, authenticated;

create or replace function rcm.owner_master_copy(p_by_user text, p_by_password text, p_kind text, p_id bigint, p_mode text)
returns jsonb
language plpgsql security definer
set search_path = rcm, pg_temp
as $$
begin
  if not rcm._is_owner(p_by_user, p_by_password) then raise exception 'Not authorised'; end if;
  if p_mode not in ('add', 'update') then return jsonb_build_object('ok', false, 'error', 'bad_mode'); end if;
  return rcm._lib_copy(p_kind, p_id, p_mode, true, upper(trim(p_by_user)));
end;
$$;
revoke all on function rcm.owner_master_copy(text, text, text, bigint, text) from public;
grant execute on function rcm.owner_master_copy(text, text, text, bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';
