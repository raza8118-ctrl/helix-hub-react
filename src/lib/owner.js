// Owner Console 2.0 (PO request 2026-10-29): owner-only database calls (each checks the owner password inside the
// database) and the per-company numbers the console shows. Company tables are read directly with the company's
// table prefix ('' = home company). Names, counts and dates only — never patient data.
import { supabase } from './supabase';

export const HOME_CODE = '__home__';
export const codeOf = c => (c?.isHome || !c?.prefix ? HOME_CODE : c.code);

const byOwner = owner => ({ p_by_user: owner.username, p_by_password: owner.password });
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
export const listOwners = owner => rpc('owner_list_owners', byOwner(owner));
export const addOwner = (owner, { username, name, password }) => rpc('owner_add_owner', { ...byOwner(owner), p_username: username, p_name: name, p_password: password });
export const setOwnerActive = (owner, username, active) => rpc('owner_set_owner_active', { ...byOwner(owner), p_username: username, p_active: active });
export const saveBroadcast = (owner, id, data) => rpc('owner_broadcast_save', { ...byOwner(owner), p_id: id ?? null, p_data: data });
export const structureStatus = owner => rpc('owner_structure_status', byOwner(owner));

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
  return error ? null : data;
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

/** Random temporary password (shown once to the owner). */
export function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, n => chars[n % chars.length]).join('');
}
