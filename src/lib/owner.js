// Owner Console 2.0 (PO request 2026-10-29): owner-only database calls (each checks the owner password inside the
// database) and the per-company numbers the console shows. Company tables are read directly with the company's
// table prefix ('' = home company). Names, counts and dates only — never patient data.
import { supabase } from './supabase';

export const HOME_CODE = '__home__';
export const codeOf = c => (c?.isHome || !c?.prefix ? HOME_CODE : c.code);

// The owner's session key goes in p_by_password; the database accepts it in place of the password (migration 36)
const byOwner = owner => ({ p_by_user: owner.username, p_by_password: owner.token });
const notInstalled = e => /schema cache|does not exist|could not find the function/i.test(e?.message ?? '');

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { data: null, error: notInstalled(error) ? 'NOT_SET_UP' : error.message.replace(/^.*?: /, '') };
  return { data, error: null };
}

export const saveCompanySettings = (owner, code, settings) => rpc('owner_company_settings', { ...byOwner(owner), p_code: code, p_settings: settings });
export const pauseCompany = (owner, code, paused, message) => rpc('owner_pause_company', { ...byOwner(owner), p_code: code, p_paused: paused, p_message: message ?? null });
export const forceSignOut = (owner, code) => rpc('owner_force_signout', { ...byOwner(owner), p_code: code });
export const loadPrivate = owner => rpc('owner_private_list', byOwner(owner));
export const savePrivate = (owner, code, data) => rpc('owner_private_save', { ...byOwner(owner), p_code: code, p_data: data });
export const loadOwnerLog = (owner, limit = 300) => rpc('owner_log_list', { ...byOwner(owner), p_limit: limit });
export const twoStepStatus = owner => rpc('owner_2fa_status', byOwner(owner));
export const twoStepBegin = (owner, password) => rpc('owner_2fa_begin', { ...byOwner(owner), p_password: password });
export const twoStepConfirm = (owner, code) => rpc('owner_2fa_confirm', { ...byOwner(owner), p_code: code });
export const twoStepDisable = (owner, password, code) => rpc('owner_2fa_disable', { ...byOwner(owner), p_password: password, p_code: code });
export const twoStepReset = (owner, password, username) => rpc('owner_2fa_reset', { ...byOwner(owner), p_password: password, p_username: username });
export const listOwners = owner => rpc('owner_list_owners', byOwner(owner));
export const addOwner = (owner, { username, name, password }) => rpc('owner_add_owner', { ...byOwner(owner), p_username: username, p_name: name, p_password: password });
export const setOwnerActive = (owner, username, active) => rpc('owner_set_owner_active', { ...byOwner(owner), p_username: username, p_active: active });
export const saveBroadcast = (owner, id, data) => rpc('owner_broadcast_save', { ...byOwner(owner), p_id: id ?? null, p_data: data });
export const structureStatus = owner => rpc('owner_structure_status', byOwner(owner));
// Demo data (2026-11-01): fake, tagged data for an added company — never the home company
export const demoStatus = (owner, code) => rpc('owner_demo_status', { ...byOwner(owner), p_code: code });
export const demoLoad   = (owner, code) => rpc('owner_demo_load',   { ...byOwner(owner), p_code: code });
export const demoRemove = (owner, code) => rpc('owner_demo_remove', { ...byOwner(owner), p_code: code });
/** Security stage 2: a session for "Open →" (empId null = full admin) or "Sign in as" → { data: session key } */
// Master copy (migration 47): status (rows per list) and the one-time "Start from 3Gen's lists"
export const masterStatus = owner => rpc('owner_master_status', byOwner(owner));
export const masterSeed = owner => rpc('owner_master_seed', byOwner(owner));
// Master Library (migration 51): change history per area, and an Excel export of an area (owner key reads the master)
export const masterHistory = (owner, area, limit = 200) => rpc('owner_master_history', { ...byOwner(owner), p_area: area, p_limit: limit });
const LIBRARY_TABLES = {
  payers: ['payers', 'payer_plans', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_forms', 'payer_notes', 'payer_auth_rules'],
  denials: ['denial_codes', 'denial_steps'],
  sops: ['sop_categories', 'sop_software', 'sop_tasks', 'sops', 'sop_versions'],
  codes: ['ref_codes'],
};
const NO_EXPORT = ['master_id', 'master_hash', 'master_pushed_at'];
/** Downloads "Helix Hub Master Library – <area>.xlsx" with one sheet per table (no patient data lives in these tables). */
export async function exportMasterArea(area) {
  const tables = LIBRARY_TABLES[area];
  if (!tables) return { error: 'Unknown area' };
  const master = await supabase.from('companies').select('prefix').eq('is_master', true).maybeSingle();
  if (master.error || !master.data) return { error: 'The master copy is not set up.' };
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const t of tables) {
    const rows = await fetchAll(() => supabase.from(master.data.prefix + t).select('*').order('id'));
    if (rows === null) continue;
    const clean = rows.map(r => Object.fromEntries(Object.entries(r)
      .filter(([k]) => !NO_EXPORT.includes(k))
      .map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])));
    XLSX.utils.book_append_sheet(wb, clean.length ? XLSX.utils.json_to_sheet(clean) : XLSX.utils.aoa_to_sheet([['(empty)']]), t.slice(0, 31));
  }
  const title = { payers: 'Payers', denials: 'Denials', sops: 'SOPs', codes: 'Code lists' }[area];
  XLSX.writeFile(wb, `Helix Hub Master Library – ${title} – ${new Date().toISOString().slice(0, 10)}.xlsx`);
  return { ok: true };
}
// Copy to Master (migration 52): preview, then copy; the files are copied into the master's folder afterwards
export const masterCopyPreview = (owner, kind, id) => rpc('owner_master_copy_preview', { ...byOwner(owner), p_kind: kind, p_id: id });
export async function masterCopy(owner, kind, id, mode) {
  const r = await rpc('owner_master_copy', { ...byOwner(owner), p_kind: kind, p_id: id, p_mode: mode });
  const files = { total: 0, copied: 0, failed: 0 };
  for (const f of r.data?.files ?? []) {
    files.total++;
    const { error } = await supabase.storage.from(f.bucket).copy(f.from, f.to);
    if (error && !/exist|duplicate/i.test(error.message ?? '')) files.failed++; else files.copied++;
  }
  return { ...r, files };
}
// Company Data → Save to Master (migration 54): the same, from any company (by code; '__home__' = home), plus code lists
export const masterCopyFromPreview = (owner, code, kind, id) => rpc('owner_master_copy_from_preview', { ...byOwner(owner), p_code: code, p_kind: kind, p_id: id });
export async function masterCopyFrom(owner, code, kind, id, mode) {
  const r = await rpc('owner_master_copy_from', { ...byOwner(owner), p_code: code, p_kind: kind, p_id: id, p_mode: mode });
  const files = { total: 0, copied: 0, failed: 0 };
  for (const f of r.data?.files ?? []) {
    files.total++;
    const { error } = await supabase.storage.from(f.bucket).copy(f.from, f.to);
    if (error && !/exist|duplicate/i.test(error.message ?? '')) files.failed++; else files.copied++;
  }
  return { ...r, files };
}
// Push to companies (migration 48): preview = the real push, cancelled; push = one company per call
export const masterPreview = (owner, code, sections) => rpc('owner_master_preview', { ...byOwner(owner), p_code: code, p_sections: sections });
export const masterPush = (owner, code, sections) => rpc('owner_master_push', { ...byOwner(owner), p_code: code, p_sections: sections });
export const masterPushHistory = (owner, limit = 50) => rpc('owner_master_push_history', { ...byOwner(owner), p_limit: limit });

