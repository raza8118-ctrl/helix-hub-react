import { useState, useEffect } from 'react';
import { supabase, getActiveCompany, getTablePrefix } from './supabase';

// Companies
// ─────────
// Home company: the original tables (prefix ''). Its profile is admin-saved in the
// home kv store, falling back to deployment env vars, then 3Gen Consulting.
// Other companies: rows in rcm.companies (see supabase/multi_company_setup.sql),
// each with its own prefixed copy of every table.
export const DEFAULT_COMPANY = {
  name:   import.meta.env.VITE_COMPANY_NAME || '3Gen Consulting',
  code:   import.meta.env.VITE_COMPANY_CODE || (import.meta.env.VITE_COMPANY_NAME ? '' : '3GEN'),
  prefix: '',
};

const KV_KEY     = 'company_profile';
const CACHE_KEY  = 'hh_company_home';
const CHANGE_EVT = 'hh-company-change';

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || DEFAULT_COMPANY; }
  catch { return DEFAULT_COMPANY; }
}

function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

// Home kv is read/written directly (unprefixed), whichever company is active
async function loadHomeProfile() {
  const { data } = await supabase.from('rcm_store').select('value').eq('key', KV_KEY).maybeSingle();
  const saved = data?.value;
  const c = saved?.name ? { name: saved.name, code: saved.code || '', prefix: '' } : DEFAULT_COMPANY;
  writeCache(c);
  return c;
}

// Profile of the company the current tab is signed in to
export async function loadCompany() {
  const active = getActiveCompany();
  if (active?.prefix) return active;
  return loadHomeProfile();
}

export async function saveCompany({ name, code }) {
  const c = { name: name.trim(), code: (code ?? '').trim().toUpperCase(), prefix: '' };
  const { error } = await supabase.from('rcm_store')
    .upsert({ key: KV_KEY, value: { name: c.name, code: c.code } }, { onConflict: 'key' });
  if (error) { console.error('saveCompany error', error); return false; }
  writeCache(c);
  window.dispatchEvent(new CustomEvent(CHANGE_EVT, { detail: c }));
  return true;
}

// Case/space/punctuation-insensitive match against a company's name or short code
const norm = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchesCompany(input, company) {
  const n = norm(input);
  return !!n && [company.name, company.code].some(v => v && norm(v) === n);
}

// All added companies, or null if the registry isn't installed yet
export async function listCompanies() {
  const { data, error } = await supabase.from('companies').select('*').order('created_at');
  if (error) return null;
  return data;
}

// Resolve what a user typed at the login company step → { name, code, prefix } or null
export async function findCompany(input) {
  const home = await loadHomeProfile();
  if (matchesCompany(input, home)) return home;
  const hit = (await listCompanies() ?? []).find(c => c.active && matchesCompany(input, c));
  return hit ? { name: hit.name, code: hit.code, prefix: hit.prefix } : null;
}

/** Owner Console: a paused (inactive) company matching what was typed → { name, pause_message } or null. */
export async function findPausedCompany(input) {
  const hit = (await listCompanies() ?? []).find(c => !c.active && matchesCompany(input, c));
  return hit ? { name: hit.name, pause_message: hit.pause_message ?? null } : null;
}

/** One-time message for the login screen after the owner pauses a company or signs everyone out. */
export const SIGNOUT_MSG_KEY = 'hh_signout_msg';

/** The signed-in company's registry row (features, banner, pause state…), or null for the home company. */
export async function loadCompanyRow(code) {
  if (!code) return null;
  const { data, error } = await supabase.from('companies').select('*').eq('code', code).maybeSingle();
  return error ? null : data;
}

// Home company pages on / off (PO request 2026-10-30): the home company has no registry row, so its
// { featureKey: false } map lives in the home kv store — read/written unprefixed, whichever company is active.
const HOME_FEATURES_KEY = 'home_features';

/** The home company's switched-off pages ({} = everything on). */
export async function loadHomeFeatures() {
  const { data } = await supabase.from('rcm_store').select('value').eq('key', HOME_FEATURES_KEY).maybeSingle();
  return data?.value ?? {};
}

/** Saves the home company's switched-off pages. Returns true on success. */
export async function saveHomeFeatures(features) {
  const { error } = await supabase.from('rcm_store')
    .upsert({ key: HOME_FEATURES_KEY, value: features ?? {} }, { onConflict: 'key' });
  if (error) { console.error('saveHomeFeatures error', error); return false; }
  return true;
}

/**
 * Owner Console 2.0 seat limit: a message when the signed-in company already has as many active users as its plan
 * allows (adding / reactivating one more is blocked), else null. The home company has no limit.
 */
