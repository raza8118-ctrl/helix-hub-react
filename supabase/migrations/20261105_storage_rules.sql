-- ═══════════════════════════════════════════════════════════════════════════
-- Security stage 5 — file storage rules (PO approved 2026-11-01)
-- Run once in Supabase → SQL Editor. Safe to re-run. No "Sync structure" needed. No files are moved or deleted.
--
--   • The 8 open storage rules (anyone with the public key could read / upload in all 4 buckets, every company) are
--     replaced. Opening (signed links) or uploading a file now needs a valid session for that file's company, or the
--     owner key — the same check and per-company switch as the table rules (rcm._allowed, helix_rls_settings).
--   • A file's company comes from its first folder: added companies use co_<code>/…, the home company has no
--     company folder (rcm._storage_prefix).
--   • feed-media (Team Feed / announcement photos) becomes private — the app shows photos through 1-hour signed links.
--     PO said yes ("Go", 2026-11-01).
--   • Nothing can be deleted or overwritten through the public key (no delete / update rules).
--   • Verified 2026-11-01 with a probe bucket: Supabase Storage passes the x-helix-session header to these rules.
-- ═══════════════════════════════════════════════════════════════════════════

-- Which company a stored file belongs to ('' = home)
create or replace function rcm._storage_prefix(p_name text)
returns text
language sql stable security definer
set search_path = rcm, pg_temp
as $$
  select coalesce((select c.prefix from rcm.companies c where rtrim(c.prefix, '_') = split_part(p_name, '/', 1)), '');
$$;
revoke all on function rcm._storage_prefix(text) from public;
grant execute on function rcm._storage_prefix(text) to anon, authenticated;

-- The open rules being replaced
drop policy if exists "Public read access for feed-media" on storage.objects;
drop policy if exists "Public upload access for feed-media" on storage.objects;
drop policy if exists payer_bulletins_insert on storage.objects;
drop policy if exists payer_bulletins_read on storage.objects;
drop policy if exists payer_forms_insert on storage.objects;
drop policy if exists payer_forms_read on storage.objects;
drop policy if exists sop_media_insert on storage.objects;
drop policy if exists sop_media_read on storage.objects;

-- Read (signed links, downloads) + upload, per bucket
do $$
declare
  b text;
begin
  foreach b in array array['feed-media', 'sop-media', 'payer-forms', 'payer-bulletins'] loop
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'helix_read_' || replace(b, '-', '_')) then
      execute format('create policy %I on storage.objects for select to anon, authenticated
                      using (bucket_id = %L and rcm._allowed(rcm._storage_prefix(name)))',
                     'helix_read_' || replace(b, '-', '_'), b);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'helix_add_' || replace(b, '-', '_')) then
      execute format('create policy %I on storage.objects for insert to anon, authenticated
                      with check (bucket_id = %L and rcm._allowed(rcm._storage_prefix(name)))',
                     'helix_add_' || replace(b, '-', '_'), b);
    end if;
  end loop;
end $$;

-- Feed photos: private (shown through signed links)
update storage.buckets set public = false where id = 'feed-media' and public;
