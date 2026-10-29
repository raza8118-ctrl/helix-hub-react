// Reports (roadmap 10.2): denial trends by payer / client / week / code from Smart Worklist claims with a denial date,
// and a weekly client report pulled from the worklist, follow-ups, client queries, escalations, Medicare trackers and
// payer updates. Read-only; exports and the optional AI summary carry counts / names only — never claim numbers.
import { db, kv } from './supabase';
import { logAudit } from './audit';
import { assertAiAllowed } from './companyFeatures';
import { hasAccess } from './access';
import { addDays, today } from './helpers';
import { daysBetween } from './deadlines';
import { normCode } from './denials';
import { isOpen as queryOpen, ageDays as queryAge } from './clientQueries';

export const canViewReports = user => hasAccess(user, 'reports_view');
export const RANGES = [
  { value: 30, label: 'Last 30 days' }, { value: 90, label: 'Last 90 days' }, { value: 180, label: 'Last 180 days' },
  { value: 0, label: 'Custom' },
];
export const OUTCOMES = [
  { key: 'appealed', label: 'Appealed' }, { key: 'rebilled', label: 'Rebilled' }, { key: 'paid', label: 'Paid after denial' },
  { key: 'denied_final', label: 'Denied – final' }, { key: 'closed', label: 'Closed' }, { key: 'open', label: 'Still open' },
];
const outcomeOf = status => (['appealed', 'rebilled', 'paid', 'denied_final', 'closed'].includes(status) ? status : 'open');
const amountOf = i => Number(i.billed ?? i.balance ?? 0) || 0;

/** Monday of the week a date falls in. */
export function mondayOf(date) {
  const d = new Date(`${date}T00:00:00`);
  const back = (d.getDay() + 6) % 7;
  return addDays(date, -back);
}
/** { from, to } of last week (Mon–Sun). */
export const lastWeek = () => { const from = addDays(mondayOf(today()), -7); return { from, to: addDays(from, 6) }; };

const CLAIM_COLUMNS = 'id,payer_id,payer_name,client_id,billed,balance,denial_date,status,worked_at,follow_up,active';

/** Worklist claims matching a filter, paged; with denial_code when that column exists (10.2 update). */
async function loadClaims(apply) {
  const run = async cols => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await apply(db('worklist_items').select(cols).eq('active', true)).range(from, from + 999);
      if (error) return { error };
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return { data: out };
  };
  let r = await run(`${CLAIM_COLUMNS},denial_code`);
  if (r.error) r = await run(CLAIM_COLUMNS);
  return r.error ? null : r.data;
}

// ── Denial trends ──────────────────────────────────────────────────────────

/** Claims with a denial date in the range (null when the Smart Worklist isn't set up). */
export async function loadDenials({ from, to, clientId = null, payerId = null }, user) {
  const claims = await loadClaims(q => {
    let x = q.gte('denial_date', from).lte('denial_date', to);
    if (clientId) x = x.eq('client_id', clientId);
    if (payerId) x = x.eq('payer_id', payerId);
    return x;
  });
  logAudit({ actor: user, action: 'report_view', entityType: 'report', details: { report: 'denial_trends', from, to, client_id: clientId, payer_id: payerId } });
  return claims;
}

const codeKey = c => normCode(c).replace(/^(CO|PR|OA|PI|CR)[-:]?/, '');

/** Aggregates for the charts and tables. codes = Denial library rows (for plain reasons). */
export function denialTrends(claims, { payers, clients, codes }) {
  const payerName = c => payers.find(p => p.id === c.payer_id)?.name ?? c.payer_name ?? 'Payer not matched';
  const clientName = id => clients.find(c => c.id === id)?.name ?? 'No client';
  const group = (keyOf, nameOf) => {
    const by = new Map();
    for (const c of claims) {
      const k = keyOf(c);
      const r = by.get(k) ?? { key: k, name: nameOf(c), count: 0, amount: 0, outcomes: Object.fromEntries(OUTCOMES.map(o => [o.key, 0])) };
      r.count += 1; r.amount += amountOf(c); r.outcomes[outcomeOf(c.status)] += 1;
      by.set(k, r);
    }
    return [...by.values()].sort((a, b) => b.count - a.count || b.amount - a.amount);
  };
  const byPayer = group(c => c.payer_id ?? `n:${c.payer_name ?? ''}`, payerName);
  const byClient = group(c => c.client_id ?? 'none', c => clientName(c.client_id));
  const weeks = group(c => mondayOf(c.denial_date), c => mondayOf(c.denial_date)).sort((a, b) => a.key.localeCompare(b.key));
  const codeCounts = new Map();
  let withCode = 0;
  for (const c of claims) {
    const tokens = String(c.denial_code ?? '').split(/[\s,;/|]+/).map(t => t.trim()).filter(Boolean);
    if (tokens.length) withCode += 1;
    for (const t of new Set(tokens)) codeCounts.set(t, (codeCounts.get(t) ?? 0) + 1);
  }
  const byCode = [...codeCounts.entries()].map(([code, count]) => {
    const lib = codes.find(x => normCode(x.code) === codeKey(code));
    return { code, count, reason: lib?.plain_reason ?? lib?.official_text ?? '' };
  }).sort((a, b) => b.count - a.count);
  const total = { count: claims.length, amount: claims.reduce((t, c) => t + amountOf(c), 0), withCode };
  return { total, byPayer, byClient, weeks, byCode };
}

