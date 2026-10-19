import { useState, useEffect, useCallback } from 'react';
import { S, db } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { hasAccess } from '../../lib/access';
import Modal from '../../components/shared/Modal';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';
import { actionLabel } from '../../lib/auditLabels';
import PayerForms from './PayerForms';
import { VerifiedBadge, ReportWrongInfo, OpenReports } from './PayerAccuracy';

// ── Option lists ──────────────────────────────────────────────────────────────
const opts = list => list.map(v => (typeof v === 'string' ? { value: v, label: v } : v));

const LINES_OF_BUSINESS = opts(['Medicare Advantage', 'Medicaid MCO', 'Commercial HMO', 'Commercial PPO', 'Commercial EPO/POS', 'Marketplace / Exchange', 'Medicare Supplement', 'Other']);
const BLUECARD          = opts([{ value: 'home', label: 'BlueCard home plan' }, { value: 'host', label: 'BlueCard host plan' }]);
const CLEARINGHOUSES    = ['Waystar', 'Availity', 'Change Healthcare', 'Office Ally', 'TriZetto', 'Claim.MD'];
const TRANSACTIONS      = opts(['Claims (837)', 'ERA (835)', 'Eligibility (270/271)', 'Claim status (276/277)', 'Other']);
const DEPARTMENTS       = opts([
  { value: 'claims', label: 'Claims' }, { value: 'auth', label: 'Authorization' }, { value: 'appeals', label: 'Appeals' },
  { value: 'provider_relations', label: 'Provider Relations' }, { value: 'eligibility', label: 'Eligibility' }, { value: 'other', label: 'Other' },
]);
const LIMIT_TYPES       = opts([
  { value: 'TFL', label: 'Timely filing (TFL)' }, { value: 'CCTFL', label: 'Corrected claim (CCTFL)' },
  { value: 'AFL', label: 'Appeal (AFL)' }, { value: 'RECON', label: 'Reconsideration' },
]);
const MEASURED_FROM     = opts(['Date of service', 'Discharge date', 'Denial / EOB date', 'Paid date', 'Other']);
const NOTE_CATEGORIES   = opts(['General', 'Claims', 'Auth', 'Appeals', 'Portal', 'Other']);

const labelOf = (list, v) => list.find(o => o.value === v)?.label ?? v;
const orderOf = (list, v) => { const i = list.findIndex(o => o.value === v); return i < 0 ? list.length : i; };

// Only http(s) links are opened; anything else gets https:// in front
const safeUrl = u => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

const limitText = r => (r.days != null ? `${r.days} days${r.measured_from ? ` from ${r.measured_from.toLowerCase()}` : ''}` : '—');
// A client override replaces the standard limit with the same type, level and plan
const limitKey = r => `${r.limit_type}|${r.level ?? ''}|${r.plan_id ?? ''}`;

// Last client picked on the payer card, per browser
const CLIENT_KEY = 'hh_payer_card_client';
function readClientChoice() {
  try { return localStorage.getItem(CLIENT_KEY) ?? ''; } catch { return ''; }
}
function saveClientChoice(id) {
  try { if (id) localStorage.setItem(CLIENT_KEY, id); else localStorage.removeItem(CLIENT_KEY); } catch { /* storage unavailable */ }
}

