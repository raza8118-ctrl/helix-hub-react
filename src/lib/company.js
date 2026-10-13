import { useState, useEffect } from 'react';
import { supabase, getActiveCompany } from './supabase';

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

// Main-admin actions (verified again server-side against the home users table)
export async function createCompany(by, { name, code, adminId, adminName, adminPassword }) {
  const { data, error } = await supabase.rpc('create_company', {
    p_by_emp_id: by.emp_id, p_by_password: by.password,
    p_name: name, p_code: code,
    p_admin_id: adminId, p_admin_password: adminPassword, p_admin_name: adminName,
  });
  return { data, error: error?.message ?? null };
}

export async function updateCompany(by, code, { name = null, active = null }) {
  const { error } = await supabase.rpc('update_company', {
    p_by_emp_id: by.emp_id, p_by_password: by.password,
    p_code: code, p_name: name, p_active: active,
  });
  return { error: error?.message ?? null };
}

// Add any tables/columns the home company has gained since companies were created
export async function syncCompanies(by) {
  const { data, error } = await supabase.rpc('sync_company_tables', {
    p_by_emp_id: by.emp_id, p_by_password: by.password,
  });
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