/**
 * Copies the payer forms and SOP screenshots / videos a company is still missing after a push (migration 49), from the
 * master's folder into the company's folder. Safe to run again: it only lists files that aren't there yet.
 * → { total, copied, failed } or { error }
 */
export async function copyMasterFiles(owner, code) {
  const r = await rpc('owner_master_files', { ...byOwner(owner), p_code: code });
  if (r.error) return r.error === 'NOT_SET_UP' ? { total: 0, copied: 0, failed: 0 } : { error: r.error };
  let copied = 0;
  let failed = 0;
  for (const f of r.data ?? []) {
    const { error } = await supabase.storage.from(f.bucket).copy(f.from, f.to);
    if (error && !/exist|duplicate/i.test(error.message ?? '')) failed++; else copied++;
  }
  return { total: (r.data ?? []).length, copied, failed };
}
// Owner Command Center → People: role change, sign-out and both log entries happen in the database (migration 46)
export const setUserRole = (owner, code, empId, role) => rpc('owner_set_user_role', { ...byOwner(owner), p_code: code, p_emp_id: empId, p_role: role });
export const openOwnerSession = (owner, prefix, empId) => rpc('owner_open_session', { ...byOwner(owner), p_prefix: prefix, p_emp_id: empId });

/** Record an owner action done in the app (sign in as, password reset…). Fire-and-forget. */
export function ownerLog(owner, action, code, target = null, details = null) {
  supabase.rpc('owner_log_action', { ...byOwner(owner), p_action: action, p_code: code, p_target: target, p_details: details }).then(() => {}, () => {});
}

