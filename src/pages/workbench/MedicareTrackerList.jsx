import { useState, useEffect, useMemo } from 'react';
import {
  TRACKERS, statusOf, itemRef, isDone, optionLabel, canChangeItem, canManageMedicare, noteProblem, loadItemEvents,
  setItemStatus, assignItem, addItemNote,
} from '../../lib/medicareTrackers';
import CopyButton from '../../components/shared/CopyButton';
import Modal from '../../components/shared/Modal';
import MedicareItemEditor from './MedicareItemEditor';

const fmtDate = d => (d ? new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtTime = d => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const money = n => (n == null ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const EVENT_LABELS = { added: 'Added', edited: 'Edited', status: 'Status', assigned: 'Reassigned', note: 'Note', cleared_fiss: 'Cleared from FISS (not on the latest upload)' };

function History({ kind, item, names, reloadKey }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let alive = true;
    loadItemEvents(kind, item.id).then(e => { if (alive) setEvents(e); });
    return () => { alive = false; };
  }, [kind, item.id, reloadKey]);
  if (!events) return <div className="text-sm text-muted">Loading history…</div>;
  return (
    <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
      {events.map(e => (
        <div key={e.id} className="text-sm" style={{ marginBottom: 4 }}>
          <b>{EVENT_LABELS[e.kind] ?? e.kind}</b> · {names[e.emp_id] ?? e.emp_id ?? ''} · <span className="text-muted">{fmtTime(e.created_at)}</span>
          {e.note && <div style={{ whiteSpace: 'pre-wrap' }}>{e.note}</div>}
        </div>
      ))}
    </div>
  );
}

/** 📝 Note pop-up (checked for patient details). */
function NoteModal({ kind, item, user, onClose, onDone }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  async function save() {
    if (!text.trim()) return setError('Please type something.');
    const p = noteProblem(text);
    if (p) return setError(p);
    if (await addItemNote(kind, item, text, user)) onDone(); else setError('Could not save. Please try again.');
  }
  return (
    <Modal title={`📝 Note — ${itemRef(kind, item.id)}`} onClose={onClose}>
      <div className="field"><label>Note</label><textarea rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} autoFocus /></div>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient details.</p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Back</button>
        <button className="btn-primary" onClick={save}>Add note</button>
      </div>
    </Modal>
  );
}

/**
 * Shared list for the Medicare trackers (roadmap 7.5): filters, rows with status badge + tracker badges, details,
 * status change, note, edit, owner (managers), history. badges(item) / actions(item) add tracker-specific parts;
 * sortKey(item) orders open items (smaller first).
 */