// ── Weekly client report ───────────────────────────────────────────────────

const safe = async (q) => { const r = await q; return r.error ? null : r.data ?? []; };

/** Everything for one client and one week. Parts that aren't set up come back null. */
export async function loadWeekly({ clientId, from, to }, user) {
  const start = new Date(`${from}T00:00:00`).toISOString();
  const end = new Date(`${addDays(to, 1)}T00:00:00`).toISOString();
  const recent = addDays(from, -90);
  const [worked, denied, recentClaims, reminders, queries, escalations, adrs, overpayments, rtp, updates] = await Promise.all([
    loadClaims(q => q.eq('client_id', clientId).gte('worked_at', start).lt('worked_at', end)),
    loadClaims(q => q.eq('client_id', clientId).gte('denial_date', from).lte('denial_date', to)),
    loadClaims(q => q.eq('client_id', clientId).gte('created_at', new Date(`${recent}T00:00:00`).toISOString())),
    safe(db('followups').select('id,status').eq('client_id', clientId).eq('status', 'open')),
    safe(db('client_queries').select('id,category,status,asked_on,answered_at,closed_at,updated_at,escalated').eq('client_id', clientId)),
    safe(db('escalations').select('id,title,status,severity,created_at,resolved_at').eq('client_id', clientId)),
    safe(db('medicare_adrs').select('id,status,due_date,amount,closed_at').eq('client_id', clientId)),
    safe(db('medicare_overpayments').select('id,status,amount,due_date,closed_at').eq('client_id', clientId)),
    safe(db('medicare_rtp_items').select('id,work_status,in_fiss,in_status_since,resolved_at').eq('client_id', clientId)),
    safe(db('payer_updates').select('id,payer_id,payer_name,effective_date,change_text,action_needed,status').eq('status', 'active')),
  ]);
  logAudit({ actor: user, action: 'report_view', entityType: 'report', details: { report: 'weekly_client', client_id: clientId, from, to } });
  return { worked, denied, recentClaims, reminders, queries, escalations, adrs, overpayments, rtp, updates };
}

/** Numbers for the weekly report (no claim numbers anywhere). */
export function weeklySummary(raw, { from, to, payers }) {
  const payerName = c => payers.find(p => p.id === c.payer_id)?.name ?? c.payer_name ?? 'Payer not matched';
  const inWeek = iso => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
  const day = today();
  const top = (list, n = 5) => {
    const by = new Map();
    for (const c of list) { const k = payerName(c); const r = by.get(k) ?? { name: k, count: 0, amount: 0 }; r.count += 1; r.amount += amountOf(c); by.set(k, r); }
    return [...by.values()].sort((a, b) => b.count - a.count).slice(0, n);
  };
  const worked = raw.worked;
  const outcomes = worked ? Object.fromEntries(OUTCOMES.map(o => [o.key, worked.filter(c => outcomeOf(c.status) === o.key).length])) : null;
  const q = raw.queries;
  const e = raw.escalations;
  const clientPayers = new Set((raw.recentClaims ?? []).map(c => c.payer_id).filter(Boolean));
  const monthStart = `${from.slice(0, 7)}-01`;
  const monthEnd = addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1);
  return {
    worked: worked && { count: worked.length, amount: worked.reduce((t, c) => t + amountOf(c), 0), outcomes, topPayers: top(worked) },
    denials: raw.denied && { count: raw.denied.length, amount: raw.denied.reduce((t, c) => t + amountOf(c), 0), topPayers: top(raw.denied, 3) },
    followupsOpen: raw.reminders == null && !raw.recentClaims ? null
      : (raw.reminders?.length ?? 0) + (raw.recentClaims ?? []).filter(c => c.follow_up && outcomeOf(c.status) === 'open').length,
    queries: q && {
      asked: q.filter(x => x.asked_on >= from && x.asked_on <= to).length,
      answered: q.filter(x => inWeek(x.answered_at)).length,
      open: q.filter(queryOpen).length,
      waiting: q.filter(x => x.status === 'waiting').length,
      oldest: Math.max(0, ...q.filter(queryOpen).map(queryAge)),
      escalated: q.filter(x => queryOpen(x) && x.escalated).length,
    },
    escalations: e && {
      opened: e.filter(x => inWeek(x.created_at)).length,
      resolved: e.filter(x => inWeek(x.resolved_at)).length,
      open: e.filter(x => ['open', 'in_progress'].includes(x.status)).length,
    },
    medicare: raw.adrs || raw.overpayments || raw.rtp ? {
      adrOpen: (raw.adrs ?? []).filter(x => !x.closed_at).length,
      adrDue14: (raw.adrs ?? []).filter(x => !x.closed_at && x.due_date && daysBetween(day, x.due_date) <= 14).length,
      overpaymentOpen: (raw.overpayments ?? []).filter(x => !x.closed_at).length,
      overpaymentAmount: (raw.overpayments ?? []).filter(x => !x.closed_at).reduce((t, x) => t + Number(x.amount ?? 0), 0),
      rtpOpen: (raw.rtp ?? []).filter(x => !x.resolved_at && x.in_fiss !== false).length,
    } : null,
    payerChanges: raw.updates && raw.updates.filter(u => u.payer_id && clientPayers.has(u.payer_id) && u.effective_date
      && u.effective_date >= monthStart && u.effective_date <= monthEnd)
      .map(u => ({ payer: payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name, effective: u.effective_date, change: u.change_text, action: u.action_needed })),
  };
}

