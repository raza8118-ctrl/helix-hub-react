import { useState, useEffect, useCallback } from 'react';
import { S, db } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { hasAccess } from '../../lib/access';
import CopyButton from '../../components/shared/CopyButton';
import { Card, CardSection, Item, Button, Badge, Notice, Check, Field, FormActions, Toolbar, EmptyState, Modal } from '../../components/ui';
import { confirmDialog } from '../../components/shared/Dialog';
import { actionLabel } from '../../lib/auditLabels';
import PayerForms from './PayerForms';
import { VerifiedBadge, ReportWrongInfo, OpenReports } from './PayerAccuracy';
import { pendingForPayer, openSuggestions } from '../../lib/payerSuggestions';
import {
  LINES_OF_BUSINESS, BLUECARD, CLEARINGHOUSES, TRANSACTIONS, DEPARTMENTS, LIMIT_TYPES,
  MEASURED_FROM, NOTE_CATEGORIES, AUTH_SERVICES, AUTH_REQUIRED, AUTH_METHODS, labelOf, orderOf,
} from '../../lib/payerOptions';

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
    // 9.2: used by Ask Helix → 🔐 Auth checklist
    key: 'auth', table: 'payer_auth_rules', entity: 'payer_auth_rule', title: 'Authorization rules', icon: '🔐', one: 'Auth rule',
    fields: [
      { key: 'service', label: 'Service', type: 'select', options: AUTH_SERVICES, required: true },
      { key: 'plan_id', label: 'Applies to', type: 'plan' },
      { key: 'auth_required', label: 'Auth needed?', type: 'select', options: AUTH_REQUIRED, required: true },
      { key: 'visits_threshold', label: 'Auth needed after this many visits', type: 'number', hint: 'Only for “After N visits”' },
      { key: 'submit_method', label: 'How to submit', type: 'select', options: AUTH_METHODS },
      { key: 'turnaround_days', label: 'Decision usually takes (working days)', type: 'number' },
      { key: 'valid_days', label: 'Auth valid for (days)', type: 'number' },
      { key: 'documents', label: 'Documents to send', type: 'textarea', hint: 'e.g. Referral, face-to-face, signed plan of care, OASIS' },
      { key: 'retro_allowed', label: 'Retro auth allowed', type: 'checkbox' },
      { key: 'retro_days', label: 'Retro allowed within (days)', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    sort: (a, b) => orderOf(AUTH_SERVICES, a.service) - orderOf(AUTH_SERVICES, b.service),
    show: (r, ctx) => ({
      title: labelOf(AUTH_SERVICES, r.service),
      sub: ctx.planName(r.plan_id),
      items: [
        { label: 'Auth needed', value: r.auth_required === 'after_visits' ? `After ${r.visits_threshold ?? '?'} visits` : labelOf(AUTH_REQUIRED, r.auth_required), big: true },
        r.submit_method && { label: 'Submit by', value: labelOf(AUTH_METHODS, r.submit_method) },
        r.turnaround_days != null && { label: 'Decision usually in', value: `${r.turnaround_days} working days` },
        r.valid_days != null && { label: 'Valid for', value: `${r.valid_days} days` },
        { label: 'Retro', value: r.retro_allowed ? `Allowed${r.retro_days != null ? ` within ${r.retro_days} days` : ''}` : 'Not allowed' },
        r.documents && { label: 'Documents', value: r.documents },
        r.notes && { label: 'Notes', value: r.notes },
      ],
    }),
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
      {item.label && <div className="ui-kv-l">{item.label}</div>}
      <div className="ui-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 6 }}>
        <div className={`ui-kv-v${item.big ? ' big' : ''}`}>
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
  const [suggested, setSuggested] = useState(0);                  // 8.3: pending directory suggestions from bulletins

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
    let alive = true;
    if (canEdit) pendingForPayer(payer.id).then(n => { if (alive) setSuggested(n); });
    return () => { alive = false; };
  }, [canEdit, payer.id]);
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
        <Check key={f.key} checked={!!v} onChange={e => setV({ [f.key]: e.target.checked })}>{f.label}</Check>
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
      <Field key={f.key} label={f.label} required={f.required}>
        {input}
      </Field>
    );
  }

  return (
    <Card variant="accent">
      {/* Header */}
      <div className="ui-card-h">
        <div className="ui-row" style={{ gap: 8 }}>
          <span className="ui-card-t" style={{ fontSize: 'var(--ui-fs-lg)' }}>{payer.name}</span>
          <CopyButton value={payer.name} />
          {payer.payer_type && <Badge tone="info">{payer.payer_type}</Badge>}
        </div>
        <div className="ui-card-a">
          {canEdit && (
            <Check inline checked={showInactive} onChange={e => setShowInactive(e.target.checked)}>Show inactive</Check>
          )}
          {canEdit && <Button size="sm" onClick={toggleHistory}>{history ? 'Hide history' : '🕘 History'}</Button>}
          {reports != null && (
            <ReportWrongInfo payer={payer} section="Payer (general)" table="payers" entityId={payer.id}
              user={user} onReported={loadReports} />
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>✕ Close</Button>
        </div>
      </div>

      <div className="ui-stack" style={{ gap: 'var(--ui-s3)' }}>
        {canEdit && <OpenReports payer={payer} reports={reports} user={user} onChanged={loadReports} />}
        {canEdit && suggested > 0 && (
          <Notice tone="info" icon="💡">
            <div className="ui-row" style={{ justifyContent: 'space-between' }}>
              <span>{suggested} suggested {suggested === 1 ? 'change' : 'changes'} from payer bulletins</span>
              <Button size="xs" onClick={async () => {
                if (!await confirmDialog({ title: 'Review the suggestions?', message: 'This opens Payer Updates → 🛠 Directory suggestions and leaves this page.', confirmText: 'Open' })) return;
                onClose(); openSuggestions();
              }}>Review ›</Button>
            </div>
          </Notice>
        )}

        {history && (
          <Card variant="soft" title="Change history" icon="🕘">
            <div className="ui-scroll">
              {history.loading && <EmptyState compact title="Loading…" />}
              {!history.loading && history.error && <EmptyState compact title="History isn’t available yet (audit log update not run)." />}
              {!history.loading && !history.error && history.rows.length === 0 && <EmptyState compact title="No changes recorded yet." />}
              {history.rows.map(h => (
                <div key={h.id} className="ui-log-row">
                  <span className="ui-text-muted">{new Date(h.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  {' · '}<strong>{h.actor_name ?? h.actor_emp_id}</strong>{' · '}{actionLabel(h.action)}
                  {h.details?.section ? ` — ${h.details.section}` : ''}{h.details?.title ? `: ${h.details.title}` : ''}
                </div>
              ))}
            </div>
          </Card>
        )}

        {(payer.aliases ?? []).length > 0 && (
          <div>
            <div className="ui-kv-l">Also known as</div>
            <div className="ui-row" style={{ gap: 6 }}>
              {payer.aliases.map(a => (
                <span key={a} className="ui-row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                  <Badge>{a}</Badge>
                  <CopyButton value={a} />
                </span>
              ))}
            </div>
          </div>
        )}
        {payer.notes && <div className="ui-kv-v">{payer.notes}</div>}

        {clients.length > 0 && !tablesMissing && (
          <Toolbar>
            <span className="ui-muted">Showing limits for:</span>
            <select value={activeClientId} onChange={e => pickClient(e.target.value)} aria-label="Showing limits for">
              <option value="">Standard (all clients)</option>
              {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </Toolbar>
        )}

        {loading && <EmptyState compact title="Loading payer details…" />}
        {tablesMissing && (
          <EmptyState icon="🛠️" title="Payer details aren’t set up yet.">
            An admin needs to run the Payer Directory database update
            (supabase/migrations/20261019_payer_directory.sql), then “Sync structure”.
          </EmptyState>
        )}
      </div>

      {/* Sections */}
      {!loading && !tablesMissing && SECTIONS.map(section => {
        const all  = (data[section.key] ?? []).filter(r => !section.filter || section.filter(r, ctx));
        const rows = all.filter(r => showInactive || r.active !== false).sort(section.sort);
        return (
          <CardSection key={section.key} icon={section.icon} title={section.title}
            actions={canEdit && data[section.key] != null && (
              <Button size="sm" onClick={() => openAdd(section)}>+ Add {section.one}</Button>
            )}>
            {data[section.key] == null && <EmptyState compact title="Not set up yet." />}
            {data[section.key] != null && rows.length === 0 && (
              <EmptyState compact title={`Nothing recorded yet${canEdit ? ` — click “+ Add ${section.one}”.` : '.'}`} />
            )}
            <div className="ui-grid">
              {rows.map(r => {
                const view = section.show(r, ctx);
                return (
                  <Item key={r.id} dim={r.active === false}>
                    <div>
                      <div className="ui-item-t">
                        {view.title}{r.active === false && <Badge tone="bad" style={{ marginLeft: 6 }}>Inactive</Badge>}
                      </div>
                      {view.tag && <div style={{ marginTop: 4 }}><Badge tone="accent">{view.tag}</Badge></div>}
                      {view.sub && <div className="ui-muted">{view.sub}</div>}
                    </div>
                    {view.items.filter(Boolean).map((item, i) => <Value key={i} item={item} />)}
                    <div className="ui-item-foot">
                      <VerifiedBadge row={r} names={names} />
                      {openReportsFor(section.table, r.id) > 0 && (
                        <span><Badge tone="warn">
                          🚩 {openReportsFor(section.table, r.id)} open report{openReportsFor(section.table, r.id) > 1 ? 's' : ''}
                        </Badge></span>
                      )}
                      {reports != null && (
                        <div>
                          <ReportWrongInfo payer={payer} section={section.title} table={section.table} entityId={r.id}
                            entityTitle={view.title} user={user} onReported={loadReports} />
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <div className="ui-row" style={{ gap: 4 }}>
                        <Button size="xs" onClick={() => markVerified(section, r, view.title)}>✓ Mark verified</Button>
                        <Button size="xs" onClick={() => openEdit(section, r)}>Edit</Button>
                        <Button size="xs" variant={r.active !== false ? 'danger' : 'success'} onClick={() => toggleActive(section, r)}>
                          {r.active !== false ? 'Make Inactive' : 'Reactivate'}
                        </Button>
                      </div>
                    )}
                  </Item>
                );
              })}
            </div>
          </CardSection>
        );
      })}

      {!loading && !tablesMissing && (
        <PayerForms payer={payer} user={user} canEdit={canEdit} showInactive={showInactive} plans={plans}
          names={names} reports={reports} onReported={loadReports} />
      )}

      {form && (
        <Modal title={`${form.id != null ? 'Edit' : 'Add'} ${form.section.one} — ${payer.name}`} onClose={() => setForm(null)} wide>
          <div>
            {form.section.fields
              .filter(f => !(f.key === 'delegated_group' && !form.values.is_delegated))
              .map(renderField)}
            <Check checked={!!form.verify} onChange={e => setForm(f => ({ ...f, verify: e.target.checked }))}>
              I confirmed this with the payer or a current document — mark it verified today
            </Check>
            {form.error && <Notice tone="bad">{form.error}</Notice>}
            <FormActions>
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : form.id != null ? 'Save Changes' : 'Add'}
              </Button>
            </FormActions>
          </div>
        </Modal>
      )}
    </Card>
  );
}