/** Whether migration 34 has been run (the companies table has the new columns). */
export async function ownerConsoleReady() {
  const { error } = await supabase.from('companies').select('session_version').limit(1);
  return !error;
}

export async function loadBroadcasts() {
  const { data, error } = await supabase.from('helix_broadcasts').select('*').order('created_at', { ascending: false });
  return error ? null : data;
}

// ── Monitoring numbers per company ────────────────────────────────────────────

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

async function countOf(table, build) {
  const { count, error } = await build(supabase.from(table).select('*', { count: 'exact', head: true }));
  return error ? null : count;
}

/** { users, activeUsers, signInsToday, signIns7, reportsWeek, prodWeek, lastActivity } — null where unavailable. */
export async function companyStats(prefix) {
  const t = name => prefix + name;
  const today0 = startOfToday();
  const week0 = new Date(today0); week0.setDate(week0.getDate() - ((week0.getDay() + 6) % 7));   // Monday
  const d7 = new Date(today0); d7.setDate(d7.getDate() - 6);
  const [users, activeUsers, signInsToday, signIns7, reportsWeek, weekLogs, last] = await Promise.all([
    countOf(t('users'), q => q),
    countOf(t('users'), q => q.neq('active', false)),
    countOf(t('audit_log'), q => q.eq('action', 'sign_in').gte('created_at', today0.toISOString())),
    countOf(t('audit_log'), q => q.eq('action', 'sign_in').gte('created_at', d7.toISOString())),
    countOf(t('daily_logs'), q => q.eq('submitted', true).gte('date', ymd(week0))),
    supabase.from(t('daily_logs')).select('total,target,adj_target').gte('date', ymd(week0)).limit(5000),
    supabase.from(t('audit_log')).select('created_at,actor_name,action').order('created_at', { ascending: false }).limit(1),
  ]);
  const pcts = (weekLogs.data ?? []).map(l => { const tg = l.adj_target ?? l.target; return tg ? (l.total ?? 0) / tg * 100 : null; }).filter(v => v != null);
  return {
    users, activeUsers, signInsToday, signIns7, reportsWeek,
    prodWeek: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    lastActivity: last.data?.[0] ?? null,
  };
}

/** A company's users with their last sign-in (from its audit log, last 120 days). Passwords are never returned. */
export async function companyUsers(prefix) {
  const since = new Date(); since.setDate(since.getDate() - 120);
  const [u, s] = await Promise.all([
    supabase.from(prefix + 'users').select('*').order('name'),
    supabase.from(prefix + 'audit_log').select('actor_emp_id,created_at').eq('action', 'sign_in')
      .gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(5000),
  ]);
  if (u.error) return null;
  const last = {};
  for (const r of s.data ?? []) if (!last[r.actor_emp_id]) last[r.actor_emp_id] = r.created_at;
  // eslint-disable-next-line no-unused-vars
  return u.data.map(({ password, ...rest }) => ({ ...rest, last_sign_in: last[rest.emp_id] ?? null }));
}

