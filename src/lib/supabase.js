import { createClient } from '@supabase/supabase-js';
import { applyCompanyBuiltins, setCompanyProcessNames } from './constants';

// The Supabase anon key used to live in the misnamed VITE_ANTHROPIC_KEY — still read as a fallback so existing
// deployments keep working until VITE_SUPABASE_ANON_KEY is set (2026-10-29).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_ANTHROPIC_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { db: { schema: 'rcm' }, global: { fetch: fetchWithSession } });

// ── Signed-in session (security stage 2) ─────────────────────────────────────
// Sign-in returns a 12-hour session key; it is sent with every database call (header x-helix-session) so the
// database knows who is asking (rcm.current_session). Kept per browser tab. Only sent to the database API.
const SESSION_KEY = 'hh_session';
let sessionToken = null;
try { sessionToken = sessionStorage.getItem(SESSION_KEY); } catch { /* storage unavailable */ }

export function getSessionToken() { return sessionToken; }
export function setSessionToken(token) {
  sessionToken = token || null;
  try {
    if (sessionToken) sessionStorage.setItem(SESSION_KEY, sessionToken);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
}

// Stage 3: the Helix Hub owner's 12-hour key (saved by lib/company.js setOwnerSession) is sent too, so the Owner
// Console can read company tables once the database row rules are on.
function ownerToken() {
  try { return JSON.parse(sessionStorage.getItem('hh_owner'))?.token ?? null; } catch { return null; }
}

function fetchWithSession(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  const owner = ownerToken();
  if ((!sessionToken && !owner) || !url.includes('/rest/v1/')) return fetch(input, init);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (sessionToken) headers.set('x-helix-session', sessionToken);
  if (owner) headers.set('x-helix-owner', owner);
  return fetch(input, { ...init, headers });
}

// ── Active company ────────────────────────────────────────────────────────────
// Every company has its own copy of each table. The home company uses the
// original tables (prefix ''); others use prefixed copies, e.g. 'co_acme__users'.
// Chosen at the login company step and kept per browser tab.
const COMPANY_SESSION_KEY = 'hh_company';

function readActiveCompany() {
  try { return JSON.parse(sessionStorage.getItem(COMPANY_SESSION_KEY)); } catch { return null; }
}

let tablePrefix = readActiveCompany()?.prefix ?? '';
applyCompanyBuiltins(!tablePrefix);

export function getActiveCompany() { return readActiveCompany(); }
export function getTablePrefix()   { return tablePrefix; }

// Pass a company ({ name, code, prefix }) to switch, or null to return to the home company
export function setActiveCompany(company) {
  tablePrefix = company?.prefix ?? '';
  applyCompanyBuiltins(!tablePrefix);
  try {
    if (company) sessionStorage.setItem(COMPANY_SESSION_KEY, JSON.stringify(company));
    else sessionStorage.removeItem(COMPANY_SESSION_KEY);
  } catch { /* storage unavailable */ }
}

// Query builder for the active company's copy of a table
export const db = table => supabase.from(tablePrefix + table);

// General-purpose table helper — used by all pages
export const S = {
  async get(table, filters = {}) {
    let q = db(table).select('*');
    for (const [col, val] of Object.entries(filters)) {
      if (Array.isArray(val)) q = q.in(col, val);
      else q = q.eq(col, val);
    }
    const { data, error } = await q;
    if (error) { console.error('S.get error', error); return null; }
    return data;
  },

  async getOne(table, filters = {}) {
    const rows = await S.get(table, filters);
    return rows?.[0] ?? null;
  },

  async set(table, payload, matchCols = null) {
    let q;
    if (matchCols) {
      q = db(table).upsert(payload, {
        onConflict: Array.isArray(matchCols) ? matchCols.join(',') : matchCols,
      });
    } else {
      q = db(table).insert(payload);
    }
    const { data, error } = await q.select();
    if (error) { console.error('S.set error', error); return null; }
    return data;
  },

  async del(table, filters = {}) {
    let q = db(table).delete();
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
    }
    const { error } = await q;
    if (error) { console.error('S.del error', error); return null; }
    return true;
  },

  async update(table, payload, filters = {}) {
    let q = db(table).update(payload);
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
    }
    const { data, error } = await q.select();
    if (error) { console.error('S.update error', error); return null; }
    return data;
  },
};

// Added companies: load their own process names into the process filters
export async function refreshCompanyProcesses() {
  if (!tablePrefix) return;
  const rows = await S.get('processes');
  setCompanyProcessNames((rows ?? []).filter(p => p.active !== false).map(p => p.name));
}

// File uploads — Supabase Storage (non-home companies get their own folder)
export const storage = {
  async uploadFile(bucket, path, file) {
    const fullPath = tablePrefix ? `${tablePrefix.replace(/_+$/, '')}/${path}` : path;
    const { error } = await supabase.storage.from(bucket).upload(fullPath, file, { upsert: true });
    if (error) { console.error('storage.uploadFile error', error); return null; }
    const { data } = supabase.storage.from(bucket).getPublicUrl(fullPath);
    return data?.publicUrl ?? null;
  },
};

// Key-value store backed by rcm_store table { key TEXT PK, value JSONB }
export const kv = {
  async get(key) {
    const { data, error } = await db('rcm_store')
      .select('value')
      .eq('key', key)
      .single();
    if (error) return null;
    return data?.value ?? null;
  },

  async set(key, value) {
    const { error } = await db('rcm_store')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) { console.error('kv.set error', error); return false; }
    return true;
  },
};