// ── Sections ──────────────────────────────────────────────────────────────────
// fields: key, label, type (text | textarea | number | checkbox | select | plan), options, required, hint
// show(row, ctx) → { title, sub, items: [{ label, value, copy, href }] }
const SECTIONS = [
  {
    key: 'plans', table: 'payer_plans', entity: 'payer_plan', title: 'Plans & lines of business', icon: '🗂️', one: 'Plan',
    fields: [
      { key: 'plan_name', label: 'Plan name', type: 'text', required: true, hint: 'e.g. Blue Advantage HMO' },
      { key: 'line_of_business', label: 'Line of business', type: 'select', options: LINES_OF_BUSINESS },
      { key: 'state', label: 'State', type: 'text', hint: 'e.g. TX' },
      { key: 'is_delegated', label: 'Delegated to an IPA / medical group', type: 'checkbox' },
      { key: 'delegated_group', label: 'Delegated group name', type: 'text' },
      { key: 'bluecard_role', label: 'BlueCard', type: 'select', options: BLUECARD },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    sort: (a, b) => (a.plan_name ?? '').localeCompare(b.plan_name ?? ''),
    show: r => ({
      title: r.plan_name,
      sub: [r.line_of_business, r.state, r.bluecard_role && labelOf(BLUECARD, r.bluecard_role)].filter(Boolean).join(' · '),
      items: [
        r.is_delegated && { label: 'Delegated to', value: r.delegated_group || 'Yes (group not named)', copy: !!r.delegated_group },
        r.notes && { label: 'Notes', value: r.notes },
      ],
    }),
  },
  {
    key: 'ids', table: 'payer_ids', entity: 'payer_electronic_id', title: 'Payer IDs', icon: '🔢', one: 'Payer ID',
    fields: [
      { key: 'electronic_payer_id', label: 'Payer ID', type: 'text', required: true, hint: 'e.g. 84980' },
      { key: 'clearinghouse', label: 'Clearinghouse (leave blank for direct to payer)', type: 'text', suggestions: CLEARINGHOUSES },
      { key: 'transaction_type', label: 'Used for', type: 'select', options: TRANSACTIONS },
      { key: 'enrollment_required', label: 'Enrollment required before use', type: 'checkbox' },
      { key: 'plan_id', label: 'Applies to', type: 'plan' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    sort: (a, b) => (a.clearinghouse ?? '').localeCompare(b.clearinghouse ?? ''),
    show: (r, ctx) => ({
      title: r.clearinghouse || 'Direct to payer',
      sub: [r.transaction_type, ctx.planName(r.plan_id), r.enrollment_required && 'Enrollment required'].filter(Boolean).join(' · '),
      items: [
        { label: 'Payer ID', value: r.electronic_payer_id, copy: true, big: true },
        r.notes && { label: 'Notes', value: r.notes },
      ],
    }),
  },
  {
    key: 'contacts', table: 'payer_contacts', entity: 'payer_contact', title: 'Contacts', icon: '☎️', one: 'Contact',
    fields: [
      { key: 'department', label: 'Department', type: 'select', options: DEPARTMENTS, required: true },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'phone_ext', label: 'Extension / IVR option', type: 'text' },
      { key: 'fax', label: 'Fax', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'portal_url', label: 'Portal / website link', type: 'text', hint: 'https://…' },
      { key: 'attention_line', label: 'Attention line', type: 'text', hint: 'e.g. Attn: Appeals Dept' },
      { key: 'mailing_address', label: 'Mailing address', type: 'textarea' },
      { key: 'hours', label: 'Hours', type: 'text', hint: 'e.g. Mon–Fri 8am–5pm CT' },
      { key: 'plan_id', label: 'Applies to', type: 'plan' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    sort: (a, b) => orderOf(DEPARTMENTS, a.department) - orderOf(DEPARTMENTS, b.department),
    show: (r, ctx) => {
      const fullAddress = [r.attention_line, r.mailing_address].filter(Boolean).join('\n');
      return {
        title: labelOf(DEPARTMENTS, r.department),
        sub: [ctx.planName(r.plan_id), r.hours].filter(Boolean).join(' · '),
        items: [
          r.phone && { label: 'Phone', value: r.phone_ext ? `${r.phone} (ext/option ${r.phone_ext})` : r.phone, copyValue: r.phone, copy: true },
          r.fax && { label: 'Fax', value: r.fax, copy: true },
          r.email && { label: 'Email', value: r.email, copy: true },
          r.portal_url && { label: 'Portal', value: r.portal_url, href: safeUrl(r.portal_url), copy: true },
          fullAddress && { label: 'Mailing address', value: fullAddress, copy: true },
          r.notes && { label: 'Notes', value: r.notes },
        ],
      };
    },
  },
  {
    key: 'limits', table: 'payer_limits', entity: 'payer_limit', title: 'Filing & appeal limits', icon: '⏳', one: 'Limit',
    fields: [
      { key: 'limit_type', label: 'Limit', type: 'select', options: LIMIT_TYPES, required: true },
      { key: 'level', label: 'Level (for appeals / recons)', type: 'number', hint: '1, 2…' },
      { key: 'days', label: 'Days allowed', type: 'number', required: true },
      { key: 'measured_from', label: 'Counted from', type: 'select', options: MEASURED_FROM },
      { key: 'plan_id', label: 'Applies to', type: 'plan' },
      { key: 'client_id', label: 'Client contract (leave blank for the standard limit)', type: 'client' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    // Standard limits (client_id null) for everyone; with a client picked, that client's
    // contract values (1.5) replace the matching standard ones
    filter: (r, ctx) => (r.client_id == null ? !ctx.overridden(r) : String(r.client_id) === ctx.clientId),
    sort: (a, b) => orderOf(LIMIT_TYPES, a.limit_type) - orderOf(LIMIT_TYPES, b.limit_type) || (a.level ?? 0) - (b.level ?? 0),
    show: (r, ctx) => {
      const base = r.client_id != null ? ctx.baseFor(r) : null;
      return {
        title: `${labelOf(LIMIT_TYPES, r.limit_type)}${r.level ? ` — level ${r.level}` : ''}`,
        tag: r.client_id != null ? `Client contract: ${ctx.clientName(r.client_id)}` : null,
        sub: ctx.planName(r.plan_id),
        items: [
          { label: 'Allowed', value: limitText(r), big: true },
          r.client_id != null && { label: 'Standard limit', value: base ? limitText(base) : 'No standard limit recorded' },
          r.notes && { label: 'Notes', value: r.notes },
        ],
      };
    },
  },
  {
    key: 'notes', table: 'payer_notes', entity: 'payer_note', title: 'Tips & notes', icon: '📝', one: 'Note',
    fields: [
      { key: 'note', label: 'Note (no patient information)', type: 'textarea', required: true },
      { key: 'category', label: 'Category', type: 'select', options: NOTE_CATEGORIES },
      { key: 'pinned', label: 'Pin to the top', type: 'checkbox' },
      { key: 'plan_id', label: 'Applies to', type: 'plan' },
    ],
    sort: (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')),
    show: (r, ctx) => ({
      title: `${r.pinned ? '📌 ' : ''}${r.category || 'Note'}`,
      sub: ctx.planName(r.plan_id),
      items: [{ label: '', value: r.note }],
    }),
  },
];

const blankFor = section => Object.fromEntries(section.fields.map(f => [f.key, f.type === 'checkbox' ? false : '']));

function toDb(section, values) {
  const out = {};
  for (const f of section.fields) {
    const v = values[f.key];
    if (f.type === 'checkbox') out[f.key] = !!v;
    else if (f.type === 'number') out[f.key] = v === '' || v == null ? null : parseInt(v, 10);
    else if (f.type === 'plan' || f.type === 'client') out[f.key] = v === '' || v == null ? null : Number(v);
    else out[f.key] = typeof v === 'string' ? (v.trim() || null) : (v ?? null);
  }
  if ('is_delegated' in out && !out.is_delegated) out.delegated_group = null;
  return out;
}

// ── One value with its label and copy button ──────────────────────────────────
function Value({ item }) {
  return (
    <div style={{ minWidth: 0 }}>
      {item.label && <div className="text-sm text-muted">{item.label}</div>}
      <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: item.big ? 16 : 14, fontWeight: item.big ? 700 : 400 }}>
          {item.href
            ? <a href={item.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{item.value} ↗</a>
            : item.value}
        </div>
        {item.copy && <CopyButton value={item.copyValue ?? item.value} />}
      </div>
    </div>
  );
}

/**
 * Full payer card (roadmap 1.3): plans, payer IDs, contacts, limits, notes and forms,
 * with client contract limits (1.5) and accuracy tracking (1.6: verified dates,
 * "Report wrong info", change history).
 * Everyone can read it and report problems; "Edit Payer Directory" (lib/access.js)
 * can add / edit / verify / make inactive and resolve reports.
 */
export default function PayerCard({ payer, user, onClose }) {
  const canEdit = hasAccess(user, 'payers_edit');
  const [data, setData]         = useState({});
  const [loading, setLoading]   = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm]         = useState(null);   // { section, id?, values, error }
  const [saving, setSaving]     = useState(false);
  const [clients, setClients]   = useState([]);
  const [clientId, setClientId] = useState(readClientChoice);   // '' = standard limits
  const [names, setNames]       = useState({});                  // emp_id → name, for "verified by"
  const [reports, setReports]   = useState(undefined);           // null = reports table missing
  const [history, setHistory]   = useState(null);                // null = closed

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(SECTIONS.map(s => S.get(s.table, { payer_id: payer.id })));
    setData(Object.fromEntries(SECTIONS.map((s, i) => [s.key, results[i]])));   // null = table missing
    setLoading(false);
  }, [payer.id]);

  const loadReports = useCallback(async () => {
    setReports(await S.get('payer_reports', { payer_id: payer.id }));
  }, [payer.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadReports(); }, [loadReports]);
  useEffect(() => {
    db('users').select('emp_id,name').then(({ data: rows }) =>
      setNames(Object.fromEntries((rows ?? []).map(u => [u.emp_id, u.name ?? u.emp_id]))));
  }, []);
  useEffect(() => {
    S.get('clients').then(rows => setClients((rows ?? []).filter(c => c.active !== false)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))));
  }, []);

  // A remembered client that no longer exists falls back to standard limits
  const activeClientId = clients.some(c => String(c.id) === clientId) ? clientId : '';
  function pickClient(id) { setClientId(id); saveClientChoice(id); }

  const plans  = (data.plans ?? []).filter(p => p.active !== false);
  const limits = data.limits ?? [];
  const overrideKeys = new Set(limits
    .filter(r => r.active !== false && r.client_id != null && String(r.client_id) === activeClientId)
    .map(limitKey));
  const ctx = {
    clientId:   activeClientId,
    planName:   id => (id == null ? '' : `Plan: ${(data.plans ?? []).find(p => p.id === id)?.plan_name ?? 'unknown'}`),
    clientName: id => clients.find(c => c.id === id)?.name ?? 'unknown client',
    overridden: base => overrideKeys.has(limitKey(base)),
    baseFor:    o => limits.find(r => r.client_id == null && r.active !== false && limitKey(r) === limitKey(o)),
  };
  const tablesMissing = !loading && SECTIONS.every(s => data[s.key] == null);

  function openAdd(section) {
    const values = blankFor(section);
    if (section.key === 'limits' && activeClientId) values.client_id = activeClientId;   // adding for the client being viewed
    setForm({ section, values, verify: true, error: '' });
  }
  function openEdit(section, row) {
    const values = blankFor(section);
    for (const f of section.fields) values[f.key] = row[f.key] ?? values[f.key];
    setForm({ section, id: row.id, values, verify: true, error: '' });
  }

  const openReportsFor = (table, id) =>
    (reports ?? []).filter(r => r.status === 'open' && r.entity_table === table && r.entity_id === id).length;

  async function markVerified(section, row, title) {
    if (!await confirmDialog({
      title: 'Mark as verified?',
      message: `${payer.name} → ${section.title}${title ? ` → ${title}` : ''}\n\nConfirm you checked this against the payer (call, portal or current document) today.`,
      confirmText: 'Mark Verified',
    })) return;
    const now = new Date().toISOString();
    const ok = await S.update(section.table, { verified_at: now, verified_by: user.emp_id }, { id: row.id });
    if (!ok) return;
    logAudit({
      actor: user, action: 'verify_payer_info', entityType: section.entity, entityId: row.id,
      details: { payer: payer.name, payer_id: payer.id, section: section.title },
    });
    await load();
  }

  // Change log for this payer, from the audit log (editors only)
  async function toggleHistory() {
    if (history) return setHistory(null);
    setHistory({ loading: true, rows: [] });
    let res = await db('audit_log').select('*')
      .or(`details->>payer_id.eq.${payer.id},and(entity_type.eq.payer,entity_id.eq.${payer.id})`)
      .order('created_at', { ascending: false }).limit(200);
    if (res.error) {   // entity columns not added yet — payer detail entries only
      res = await db('audit_log').select('*').eq('details->>payer_id', String(payer.id))
        .order('created_at', { ascending: false }).limit(200);
    }
    setHistory({ loading: false, rows: res.data ?? [], error: !!res.error });
  }
  const setV = patch => setForm(f => ({ ...f, values: { ...f.values, ...patch }, error: '' }));

  async function save() {
    const { section, id, values } = form;
    const missing = section.fields.filter(f => f.required && (values[f.key] === '' || values[f.key] == null));
    if (missing.length) return setForm(f => ({ ...f, error: `Please fill in: ${missing.map(m => m.label).join(', ')}.` }));
    const editing = id != null;
    if (!await confirmDialog({ title: editing ? 'Save changes?' : `Add this ${section.one.toLowerCase()}?`, message: `${payer.name} → ${section.title}`, confirmText: editing ? 'Save Changes' : 'Add' })) return;
    const now = new Date().toISOString();
    const stamp = { updated_by: user.emp_id, updated_at: now, ...(form.verify ? { verified_at: now, verified_by: user.emp_id } : {}) };
    const row = { ...toDb(section, values), ...stamp };
    setSaving(true);
    const result = editing
      ? await S.update(section.table, row, { id })
      : await S.set(section.table, { ...row, payer_id: payer.id, active: true, created_by: user.emp_id });
    setSaving(false);
    if (!result?.length) return setForm(f => ({ ...f, error: 'Could not save. Please try again.' }));
    logAudit({
      actor: user, action: editing ? 'edit_payer_info' : 'add_payer_info',
      entityType: section.entity, entityId: result[0].id,
      details: { payer: payer.name, payer_id: payer.id, section: section.title },
    });
    setForm(null);
    await load();
  }

  async function toggleActive(section, row) {
    const deactivating = row.active !== false;
    if (!await confirmDialog(deactivating
      ? { title: `Make this ${section.one.toLowerCase()} inactive?`, message: 'It will be hidden from the payer card. Nothing is deleted — you can reactivate it.', tone: 'warning', confirmText: 'Make Inactive' }
      : { title: `Reactivate this ${section.one.toLowerCase()}?`, message: 'It will show on the payer card again.', confirmText: 'Reactivate' })) return;
    const ok = await S.update(section.table, { active: !deactivating, updated_by: user.emp_id, updated_at: new Date().toISOString() }, { id: row.id });
    if (!ok) return;
    logAudit({
      actor: user, action: deactivating ? 'deactivate_payer_info' : 'activate_payer_info',
      entityType: section.entity, entityId: row.id, details: { payer: payer.name, payer_id: payer.id, section: section.title },
    });
    await load();
  }

  function renderField(f) {
    const v = form.values[f.key];
    if (f.type === 'checkbox') {
      return (
        <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
          <input type="checkbox" checked={!!v} onChange={e => setV({ [f.key]: e.target.checked })} />
          {f.label}
        </label>
      );
    }
    let input;
    if (f.type === 'textarea') input = <textarea rows={3} value={v ?? ''} onChange={e => setV({ [f.key]: e.target.value })} placeholder={f.hint} />;
    else if (f.type === 'select' || f.type === 'plan' || f.type === 'client') {
      const options = f.type === 'plan'   ? plans.map(p => ({ value: String(p.id), label: p.plan_name }))
                    : f.type === 'client' ? clients.map(c => ({ value: String(c.id), label: c.name }))
                    : f.options;
      const empty = f.type === 'plan' ? 'Whole payer (all plans)' : f.type === 'client' ? 'Standard (all clients)' : '— Not set —';
      input = (
        <select value={v == null ? '' : String(v)} onChange={e => setV({ [f.key]: e.target.value })}>
          <option value="">{empty}</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    } else {
      const listId = f.suggestions ? `sugg-${form.section.key}-${f.key}` : undefined;
      input = (
        <>
          <input type={f.type === 'number' ? 'number' : 'text'} value={v ?? ''} list={listId} placeholder={f.hint}
            onChange={e => setV({ [f.key]: e.target.value })} />
          {f.suggestions && <datalist id={listId}>{f.suggestions.map(s => <option key={s} value={s} />)}</datalist>}
        </>
      );
    }
    return (
      <div key={f.key} className="field">
        <label>{f.label}{f.required ? ' *' : ''}</label>
        {input}
      </div>
    );
  }

  return (
    <div className="card mb-16" style={{ borderLeft: '4px solid var(--accent)' }}>
      {/* Header */}
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="card-title" style={{ fontSize: 18 }}>{payer.name}</span>
          <CopyButton value={payer.name} />
          {payer.payer_type && <span className="badge badge-blue">{payer.payer_type}</span>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {canEdit && (
            <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
            </label>
          )}
          {canEdit && <button className="btn-sm" onClick={toggleHistory}>{history ? 'Hide history' : '🕘 History'}</button>}
          {reports != null && (
            <ReportWrongInfo payer={payer} section="Payer (general)" table="payers" entityId={payer.id}
              user={user} onReported={loadReports} />
          )}
          <button className="btn-sm" onClick={onClose}>✕ Close</button>
        </div>
      </div>

      {canEdit && <OpenReports payer={payer} reports={reports} user={user} onChanged={loadReports} />}

      {history && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10, marginBottom: 12, maxHeight: 280, overflowY: 'auto' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>🕘 Change history</div>
          {history.loading && <div className="text-sm text-muted">Loading…</div>}
          {!history.loading && history.error && <div className="text-sm text-muted">History isn’t available yet (audit log update not run).</div>}
          {!history.loading && !history.error && history.rows.length === 0 && <div className="text-sm text-muted">No changes recorded yet.</div>}
          {history.rows.map(h => (
            <div key={h.id} className="text-sm" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="text-muted">{new Date(h.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {' · '}<strong>{h.actor_name ?? h.actor_emp_id}</strong>{' · '}{actionLabel(h.action)}
              {h.details?.section ? ` — ${h.details.section}` : ''}{h.details?.title ? `: ${h.details.title}` : ''}
            </div>
          ))}
        </div>
      )}

      {(payer.aliases ?? []).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Also known as</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {payer.aliases.map(a => (
              <span key={a} className="row" style={{ gap: 4, alignItems: 'center' }}>
                <span className="badge badge-gray">{a}</span>
                <CopyButton value={a} />
              </span>
            ))}
          </div>
        </div>
      )}
      {payer.notes && <div className="text-sm" style={{ marginBottom: 12 }}>{payer.notes}</div>}

      {clients.length > 0 && !tablesMissing && (
        <label className="row text-sm" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="text-muted">Showing limits for:</span>
          <select value={activeClientId} onChange={e => pickClient(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Standard (all clients)</option>
            {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </label>
      )}

      {loading && <div className="text-muted" style={{ padding: 12 }}>Loading payer details…</div>}
      {tablesMissing && (
        <div className="text-muted" style={{ padding: 12 }}>
          Payer details aren’t set up yet. An admin needs to run the Payer Directory database update
          (supabase/migrations/20261019_payer_directory.sql), then “Sync structure”.
        </div>
      )}

      {/* Sections */}
      {!loading && !tablesMissing && SECTIONS.map(section => {
        const all  = (data[section.key] ?? []).filter(r => !section.filter || section.filter(r, ctx));
        const rows = all.filter(r => showInactive || r.active !== false).sort(section.sort);
        return (
          <div key={section.key} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{section.icon} {section.title}</div>
              {canEdit && data[section.key] != null && (
                <button className="btn-sm" onClick={() => openAdd(section)}>+ Add {section.one}</button>
              )}
            </div>
            {data[section.key] == null && <div className="text-sm text-muted">Not set up yet.</div>}
            {data[section.key] != null && rows.length === 0 && (
              <div className="text-sm text-muted">Nothing recorded yet{canEdit ? ` — click “+ Add ${section.one}”.` : '.'}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {rows.map(r => {
                const view = section.show(r, ctx);
                return (
                  <div key={r.id} style={{
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12,
                    background: 'var(--surface-2)', opacity: r.active === false ? 0.55 : 1,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {view.title}{r.active === false && <span className="badge badge-red" style={{ marginLeft: 6 }}>Inactive</span>}
                      </div>
                      {view.tag && <span className="badge badge-purple" style={{ marginTop: 4, display: 'inline-block' }}>{view.tag}</span>}
                      {view.sub && <div className="text-sm text-muted">{view.sub}</div>}
                    </div>
                    {view.items.filter(Boolean).map((item, i) => <Value key={i} item={item} />)}
                    <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <VerifiedBadge row={r} names={names} />
                      {openReportsFor(section.table, r.id) > 0 && (
                        <span className="badge badge-yellow" style={{ alignSelf: 'flex-start' }}>
                          🚩 {openReportsFor(section.table, r.id)} open report{openReportsFor(section.table, r.id) > 1 ? 's' : ''}
                        </span>
                      )}
                      {reports != null && (
                        <div>
                          <ReportWrongInfo payer={payer} section={section.title} table={section.table} entityId={r.id}
                            entityTitle={view.title} user={user} onReported={loadReports} />
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn-sm" onClick={() => markVerified(section, r, view.title)}>✓ Mark verified</button>
                        <button className="btn-sm" onClick={() => openEdit(section, r)}>Edit</button>
                        <button className="btn-sm" style={{ color: r.active !== false ? 'var(--danger)' : 'var(--success)' }}
                          onClick={() => toggleActive(section, r)}>
                          {r.active !== false ? 'Make Inactive' : 'Reactivate'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {!loading && !tablesMissing && (
        <PayerForms payer={payer} user={user} canEdit={canEdit} showInactive={showInactive} plans={plans}
          names={names} reports={reports} onReported={loadReports} />
      )}

      {form && (
        <Modal title={`${form.id != null ? 'Edit' : 'Add'} ${form.section.one} — ${payer.name}`} onClose={() => setForm(null)} wide>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {form.section.fields
              .filter(f => !(f.key === 'delegated_group' && !form.values.is_delegated))
              .map(renderField)}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={!!form.verify} onChange={e => setForm(f => ({ ...f, verify: e.target.checked }))} />
              I confirmed this with the payer or a current document — mark it verified today
            </label>
            {form.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{form.error}</p>}
            <div className="form-actions">
              <button className="btn-sm" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : form.id != null ? 'Save Changes' : 'Add'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