const usd = n => `$${Math.round(n).toLocaleString()}`;

/** Copy-ready email text (counts and names only). */
export function weeklyEmail(s, { clientName, from, to }) {
  const L = [`Weekly update — ${clientName} — ${from} to ${to}`, ''];
  if (s.worked) {
    L.push(`Claims worked: ${s.worked.count} (${usd(s.worked.amount)})`);
    const o = s.worked.outcomes;
    L.push(`  Paid ${o.paid} · Appealed ${o.appealed} · Rebilled ${o.rebilled} · Denied final ${o.denied_final} · Still open ${o.open}`);
    if (s.worked.topPayers.length) L.push(`  Top payers: ${s.worked.topPayers.map(p => `${p.name} (${p.count})`).join(', ')}`);
  }
  if (s.denials) L.push(`New denials this week: ${s.denials.count} (${usd(s.denials.amount)})${s.denials.topPayers.length ? ` — ${s.denials.topPayers.map(p => p.name).join(', ')}` : ''}`);
  if (s.followupsOpen != null) L.push(`Open follow-ups: ${s.followupsOpen}`);
  if (s.queries) L.push('', `Questions for you: ${s.queries.asked} asked, ${s.queries.answered} answered this week; ${s.queries.open} open (${s.queries.waiting} waiting on your team${s.queries.oldest ? `, oldest ${s.queries.oldest} days` : ''})`);
  if (s.escalations) L.push(`Escalations: ${s.escalations.opened} opened, ${s.escalations.resolved} resolved, ${s.escalations.open} open`);
  if (s.medicare) L.push(`Medicare: ${s.medicare.adrOpen} ADRs open (${s.medicare.adrDue14} due within 14 days), ${s.medicare.overpaymentOpen} overpayments open (${usd(s.medicare.overpaymentAmount)}), ${s.medicare.rtpOpen} claims in RTP / suspense`);
  if (s.payerChanges?.length) {
    L.push('', 'Payer changes this month:');
    s.payerChanges.forEach(c => L.push(`  • ${c.payer} (${c.effective}): ${c.change}${c.action ? ` — ${c.action}` : ''}`));
  }
  return L.join('\n');
}

/** ✨ Optional 3–4 sentence summary written by Claude from the numbers only. */
export async function aiWeeklySummary(s, clientName, user) {
  assertAiAllowed();   // Owner Console: AI can be switched off per company
  const key = await kv.get('anthropic_key');
  if (!key) throw new Error('NO_KEY');
  let ok = false;
  try {
    const numbers = { ...s, payerChanges: (s.payerChanges ?? []).map(c => ({ payer: c.payer, effective: c.effective, change: c.change })) };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-5-5', max_tokens: 4000, output_config: { effort: 'low' }, fallbacks: 'default',
        system: 'You write the opening paragraph of a weekly status email from a medical billing company to its client (a home health / hospice agency). Use only the numbers given. 3–4 plain sentences, friendly and factual; mention what needs the client’s attention (questions waiting on them, ADRs due). No headings, no bullet points, no greetings or sign-off.',
        messages: [{ role: 'user', content: `Client: ${clientName}\nWeek numbers (JSON):\n${JSON.stringify(numbers)}` }],
      }),
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'The AI key in Settings was rejected.' : res.status === 429 ? 'The AI service is busy — try again in a minute.' : `AI request failed (${res.status}).`);
    const json = await res.json();
    if (json.stop_reason === 'refusal') throw new Error('The AI declined to write the summary.');
    const text = (json.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    ok = true;
    return text;
  } finally {
    logAudit({ actor: user, action: 'report_ai_summary', entityType: 'report', details: { report: 'weekly_client', ok } });
  }
}

export function logExport(user, report, details) {
  logAudit({ actor: user, action: 'report_export', entityType: 'report', details: { report, ...details } });
}
