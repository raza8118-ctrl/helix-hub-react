import { useState, useEffect } from 'react';
import { kv } from './supabase';

// Each Helix Hub installation (own database) belongs to one company.
// Profile precedence: admin-saved profile (kv) → deployment env vars → 3Gen default.
export const DEFAULT_COMPANY = {
  name: import.meta.env.VITE_COMPANY_NAME || '3Gen Consulting',
  code: import.meta.env.VITE_COMPANY_CODE || (import.meta.env.VITE_COMPANY_NAME ? '' : '3GEN'),
};

const KV_KEY     = 'company_profile';
const CACHE_KEY  = 'hh_company';
const CHANGE_EVT = 'hh-company-change';

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || DEFAULT_COMPANY; }
  catch { return DEFAULT_COMPANY; }
}

function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

export async function loadCompany() {
  const saved = await kv.get(KV_KEY);
  const c = saved?.name ? { name: saved.name, code: saved.code || '' } : DEFAULT_COMPANY;
  writeCache(c);
  return c;
}

export async function saveCompany({ name, code }) {
  const c = { name: name.trim(), code: (code ?? '').trim().toUpperCase() };
  const ok = await kv.set(KV_KEY, c);
  if (ok) {
    writeCache(c);
    window.dispatchEvent(new CustomEvent(CHANGE_EVT, { detail: c }));
  }
  return ok;
}

// Case/space/punctuation-insensitive match against the company name or its short code
const norm = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchesCompany(input, company) {
  const n = norm(input);
  return !!n && [company.name, company.code].some(v => v && norm(v) === n);
}

// Current company profile; starts from cache, refreshes from the database,
// and updates live when an admin saves a new profile.
export function useCompany() {
  const [company, setCompany] = useState(readCache);
  useEffect(() => {
    let alive = true;
    loadCompany().then(c => { if (alive) setCompany(c); }).catch(() => {});
    const onChange = e => setCompany(e.detail);
    window.addEventListener(CHANGE_EVT, onChange);
    return () => { alive = false; window.removeEventListener(CHANGE_EVT, onChange); };
  }, []);
  return company;
}