export async function seatLimitProblem() {
  const active = getActiveCompany();
  if (!active?.prefix) return null;   // home company
  const row = await loadCompanyRow(active.code);
  if (!row?.seat_limit) return null;
  const { count, error } = await supabase.from(getTablePrefix() + 'users').select('*', { count: 'exact', head: true }).neq('active', false);
  if (error || count == null || count < row.seat_limit) return null;
  return `Your Helix Hub plan allows ${row.seat_limit} active users and you already have ${count}. Deactivate someone first, or ask the Helix Hub administrator to raise the limit.`;
}

// ── Helix Hub owner ──────────────────────────────────────────────────────────
// Platform owners (rcm.helix_owners) are separate from every company's users and
// are the only ones who can manage companies. Kept per browser tab.
const OWNER_SESSION_KEY = 'hh_owner';

// Holds { username, name, token } — a 12-hour session key from the database, never the password (security stage 1).
// A session saved before that (with no key) is ignored, so the owner simply signs in again.
export function getOwnerSession() {
  try {
    const o = JSON.parse(sessionStorage.getItem(OWNER_SESSION_KEY));
    if (!o?.token) return null;
    if ('password' in o) {   // left by an older version of the app — drop it
      delete o.password;
      sessionStorage.setItem(OWNER_SESSION_KEY, JSON.stringify(o));
    }
    return o;
  } catch { return null; }
}

export function setOwnerSession(owner) {
  try {
    if (owner) sessionStorage.setItem(OWNER_SESSION_KEY, JSON.stringify(owner));
    else sessionStorage.removeItem(OWNER_SESSION_KEY);
  } catch { /* storage unavailable */ }
}

// → { data: { username, name, token }, error }
export async function ownerLogin(username, password) {
  const { data, error } = await supabase.rpc('owner_login', { p_username: username, p_password: password });
  if (error) {
    const notInstalled = /owner_login|schema cache/i.test(error.message);
    return {
      data: null,
      error: notInstalled
        ? "Owner sign-in isn't set up yet. Run supabase/multi_company_setup.sql in Supabase first."
        : 'Invalid owner username or password.',
    };
  }
  // TEMPORARY until migration 36 is run (remove in security stage 2): the old database accepts only the password
  if (!data?.token) return { data: { ...data, token: password }, error: null };
  return { data, error: null };
}

/** Ends the owner's session key in the database. Fire-and-forget. */
export function ownerLogout(owner) {
  if (owner?.token) supabase.rpc('owner_logout', { p_username: owner.username, p_token: owner.token }).then(() => {}, () => {});
}

// Needs the current password typed again — the session key alone can't change it
export async function ownerChangePassword(owner, currentPassword, newPassword) {
  const { error } = await supabase.rpc('owner_change_password', {
    p_username: owner.username, p_password: currentPassword, p_new_password: newPassword,
  });
  return { error: error?.message?.replace(/^.*?: /, '') ?? null };
}

// Owner actions (verified again server-side against rcm.helix_owners)
const byOwner = owner => ({ p_by_user: owner.username, p_by_password: owner.token });

export async function createCompany(owner, { name, code, adminId, adminName, adminPassword }) {
  const { data, error } = await supabase.rpc('create_company', {
    ...byOwner(owner),
    p_name: name, p_code: code,
    p_admin_id: adminId, p_admin_password: adminPassword, p_admin_name: adminName,
  });
  return { data, error: error?.message ?? null };
}

export async function updateCompany(owner, code, { name = null, active = null }) {
  const { error } = await supabase.rpc('update_company', {
    ...byOwner(owner), p_code: code, p_name: name, p_active: active,
  });
  return { error: error?.message ?? null };
}

// Drops every table of the company — cannot be undone
export async function deleteCompany(owner, code) {
  const { data, error } = await supabase.rpc('delete_company', { ...byOwner(owner), p_code: code });
  return { data, error: error?.message ?? null };
}

// Add any tables/columns the home company has gained since companies were created
export async function syncCompanies(owner) {
  const { data, error } = await supabase.rpc('sync_company_tables', byOwner(owner));
  return { data, error: error?.message ?? null };
}

// Current company profile; refreshes from the database and updates live when
// the home profile is saved.
export function useCompany() {
  const [company, setCompany] = useState(() => {
    const active = getActiveCompany();
    return active?.prefix ? active : readCache();
  });
  useEffect(() => {
    let alive = true;
    loadCompany().then(c => { if (alive) setCompany(c); }).catch(() => {});
    const onChange = e => { if (!getActiveCompany()?.prefix) setCompany(e.detail); };
    window.addEventListener(CHANGE_EVT, onChange);
    return () => { alive = false; window.removeEventListener(CHANGE_EVT, onChange); };
  }, []);
  return company;
}