/** Full user row (with password) — only for "Sign in as", never shown. */
export async function companyUserForSignIn(prefix, empId) {
  const { data, error } = await supabase.from(prefix + 'users').select('*').eq('emp_id', empId).single();
  if (error) return null;
  delete data.password;
  return data;
}

export async function setUserPassword(prefix, empId, password) {
  const { error } = await supabase.from(prefix + 'users').update({ password }).eq('emp_id', empId);
  return !error;
}

export async function setUserActive(prefix, empId, active) {
  const { error } = await supabase.from(prefix + 'users').update({ active }).eq('emp_id', empId);
  return !error;
}

/** Writes into the company's own Audit Log, marked as the owner. */
export async function companyAudit(prefix, owner, action, target = {}, details = null) {
  await supabase.from(prefix + 'audit_log').insert({
    actor_emp_id: 'HELIX_OWNER', actor_name: `${owner.name} (Helix Hub owner ${owner.username})`, actor_role: 'owner',
    action, target_emp_id: target.emp_id ?? null, target_name: target.name ?? null, details, created_at: new Date().toISOString(),
  }).then(() => {}, () => {});
}

/** Recent audit entries + sign-ins per day for the last 30 days. */
export async function companyActivity(prefix) {
  const since = startOfToday(); since.setDate(since.getDate() - 29);
  const [recent, signIns] = await Promise.all([
    supabase.from(prefix + 'audit_log').select('created_at,actor_name,actor_emp_id,action,target_name,details').order('created_at', { ascending: false }).limit(150),
    supabase.from(prefix + 'audit_log').select('created_at').eq('action', 'sign_in').gte('created_at', since.toISOString()).limit(10000),
  ]);
  const byDay = new Map();
  for (let i = 0; i < 30; i++) { const d = new Date(since); d.setDate(d.getDate() + i); byDay.set(ymd(d), 0); }
  for (const r of signIns.data ?? []) { const k = ymd(new Date(r.created_at)); if (byDay.has(k)) byDay.set(k, byDay.get(k) + 1); }
  return { recent: recent.data ?? [], daily: [...byDay].map(([date, n]) => ({ date, n })) };
}

// ── Owner Command Center: Performance + Master Data (Stage 3, no database change) ───────────

/** Every row of a query, 1000 at a time (Supabase returns at most 1000 per request). */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return null;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Prod % and Quality % for a company between two dates (yyyy-mm-dd, inclusive).
 * Prod % = Prod Monitor's formula per daily report (work done ÷ adjusted target), averaged; reports with no target are left out.
 * Quality % = average of the quality scores entered. → { reports, people, prod, prodN, quality, qualityN } or null.
 */
export async function companyPerformance(prefix, from, to) {
  const rows = await fetchAll(() => supabase.from(prefix + 'daily_logs').select('emp_id,date,total,target,adj_target,quality')
    .gte('date', from).lte('date', to).order('date'));
  if (!rows) return null;
  const prods = [];
  const quals = [];
  for (const l of rows) {
    const t = l.adj_target ?? l.target;
    if (l.total != null && t) prods.push((Number(l.total) / Number(t)) * 100);
    if (l.quality != null && l.quality !== '') quals.push(Number(l.quality));
  }
  return { reports: rows.length, people: new Set(rows.map(l => l.emp_id)).size, prod: mean(prods), prodN: prods.length, quality: mean(quals), qualityN: quals.length };
}

/** A company's clients, payers and processes (read-only view; editing stays in the company). Null = table not there. */
export async function companyMasters(prefix) {
  const [clients, payers, processes] = await Promise.all(['clients', 'payers', 'processes']
    .map(t => fetchAll(() => supabase.from(prefix + t).select('*').order('name'))));
  return { clients, payers, processes };
}

/** Random temporary password (shown once to the owner). */
export function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, n => chars[n % chars.length]).join('');
}
