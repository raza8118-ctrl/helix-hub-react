import { useState, useEffect, useMemo } from 'react';
import {
  ESC_TYPES, ESC_SEVERITIES, ESC_STATUSES, escTypeLabel, severityOf, escStatusOf, escEventLabel, escRef, isOpenEsc,
  isOverdueEsc, escAgeDays, canManageEsc, canChangeEsc, escTextProblem, loadEscEvents, assignEscalation, setEscStatus,
  reopenEscalation, addEscNote,
} from '../../lib/escalations';
import { queryRef, categoryLabel } from '../../lib/clientQueries';
import CopyButton from '../../components/shared/CopyButton';
import Modal from '../../components/shared/Modal';
import EscalationEditor from './EscalationEditor';

const fmtDate = d => (d ? new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtTime = d => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const openQueries = () => window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_queries' }));

const TEXT_ACTIONS = {
  resolve: { title: '✓ Resolve', label: 'How it was resolved', required: true, button: 'Resolve' },
  reopen:  { title: 'Reopen', label: 'Why (optional)', button: 'Reopen' },
  note:    { title: '📝 Add a note', label: 'Note', required: true, button: 'Add note' },
};

function TextAction({ kind, e, user, onClose, onDone }) {
  const a = TEXT_ACTIONS[kind];
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (a.required && !text.trim()) return setError('Please type something.');
    const p = escTextProblem(text, 'This text');
    if (p) return setError(p);
    setSaving(true);
    const run = { resolve: () => setEscStatus(e, 'resolved', text, user), reopen: () => reopenEscalation(e, text, user), note: () => addEscNote(e, text, user) }[kind];
    const ok = await run();
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onDone();
  }
  return (
    <Modal title={`${a.title} — ${escRef(e.id)}`} onClose={onClose}>
      <div className="field"><label>{a.label}</label>
        <textarea rows={3} maxLength={1000} value={text} onChange={ev => setText(ev.target.value)} autoFocus />
      </div>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient details.</p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Back</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : a.button}</button>
      </div>
    </Modal>
  );
}