export default function MedicareTrackerList({ kind, items, ctx, people, names, user, onChanged, badges, actions, sortKey, toolbar }) {
  const t = TRACKERS[kind];
  const manager = canManageMedicare(user);
  const [query, setQuery] = useState('');
  const [clientId, setClientId] = useState('ALL');
  const [status, setStatus] = useState('OPEN');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(null);
  const [modal, setModal] = useState(null);             // { kind: 'edit' | 'note' | 'new', item }
  const [busy, setBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const clientName = id => ctx.clients.find(c => c.id === id)?.name;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i => (clientId === 'ALL' || i.client_id === clientId)
      && (status === 'ALL' || (status === 'OPEN' ? !isDone(kind, i) : status === 'DONE' ? isDone(kind, i) : i[t.statusKey] === status))
      && (!mine || i.owner_emp_id === user.emp_id)
      && (!q || [itemRef(kind, i.id), i.claim_number, i.location, i.reason_code].some(x => (x ?? '').toLowerCase().includes(q))))
      .sort((a, b) => (isDone(kind, a) - isDone(kind, b)) || ((sortKey?.(a) ?? 0) - (sortKey?.(b) ?? 0)) || b.id - a.id);
  }, [items, clientId, status, mine, user.emp_id, query, kind, t.statusKey, sortKey]);

  const done = () => { setModal(null); setHistoryKey(k => k + 1); onChanged(); };
  async function quick(fn) { setBusy(true); const ok = await fn(); setBusy(false); if (ok) done(); }
  const detailFields = t.fields.filter(f => !['client_id', 'claim_number'].includes(f.key));
  const show = (f, i) => {
    const x = i[f.key];
    if (x == null || x === '') return null;
    if (f.type === 'money') return money(x);
    if (f.type === 'date') return fmtDate(x);
    if (f.type === 'select') return optionLabel(kind, f.key, x);
    if (f.type === 'payer') return ctx.payers.find(p => p.id === x)?.name ?? '—';
    return x;
  };

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="search" style={{ flex: '2 1 180px' }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Ref, claim # / DCN…" aria-label="Search" />
          <select value={clientId} onChange={e => setClientId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))} aria-label="Client">
            <option value="ALL">All clients</option>
            {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
            <option value="OPEN">Open</option>
            <option value="DONE">Finished</option>
            {t.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            <option value="ALL">All</option>
          </select>
          <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Only mine
          </label>
          <span style={{ marginLeft: 'auto' }} className="row">
            {toolbar}
            <button className="btn-primary btn-sm" onClick={() => setModal({ kind: 'new' })}>+ Add</button>
          </span>
        </div>
      </div>

      {list.length === 0 && <div className="card text-muted mb-16" style={{ textAlign: 'center' }}>Nothing here.</div>}

      {list.map(i => {
        const st = isDone(kind, i) && kind === 'rtp' && i.in_fiss === false ? { label: 'Cleared from FISS', badge: 'badge-green' } : statusOf(kind, i[t.statusKey]);
        const expanded = open === i.id;
        const mayChange = canChangeItem(user, i);
        return (
          <div key={i.id} className="card mb-16">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setOpen(expanded ? null : i.id)} role="button" aria-expanded={expanded}>
              <span>{expanded ? '▾' : '▸'}</span>
              <span className="bold">{itemRef(kind, i.id)}</span>
              <span>{clientName(i.client_id) ?? '—'}</span>
              {i.claim_number && <span className="text-sm text-muted">#{i.claim_number}</span>}
              {i.amount != null && <span className="text-sm">{money(i.amount)}</span>}
              <span className={`badge ${st.badge}`}>{st.label}</span>
              {badges?.(i)}
              <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>{names[i.owner_emp_id] ?? i.owner_emp_id ?? ''}</span>
            </div>
            {expanded && (
              <div style={{ marginTop: 8 }}>
                <div className="row text-sm" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                  {detailFields.map(f => show(f, i) != null && <span key={f.key}><span className="text-muted">{f.label}:</span> {show(f, i)}</span>)}
                  {i.claim_number && <span className="row" style={{ gap: 4, alignItems: 'center' }}><span className="text-muted">Claim:</span> {i.claim_number} <CopyButton value={i.claim_number} /></span>}
                </div>
                {mayChange && (
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    <select value={i[t.statusKey]} disabled={busy} aria-label="Status"
                      onChange={e => quick(() => setItemStatus(kind, i, e.target.value, '', user))}>
                      {t.statuses.map(s => <option key={s.value} value={s.value}>Status: {s.label}</option>)}
                    </select>
                    {actions?.(i)}
                    <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'note', item: i })}>📝 Note</button>
                    <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'edit', item: i })}>✏️ Edit</button>
                    {manager && (
                      <select value={i.owner_emp_id ?? ''} disabled={busy} aria-label="Owner" onChange={e => quick(() => assignItem(kind, i, e.target.value, user))}>
                        {!people.some(p => p.emp_id === i.owner_emp_id) && <option value={i.owner_emp_id ?? ''}>{names[i.owner_emp_id] ?? 'No owner'}</option>}
                        {people.map(p => <option key={p.emp_id} value={p.emp_id}>Owner: {p.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
                <History kind={kind} item={i} names={names} reloadKey={historyKey} />
              </div>
            )}
          </div>
        );
      })}

      {(modal?.kind === 'new' || modal?.kind === 'edit') && (
        <MedicareItemEditor kind={kind} row={modal.item ?? null} ctx={ctx} user={user} onClose={() => setModal(null)} onSaved={done} />
      )}
      {modal?.kind === 'note' && <NoteModal kind={kind} item={modal.item} user={user} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}
