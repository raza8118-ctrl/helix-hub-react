// Owner Console → Company Data (PO 2026-11-10). One company's data per module, read in the browser with the owner's
// session (the owner may read every company). Read-only in Stage 1. Every opening of a company + module is written to the
// owner log and to that company's Audit Log — with the company, module and row count only, never patient values.
import { supabase } from './supabase';
import { ownerLog, companyAudit, codeOf } from './owner';

export const ROW_CAP = 20000;   // rows read per list; the page says so when a list is longer

/** Reads a whole table of one company, 1,000 rows at a time, up to ROW_CAP. → { rows, capped } or null (no table). */
async function readAll(prefix, table, select = '*') {
  const rows = [];
  for (let from = 0; from < ROW_CAP; from += 1000) {
    const { data, error } = await supabase.from(prefix + table).select(select).order('id').range(from, from + 999);
    if (error) return from === 0 ? null : { rows, capped: false };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows, capped: false };
  }
  return { rows, capped: true };
}
const list = r => r?.rows ?? [];
const byId = rows => new Map(rows.map(r => [r.id, r]));
const yesNo = v => (v == null ? '' : v ? 'Yes' : 'No');
const day = v => (v ? String(v).slice(0, 10) : '');
const money = v => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const active = r => (r.active === false ? 'Inactive' : 'Active');

/** Names for the lookups most lists need (users, clients, payers). */
async function lookups(prefix) {
  const [users, clients, payers] = await Promise.all([
    readAll(prefix, 'users', 'id,emp_id,name'), readAll(prefix, 'clients', 'id,name'), readAll(prefix, 'payers', 'id,name'),
  ]);
  const people = new Map(list(users).map(u => [u.emp_id, u.name]));
  const c = byId(list(clients));
  const p = byId(list(payers));
  return {
    person: id => (id ? people.get(id) ?? id : ''),
    client: id => (id ? c.get(id)?.name ?? `#${id}` : ''),
    payer: id => (id ? p.get(id)?.name ?? `#${id}` : ''),
  };
}

/**
 * The modules. phi = may hold patient information (claim numbers, dates of service, free text) → warning banner, and in
 * Stage 2 a typed reason before any download. Each view: label, columns [key, label], load(prefix) → { rows, capped } | null.
 */