function History({ e, names, reloadKey }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let alive = true;
    loadEscEvents(e.id).then(list => { if (alive) setEvents(list); });
    return () => { alive = false; };
  }, [e.id, reloadKey]);
  if (!events) return <div className="text-sm text-muted">Loading history…</div>;
  return (
    <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
      {events.map(ev => (
        <div key={ev.id} className="text-sm" style={{ marginBottom: 4 }}>
          <b>{escEventLabel(ev.kind)}</b> · {names[ev.emp_id] ?? ev.emp_id ?? ''} · <span className="text-muted">{fmtTime(ev.created_at)}</span>
          {ev.note && <div style={{ whiteSpace: 'pre-wrap' }}>{ev.note}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * ⚑ Escalations (roadmap 7.4): Assigned to me / Raised by me / All (“Manage escalations”), filters, actions and history.
 * Escalated client queries (7.3) are listed read-only underneath.
 */
export default function EscalationList({ escalations, queries, ctx, people, names, user, onChanged }) {
  const manager = canManageEsc(user);
  const [view, setView] = useState('assigned');
  const [status, setStatus] = useState('OPEN');
  const [type, setType] = useState('ALL');
  const [severity, setSeverity] = useState('ALL');
  const [clientId, setClientId] = useState('ALL');
  const [open, setOpen] = useState(null);
  const [modal, setModal] = useState(null);             // { kind, e }
  const [busy, setBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const clientName = id => ctx.clients.find(c => c.id === id)?.name;
  const counts = {
    assigned: escalations.filter(e => e.assigned_to === user.emp_id && isOpenEsc(e)).length,
    raised: escalations.filter(e => e.raised_by === user.emp_id && isOpenEsc(e)).length,
  };
  const list = useMemo(() => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return escalations.filter(e => (view === 'assigned' ? e.assigned_to === user.emp_id : view === 'raised' ? e.raised_by === user.emp_id : manager)
      && (status === 'ALL' || (status === 'OPEN' ? isOpenEsc(e) : e.status === status))
      && (type === 'ALL' || e.type === type)
      && (severity === 'ALL' || e.severity === severity)
      && (clientId === 'ALL' || e.client_id === clientId))
      .sort((a, b) => (isOpenEsc(b) - isOpenEsc(a)) || (isOverdueEsc(b) - isOverdueEsc(a)) || (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2) || a.id - b.id);
  }, [escalations, view, user.emp_id, manager, status, type, severity, clientId]);

  const done = () => { setModal(null); setHistoryKey(k => k + 1); onChanged(); };
  async function quick(fn) { setBusy(true); const ok = await fn(); setBusy(false); if (ok) done(); }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {[['assigned', `📥 Assigned to me (${counts.assigned})`], ['raised', `📤 Raised by me (${counts.raised})`], ...(manager ? [['all', '📋 All']] : [])].map(([id, label]) => (
            <button key={id} className={view === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
          ))}
          <button className="btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'new' })}>⚑ Raise escalation</button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={status} onChange={ev => setStatus(ev.target.value)} aria-label="Status">
            <option value="OPEN">Open + in progress</option>
            {ESC_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            <option value="ALL">All statuses</option>
          </select>
          <select value={type} onChange={ev => setType(ev.target.value)} aria-label="Type">
            <option value="ALL">All types</option>
            {ESC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={severity} onChange={ev => setSeverity(ev.target.value)} aria-label="Severity">
            <option value="ALL">Any severity</option>
            {ESC_SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={clientId} onChange={ev => setClientId(ev.target.value === 'ALL' ? 'ALL' : Number(ev.target.value))} aria-label="Client">
            <option value="ALL">All clients</option>
            {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {list.length === 0 && <div className="card text-muted mb-16" style={{ textAlign: 'center' }}>No escalations here.</div>}

      {list.map(e => {
        const expanded = open === e.id;
        const sev = severityOf(e.severity);
        const st = escStatusOf(e.status);
        const mayChange = canChangeEsc(user, e);
        const payer = e.payer_id ? ctx.payers.find(p => p.id === e.payer_id) : null;
        return (
          <div key={e.id} className="card mb-16">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setOpen(expanded ? null : e.id)} role="button" aria-expanded={expanded}>
              <span>{expanded ? '▾' : '▸'}</span>
              <span className="bold">{escRef(e.id)}</span>
              <span style={{ flex: '1 1 200px' }}>{e.title}</span>
              <span className={`badge ${sev.badge}`}>{sev.label}</span>
              <span className={`badge ${st.badge}`}>{st.label}</span>
              {isOverdueEsc(e) && <span className="badge badge-red">Overdue</span>}
              <span className="text-sm text-muted">{escAgeDays(e)}d · {escTypeLabel(e.type)}{clientName(e.client_id) ? ` · ${clientName(e.client_id)}` : ''}</span>
            </div>
            {expanded && (
              <div style={{ marginTop: 8 }}>
                {e.details && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{e.details}</div>}
                <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
                  Raised by {names[e.raised_by] ?? e.raised_by} on {fmtDate(e.created_at)} · goes to {names[e.assigned_to] ?? e.assigned_to ?? '—'}
                  {' '}· target {fmtDate(e.target_date)}{payer ? ` · ${payer.name}` : ''}{e.handover_item_id ? ' · from a shift handover' : ''}
                </div>
                {e.claim_number && <div className="row text-sm" style={{ gap: 4, alignItems: 'center', marginBottom: 6 }}>Claim # {e.claim_number} <CopyButton value={e.claim_number} /></div>}
                {e.resolution && <div className="text-sm" style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>✅ <b>Resolution:</b> {e.resolution}</div>}
                {mayChange && (
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {e.status === 'open' && <button className="btn-sm" disabled={busy} onClick={() => quick(() => setEscStatus(e, 'in_progress', '', user))}>▶ In progress</button>}
                    {isOpenEsc(e) && <button className="btn-primary btn-sm" disabled={busy} onClick={() => setModal({ kind: 'resolve', e })}>✓ Resolve</button>}
                    {e.status === 'resolved' && <button className="btn-sm" disabled={busy} onClick={() => quick(() => setEscStatus(e, 'closed', '', user))}>Close</button>}
                    {!isOpenEsc(e) && <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'reopen', e })}>Reopen</button>}
                    <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'note', e })}>📝 Note</button>
                    <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'edit', e })}>✏️ Edit</button>
                    {isOpenEsc(e) && (
                      <select value={e.assigned_to ?? ''} disabled={busy} aria-label="Goes to" onChange={ev => quick(() => assignEscalation(e, ev.target.value, user))}>
                        {!people.some(p => p.emp_id === e.assigned_to) && <option value={e.assigned_to ?? ''}>{names[e.assigned_to] ?? '—'}</option>}
                        {people.map(p => <option key={p.emp_id} value={p.emp_id}>Goes to: {p.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
                <History e={e} names={names} reloadKey={historyKey} />
              </div>
            )}
          </div>
        );
      })}

      {queries.length > 0 && (manager || queries.some(q => q.owner_emp_id === user.emp_id)) && (
        <div className="card mb-16">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">💬 Escalated client queries <span className="text-sm text-muted">· from Client Queries</span></div>
            <button className="btn-sm" onClick={openQueries}>Open Client Queries ›</button>
          </div>
          {queries.filter(q => manager || q.owner_emp_id === user.emp_id).map(q => (
            <div key={q.id} className="row text-sm" style={{ gap: 8, flexWrap: 'wrap', padding: '4px 0', borderTop: '1px solid var(--border)' }}>
              <b>{queryRef(q.id)}</b>
              <span>{clientName(q.client_id) ?? '—'}</span>
              <span className="text-muted">{categoryLabel(q.category)}</span>
              <span style={{ flex: '1 1 240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.question}</span>
              <span className="text-muted">{names[q.owner_emp_id] ?? q.owner_emp_id}</span>
            </div>
          ))}
        </div>
      )}

      {modal?.kind === 'new' && (
        <EscalationEditor row={null} ctx={ctx} people={people} user={user} onClose={() => setModal(null)} onSaved={() => { setView('raised'); done(); }} />
      )}
      {modal?.kind === 'edit' && (
        <EscalationEditor row={modal.e} ctx={ctx} people={people} user={user} onClose={() => setModal(null)} onSaved={done} />
      )}
      {modal && TEXT_ACTIONS[modal.kind] && <TextAction kind={modal.kind} e={modal.e} user={user} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}
