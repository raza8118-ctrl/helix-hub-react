// Global search (roadmap 10.1): one in-browser index of pages and records the person can open — payers, clients,
// published SOPs, denial codes, payer updates, client queries, escalations, credentialing providers. Built on first
// open per session; searching never leaves the browser and is not logged. Claims / worklist items are not indexed.
import { db } from './supabase';
import { loadKnowledge } from './assistant';
import { queryRef, categoryLabel } from './clientQueries';
import { escRef } from './escalations';
import { isLive, categoryOf } from './board';

export const GROUPS = [
  { key: 'pages',     label: 'Pages',                 icon: '📄' },
  { key: 'payers',    label: 'Payers',                icon: '📇' },
  { key: 'clients',   label: 'Clients',               icon: '🏢' },
  { key: 'sops',      label: 'SOPs',                  icon: '📚' },
  { key: 'codes',     label: 'Denial codes',          icon: '🧩' },
  { key: 'updates',   label: 'Payer updates',         icon: '📰' },
  { key: 'queries',   label: 'Client queries',        icon: '💬' },
  { key: 'escalations', label: 'Escalations',         icon: '⚑' },
  { key: 'providers', label: 'Credentialing providers', icon: '🪪' },
  { key: 'notices',   label: 'Notices',                 icon: '📌' },   // 10.3
];
export const PER_GROUP = 6;

const norm = s => String(s ?? '').toLowerCase();
const item = (group, id, title, sub, extra, tab, record = null) => ({
  key: `${group}:${id}`, group, title, sub: sub || '', words: norm([title, sub, extra].flat().filter(Boolean).join(' ')), tab, record,
});

/** Builds the index. tabs = the sidebar tabs this person can open ({ id, label, icon }). Missing modules are skipped. */
export async function loadIndex(user, tabs) {
  const [k, queries, escalations, providers, notices] = await Promise.all([
    loadKnowledge(user),
    db('client_queries').select('id,client_id,category,question,status'),   // never the claim number
    db('escalations').select('id,title,type,status'),
    db('cred_providers').select('id,name,npi,provider_type,active'),
    db('board_notices').select('id,title,body,category,show_from,show_until,active'),
  ]);
  const clientName = id => k.clients.find(c => c.id === id)?.name;
  const out = [];
  for (const t of tabs) out.push(item('pages', t.id, `${t.icon ?? ''} ${t.label}`.trim(), t.section ?? '', null, t.id));
  for (const p of k.payers) out.push(item('payers', p.id, p.name, [p.payer_type, ...(p.aliases ?? [])].filter(Boolean).join(' · '), null, 'wb_payers', { payerId: p.id }));
  for (const c of k.clients) out.push(item('clients', c.id, c.name, 'Open its portals', c.code, 'wb_artools', { tool: 'portals', clientId: c.id }));
  for (const s of k.sops) out.push(item('sops', s.id, s.title, [s.software, s.task].filter(Boolean).join(' › '), s.summary, 'wb_sops', { query: s.title }));
  for (const c of k.codes) out.push(item('codes', c.id, c.code, c.plain_reason ?? c.official_text ?? '', c.category, 'wb_denials', { query: c.code }));
  for (const u of k.updates) {
    const payer = k.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name ?? '';
    out.push(item('updates', u.id, `${payer}: ${u.change_text}`.slice(0, 140), u.effective_date ? `Effective ${u.effective_date}` : u.bulletin.title, u.action_needed, 'wb_updates', { tab: 'all', query: payer }));
  }
  for (const q of queries.error ? [] : queries.data ?? []) {
    out.push(item('queries', q.id, `${queryRef(q.id)} — ${clientName(q.client_id) ?? 'Client'}`, `${categoryLabel(q.category)} · ${q.status}`, q.question, 'wb_queries', { tab: 'all', query: queryRef(q.id) }));
  }
  for (const e of escalations.error ? [] : escalations.data ?? []) {
    out.push(item('escalations', e.id, `${escRef(e.id)} — ${e.title}`, e.status.replace('_', ' '), null, 'wb_handover', { tab: 'esc' }));
  }
  for (const p of providers.error ? [] : (providers.data ?? []).filter(x => x.active !== false)) {
    out.push(item('providers', p.id, p.name, p.npi ? `NPI ${p.npi}` : '', p.npi, 'wb_credentialing', { providerId: p.id }));
  }
  for (const n of notices.error ? [] : (notices.data ?? []).filter(isLive)) {
    out.push(item('notices', n.id, n.title, categoryOf(n.category).label, n.body, 'wb_board', { noticeId: n.id }));
  }
  return out;
}

/** Ranked matches grouped: [{ group, items, total }]. Every word typed must appear; title starts rank first. */
export function searchIndex(index, query) {
  const q = norm(query).trim();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const compact = q.replace(/[^a-z0-9]/g, '');
  const scored = [];
  for (const it of index) {
    if (!words.every(w => it.words.includes(w))) continue;
    const title = norm(it.title);
    const score = title.replace(/[^a-z0-9]/g, '') === compact ? 0 : title.startsWith(q) ? 1
      : title.split(/[\s—:·-]+/).some(t => t.startsWith(words[0])) ? 2 : 3;
    scored.push({ it, score });
  }
  scored.sort((a, b) => a.score - b.score || a.it.title.localeCompare(b.it.title));
  return GROUPS.map(g => {
    const all = scored.filter(s => s.it.group === g.key).map(s => s.it);
    return { group: g, items: all, total: all.length };
  }).filter(g => g.total);
}

// ── Recent picks (this browser only — a convenience) ───────────────────────

const RECENT_KEY = 'hh_search_recent';
export function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
export function pushRecent(it) {
  if (it.group === 'pages') return;
  const list = [{ key: it.key, group: it.group, title: it.title, sub: it.sub, tab: it.tab, record: it.record },
    ...readRecent().filter(r => r.key !== it.key)].slice(0, 5);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
}

// One load per person per session (shared while it runs); fresh = ↻ refresh
let cached = { emp: null, promise: null };
export function getIndex(user, tabs, fresh = false) {
  if (fresh || !cached.promise || cached.emp !== user.emp_id) {
    cached = { emp: user.emp_id, promise: loadIndex(user, tabs).catch(() => []) };
  }
  return cached.promise;
}