export const MODULES = [
  {
    id: 'payers', label: 'Payer Directory', icon: 'bookmark', master: 'payer',
    views: [{
      id: 'payers', label: 'Payers',
      columns: [['name', 'Payer'], ['payer_type', 'Type'], ['aliases', 'Other names'], ['ids', 'Payer IDs'], ['contacts', 'Contacts'],
        ['limits', 'Filing limits'], ['notes', 'Notes'], ['source', 'Source'], ['verified', 'Verified'], ['status', 'Status']],
      load: async prefix => {
        const [payers, ids, contacts, limits, notes] = await Promise.all(['payers', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_notes'].map(t => readAll(prefix, t)));
        if (!payers) return null;
        const group = rows => list(rows).filter(r => r.active !== false).reduce((m, r) => m.set(r.payer_id, [...(m.get(r.payer_id) ?? []), r]), new Map());
        const [gi, gc, gl, gn] = [group(ids), group(contacts), group(limits), group(notes)];
        return {
          capped: payers.capped,
          rows: payers.rows.map(p => ({
            id: p.id, _raw: p, name: p.name, payer_type: p.payer_type ?? '', aliases: (p.aliases ?? []).join(', '),
            ids: (gi.get(p.id) ?? []).map(x => x.electronic_payer_id).join(', '), contacts: (gc.get(p.id) ?? []).length,
            limits: (gl.get(p.id) ?? []).map(x => `${x.limit_type} ${x.days}d`).join(', '), notes: (gn.get(p.id) ?? []).length,
            source: p.source ?? '', verified: p.verified_at ? day(p.verified_at) : '⚠ not verified', status: active(p),
          })),
        };
      },
    }],
  },
  {
    id: 'denials', label: 'Denial codes & steps', icon: 'shield', master: 'code',
    views: [{
      id: 'codes', label: 'Codes',
      columns: [['type', 'Type'], ['code', 'Code'], ['plain_reason', 'Plain-English reason'], ['official_text', 'Official description'],
        ['steps', 'Steps (common · client · payer)'], ['source', 'Source'], ['verified', 'Verified'], ['status', 'Status']],
      load: async prefix => {
        const [codes, steps] = await Promise.all([readAll(prefix, 'denial_codes'), readAll(prefix, 'denial_steps', 'id,code_id,scope,active')]);
        if (!codes) return null;
        const count = new Map();
        list(steps).filter(s => s.active !== false).forEach(s => {
          const c = count.get(s.code_id) ?? { common: 0, client: 0, payer: 0 };
          c[s.scope] = (c[s.scope] ?? 0) + 1;
          count.set(s.code_id, c);
        });
        return {
          capped: codes.capped,
          rows: codes.rows.map(c => {
            const n = count.get(c.id) ?? { common: 0, client: 0, payer: 0 };
            return {
              id: c.id, _raw: c, type: String(c.code_type ?? '').toUpperCase(), code: c.code, plain_reason: c.plain_reason ?? '',
              official_text: c.official_text ?? '', steps: `${n.common} · ${n.client} · ${n.payer}`, source: c.source ?? '',
              verified: c.verified_at ? day(c.verified_at) : '', status: c.stopped_on ? `Retired ${day(c.stopped_on)}` : active(c),
            };
          }),
        };
      },
    }],
  },
  {
    id: 'sops', label: 'SOPs', icon: 'book', master: 'sop',
    views: [{
      id: 'sops', label: 'SOPs',
      columns: [['path', 'Category › Software › Task'], ['title', 'SOP'], ['client', 'Client'], ['state', 'Status'], ['steps', 'Steps'],
        ['owner', 'Owner'], ['verified', 'Last verified'], ['status', 'Active']],
      load: async prefix => {
        const [sops, cats, sws, tasks, look] = await Promise.all([readAll(prefix, 'sops'), readAll(prefix, 'sop_categories'),
          readAll(prefix, 'sop_software'), readAll(prefix, 'sop_tasks'), lookups(prefix)]);
        if (!sops) return null;
        const [c, s, t] = [byId(list(cats)), byId(list(sws)), byId(list(tasks))];
        return {
          capped: sops.capped,
          rows: sops.rows.map(x => {
            const task = t.get(x.task_id);
            const sw = task && s.get(task.software_id);
            const cat = sw && c.get(sw.category_id);
            return {
              id: x.id, _raw: x, path: [cat?.name, sw?.name, task?.name].filter(Boolean).join(' › '), title: x.title, client: look.client(x.client_id) || 'All clients',
              state: x.status === 'published' ? 'Published' : 'Draft', steps: Array.isArray(x.steps) ? x.steps.length : 0,
              owner: look.person(x.owner), verified: day(x.last_verified_at), status: active(x),
            };
          }),
        };
      },
    }],
  },
  {
    id: 'codes', label: 'Code lists', icon: 'calc', master: 'ref_code',
    views: [{
      id: 'ref_codes', label: 'Codes',
      columns: [['code_set', 'Code set'], ['code', 'Code'], ['description', 'Description'], ['notes', 'Notes'], ['list_year', 'Year'], ['status', 'Status']],
      load: async prefix => {
        const r = await readAll(prefix, 'ref_codes');
        if (!r) return null;
        return {
          capped: r.capped,
          rows: r.rows.map(x => ({ id: x.id, _raw: x, code_set: { revenue: 'Revenue', hipps: 'HIPPS', icd10: 'ICD-10' }[x.code_set] ?? x.code_set, code: x.code,
            description: x.description ?? '', notes: x.notes ?? '', list_year: x.list_year ?? '', status: x.retired ? 'Retired' : active(x) })),
        };
      },
    }],
  },
  {
    id: 'queries', label: 'Client Queries', icon: 'chat', phi: true,
    views: [{
      id: 'client_queries', label: 'Queries',
      columns: [['asked_on', 'Asked'], ['client', 'Client'], ['payer', 'Payer'], ['claim_number', 'Claim #'], ['category', 'Category'],
        ['question', 'Question'], ['status', 'Status'], ['owner', 'Owner'], ['expected_on', 'Expected'], ['answered_at', 'Answered']],
      load: async prefix => {
        const [r, look] = await Promise.all([readAll(prefix, 'client_queries'), lookups(prefix)]);
        if (!r) return null;
        return {
          capped: r.capped,
          rows: r.rows.map(x => ({ id: x.id, _raw: x, asked_on: day(x.asked_on ?? x.created_at), client: look.client(x.client_id), payer: look.payer(x.payer_id),
            claim_number: x.claim_number ?? '', category: x.category ?? '', question: x.question ?? '', status: `${x.status ?? ''}${x.cleared ? ' (cleared)' : ''}`,
            owner: look.person(x.owner_emp_id), expected_on: day(x.expected_on), answered_at: day(x.answered_at) })),
        };
      },
    }],
  },
  {
    id: 'worklists', label: 'Worklists', icon: 'list', phi: true,
    views: [{
      id: 'worklist_items', label: 'Worklist claims',
      columns: [['worklist', 'Worklist'], ['claim_number', 'Claim #'], ['payer', 'Payer'], ['client', 'Client'], ['dos', 'DOS'], ['balance', 'Balance'],
        ['aging_days', 'Aging'], ['status', 'Status'], ['assigned', 'Assigned to'], ['follow_up', 'Follow-up']],
      load: async prefix => {
        const [items, lists, look] = await Promise.all([readAll(prefix, 'worklist_items'), readAll(prefix, 'worklists', 'id,name'), lookups(prefix)]);
        if (!items) return null;
        const l = byId(list(lists));
        return {
          capped: items.capped,
          rows: items.rows.map(x => ({ id: x.id, _raw: x, worklist: l.get(x.worklist_id)?.name ?? '', claim_number: x.claim_number ?? '',
            payer: x.payer_name || look.payer(x.payer_id), client: look.client(x.client_id), dos: [day(x.dos_from), day(x.dos_to)].filter(Boolean).join(' – '),
            balance: money(x.balance), aging_days: x.aging_days ?? '', status: `${x.status ?? ''}${x.cleared ? ' (cleared)' : ''}`,
            assigned: look.person(x.assigned_to), follow_up: day(x.follow_up) })),
        };
      },
    }],
  },
  {
    id: 'qa', label: 'QA', icon: 'clipboard', phi: true,
    views: [{
      id: 'qa_audits', label: 'QA audits',
      columns: [['work_date', 'Work date'], ['agent', 'Agent'], ['auditor', 'Auditor'], ['scorecard', 'Scorecard'], ['client', 'Client'],
        ['claim_number', 'Claim #'], ['score', 'Score'], ['passed', 'Passed'], ['fatal', 'Fatal'], ['status', 'Status']],
      load: async prefix => {
        const [r, cards, look] = await Promise.all([readAll(prefix, 'qa_audits'), readAll(prefix, 'qa_scorecards', 'id,name'), lookups(prefix)]);
        if (!r) return null;
        const sc = byId(list(cards));
        return {
          capped: r.capped,
          rows: r.rows.map(x => ({ id: x.id, _raw: x, work_date: day(x.work_date), agent: look.person(x.agent_emp_id), auditor: look.person(x.auditor_emp_id),
            scorecard: sc.get(x.scorecard_id)?.name ?? '', client: look.client(x.client_id), claim_number: x.claim_number ?? '',
            score: x.score == null ? '' : `${Math.round(x.score * 10) / 10}%`, passed: yesNo(x.passed), fatal: yesNo(x.fatal), status: x.status ?? '' })),
        };
      },
    }],
  },
  {
    id: 'reports', label: 'Reports', icon: 'prodreport',
    views: [{
      id: 'daily_logs', label: 'Daily reports',
      columns: [['date', 'Date'], ['person', 'Employee'], ['attendance', 'Attendance'], ['total', 'Total'], ['target', 'Target'],
        ['prod', 'Prod %'], ['quality', 'Quality %'], ['submitted', 'Submitted'], ['remarks', 'Remarks']],
      load: async prefix => {
        const [r, look] = await Promise.all([readAll(prefix, 'daily_logs'), lookups(prefix)]);
        if (!r) return null;
        return {
          capped: r.capped,
          rows: r.rows.map(x => {
            const target = x.adj_target ?? x.target;
            return { id: x.id, _raw: x, date: day(x.date), person: look.person(x.emp_id), attendance: x.attendance_status ?? '', total: x.total ?? '',
              target: target ?? '', prod: target ? `${Math.round((x.total / target) * 1000) / 10}%` : '', quality: x.quality == null ? '' : `${x.quality}%`,
              submitted: yesNo(x.submitted), remarks: x.remarks ?? '' };
          }),
        };
      },
    }],
  },
  {
    id: 'medicare', label: 'Medicare ADR / RTP', icon: 'alert', phi: true,
    views: [
      {
        id: 'medicare_adrs', label: 'ADRs',
        columns: [['adr_date', 'ADR date'], ['client', 'Client'], ['claim_number', 'Claim #'], ['amount', 'Amount'], ['due_date', 'Due'],
          ['submitted_on', 'Submitted'], ['decision', 'Decision'], ['status', 'Status'], ['owner', 'Owner']],
        load: async prefix => {
          const [r, look] = await Promise.all([readAll(prefix, 'medicare_adrs'), lookups(prefix)]);
          if (!r) return null;
          return {
            capped: r.capped,
            rows: r.rows.map(x => ({ id: x.id, _raw: x, adr_date: day(x.adr_date), client: look.client(x.client_id), claim_number: x.claim_number ?? '',
              amount: money(x.amount), due_date: day(x.due_date), submitted_on: day(x.submitted_on), decision: x.decision ?? '',
              status: `${x.status ?? ''}${x.cleared ? ' (cleared)' : ''}`, owner: look.person(x.owner_emp_id) })),
          };
        },
      },
      {
        id: 'medicare_rtp_items', label: 'RTP claims',
        columns: [['client', 'Client'], ['claim_number', 'Claim #'], ['location', 'Location'], ['reason_code', 'Reason code'], ['amount', 'Amount'],
          ['since', 'In status since'], ['work_status', 'Work status'], ['owner', 'Owner'], ['resolved_at', 'Resolved']],
        load: async prefix => {
          const [r, look] = await Promise.all([readAll(prefix, 'medicare_rtp_items'), lookups(prefix)]);
          if (!r) return null;
          return {
            capped: r.capped,
            rows: r.rows.map(x => ({ id: x.id, _raw: x, client: look.client(x.client_id), claim_number: x.claim_number ?? '', location: x.location ?? '',
              reason_code: x.reason_code ?? '', amount: money(x.amount), since: day(x.in_status_since), work_status: `${x.work_status ?? ''}${x.cleared ? ' (cleared)' : ''}`,
              owner: look.person(x.owner_emp_id), resolved_at: day(x.resolved_at) })),
          };
        },
      },
    ],
  },
];
export const moduleOf = id => MODULES.find(m => m.id === id);

/** Owner log + the company's Audit Log: what was looked at (company, module, list, row count) — never row contents. */
export function logCompanyData(owner, company, action, details) {
  ownerLog(owner, action, codeOf(company), details.module ?? null, details);
  companyAudit(company.prefix ?? '', owner, action, { name: details.module ?? null }, details);
}
