import { useState, useEffect, useMemo } from 'react';
import {
  QUERY_CATEGORIES, QUERY_STATUSES, AGE_BUCKETS, categoryLabel, statusOf, viaLabel, eventLabel, queryRef,
  isOpen, ageDays, ageBucket, isOverdue, chaseDue, canChange, canManageQueries, textProblem, loadEvents, chaseMessage,
  chaseQuery, answerQuery, closeQuery, cancelQuery, reopenQuery, escalateQuery, assignQuery, addNote,
} from '../../lib/clientQueries';
import CopyButton from '../../components/shared/CopyButton';
import Modal from '../../components/shared/Modal';
import QueryEditor from './QueryEditor';

const fmtDate = d => (d ? new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtTime = d => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Pop-ups that need a typed text: what is saved and whether the text is required
const TEXT_ACTIONS = {
  answer:   { title: '✓ Mark as answered', label: 'Answer summary', required: true, button: 'Save answer' },
  cancel:   { title: 'Cancel this query', label: 'Why (optional)', button: 'Cancel query' },
  reopen:   { title: 'Reopen this query', label: 'Why (optional)', button: 'Reopen' },
  escalate: { title: '⚑ Escalate', label: 'What is needed (optional)', button: 'Escalate' },
  note:     { title: '📝 Add a note', label: 'Note', required: true, button: 'Add note' },
};

/** Pop-up for answer / cancel / reopen / escalate / note. */
function TextAction({ kind, q, user, onClose, onDone }) {
  const a = TEXT_ACTIONS[kind];
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (a.required && !text.trim()) return setError('Please type something.');
    const p = textProblem(text, 'This text');
    if (p) return setError(p);
    setSaving(true);
    const run = { answer: () => answerQuery(q, text, user), cancel: () => cancelQuery(q, text, user), reopen: () => reopenQuery(q, text, user),
      escalate: () => escalateQuery(q, true, text, user), note: () => addNote(q, text, user) }[kind];
    const ok = await run();
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onDone();
  }
  return (
    <Modal title={`${a.title} — ${queryRef(q.id)}`} onClose={onClose}>
      <div className="field"><label>{a.label}</label>
        <textarea rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} autoFocus />
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

/** 📨 Chase: copy-ready message, then “Mark as chased”. */
function ChaseModal({ q, clientName, user, onClose, onDone }) {
  const [saving, setSaving] = useState(false);
  const message = chaseMessage(q, clientName, user);
  async function mark() {
    setSaving(true);
    const ok = await chaseQuery(q, user);
    setSaving(false);
    if (ok) onDone();
  }
  return (
    <Modal title={`📨 Chase ${queryRef(q.id)}`} onClose={onClose} wide>
      <textarea readOnly rows={12} value={message} style={{ width: '100%', fontFamily: 'inherit' }} />
      <div className="form-actions">
        <CopyButton value={message} label="📋 Copy message" />
        <button className="btn-sm" onClick={onClose}>Close</button>
        <button className="btn-primary" onClick={mark} disabled={saving}>{saving ? 'Saving…' : 'Mark as chased'}</button>
      </div>
    </Modal>
  );
}

/** History timeline, loaded when a query is opened. */
function History({ q, names, reloadKey }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let alive = true;
    loadEvents(q.id).then(e => { if (alive) setEvents(e); });
    return () => { alive = false; };
  }, [q.id, reloadKey]);
  if (!events) return <div className="text-sm text-muted">Loading history…</div>;
  return (
    <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
      {events.map(e => (
        <div key={e.id} className="text-sm" style={{ marginBottom: 4 }}>
          <b>{eventLabel(e.kind)}</b> · {names[e.emp_id] ?? e.emp_id ?? ''} · <span className="text-muted">{fmtTime(e.created_at)}</span>
          {e.note && <div style={{ whiteSpace: 'pre-wrap' }}>{e.note}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * Query list (roadmap 7.3). mode 'mine' = my queries, chase-due / overdue first (closed ones on request);
 * 'all' = every query with search and filters. Actions only for the owner / creator or “Manage client queries”.
 */
export default function QueryList({ mode, initialQuery = '', queries, ctx, people, names, user, onChanged }) {
  const manager = canManageQueries(user);
  const [query, setQuery] = useState(initialQuery);   // 10.1: global search hands over Q-####
  const [clientId, setClientId] = useState('ALL');
  const [status, setStatus] = useState(initialQuery ? 'ALL' : 'OPEN');   // OPEN = open + waiting; a searched reference may be closed
  const [category, setCategory] = useState('ALL');
  const [owner, setOwner] = useState('ALL');
  const [age, setAge] = useState('ALL');
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState(null);
  const [modal, setModal] = useState(null);              // { kind, q }
  const [busy, setBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const clientName = id => ctx.clients.find(c => c.id === id)?.name ?? '—';
  const list = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = queries.filter(q => {
      if (mode === 'mine') return q.owner_emp_id === user.emp_id && (showDone || isOpen(q));
      return (status === 'ALL' || (status === 'OPEN' ? isOpen(q) : q.status === status))
        && (clientId === 'ALL' || q.client_id === clientId)
        && (category === 'ALL' || q.category === category)
        && (owner === 'ALL' || q.owner_emp_id === owner)
        && (age === 'ALL' || (isOpen(q) && ageBucket(ageDays(q)) === age))
        && words.every(w => [queryRef(q.id), q.question, q.claim_number, q.contact_name, q.answer].some(t => (t ?? '').toLowerCase().includes(w)));
    });
    // Needs attention first: chase due / overdue / urgent, then oldest
    const weight = q => (isOpen(q) ? 0 : 10) - (chaseDue(q) ? 3 : 0) - (isOverdue(q) ? 2 : 0) - (q.priority === 'urgent' ? 1 : 0);
    return rows.sort((a, b) => weight(a) - weight(b) || a.asked_on.localeCompare(b.asked_on));
  }, [queries, mode, user.emp_id, showDone, status, clientId, category, owner, age, query]);

  const done = () => { setModal(null); setHistoryKey(k => k + 1); onChanged(); };
  async function quick(fn) { setBusy(true); const ok = await fn(); setBusy(false); if (ok) done(); }

  return (
    <>
      {mode === 'all' ? (
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '2 1 200px', marginBottom: 0 }}><label>Search</label>
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Q-0042, claim #, words…" />
            </div>
            <div className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}><label>Client</label>
              <select value={clientId} onChange={e => setClientId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
                <option value="ALL">All</option>
                {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 140px', marginBottom: 0 }}><label>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="OPEN">Not answered yet</option>
                {QUERY_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                <option value="ALL">All</option>
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}><label>About</label>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="ALL">All</option>
                {QUERY_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}><label>Owner</label>
              <select value={owner} onChange={e => setOwner(e.target.value)}>
                <option value="ALL">Everyone</option>
                {people.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 110px', marginBottom: 0 }}><label>Age (open)</label>
              <select value={age} onChange={e => setAge(e.target.value)}>
                <option value="ALL">Any</option>
                {AGE_BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show answered / closed
        </label>
      )}

      {list.length === 0 && (
        <div className="card text-muted" style={{ textAlign: 'center' }}>
          {mode === 'mine' ? 'No open queries — nice work.' : 'No queries match.'}
        </div>
      )}

      {list.map(q => {
        const st = statusOf(q.status);
        const expanded = open === q.id;
        const mayChange = canChange(user, q);
        const days = ageDays(q);
        const payer = q.payer_id ? ctx.payers.find(p => p.id === q.payer_id) : null;
        return (
          <div key={q.id} className="card mb-16">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setOpen(expanded ? null : q.id)} role="button" aria-expanded={expanded}>
              <span>{expanded ? '▾' : '▸'}</span>
              <span className="bold">{queryRef(q.id)}</span>
              <span>{clientName(q.client_id)}</span>
              <span className="text-sm text-muted">{categoryLabel(q.category)}</span>
              <span className={`badge ${st.badge}`}>{st.label}</span>
              <span className="text-sm">{days} {days === 1 ? 'day' : 'days'}</span>
              {q.priority === 'urgent' && <span className="badge badge-red">Urgent</span>}
              {isOverdue(q) && <span className="badge badge-red">Overdue</span>}
              {chaseDue(q) && <span className="badge badge-yellow">Chase due</span>}
              {q.escalated && isOpen(q) && <span className="badge badge-purple">⚑ Escalated</span>}
              {mode === 'all' && <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>{names[q.owner_emp_id] ?? q.owner_emp_id}</span>}
            </div>
            {!expanded && <div className="text-sm text-muted" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.question}</div>}
            {expanded && (
              <div style={{ marginTop: 8 }}>
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{q.question}</div>
                <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
                  Asked {fmtDate(q.asked_on)} by {viaLabel(q.asked_via).toLowerCase()}
                  {q.contact_name && <> to {q.contact_name}</>} · expected {fmtDate(q.expected_on)}
                  {q.chase_count > 0 && <> · chased {q.chase_count}× (last {fmtDate(q.last_chased_at)})</>}
                  {payer && <> · {payer.name}</>}
                  {q.team && <> · {q.team}</>} · owner {names[q.owner_emp_id] ?? q.owner_emp_id}
                </div>
                {q.claim_number && (
                  <div className="row text-sm" style={{ gap: 4, alignItems: 'center', marginBottom: 6 }}>Claim # {q.claim_number} <CopyButton value={q.claim_number} /></div>
                )}
                {q.answer && <div className="text-sm" style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>✅ <b>Answer:</b> {q.answer}</div>}
                <div className="row" style={{ gap: 4, alignItems: 'center', marginBottom: 8 }}>
                  <span className="text-sm text-muted">Reference</span><CopyButton value={queryRef(q.id)} label={queryRef(q.id)} />
                </div>

                {mayChange && (
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {isOpen(q) && <button className="btn-primary btn-sm" disabled={busy} onClick={() => setModal({ kind: 'chase', q })}>📨 Chase</button>}
                    {isOpen(q) && <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'answer', q })}>✓ Answered</button>}
                    {q.status !== 'closed' && q.status !== 'cancelled' && <button className="btn-sm" disabled={busy} onClick={() => quick(() => closeQuery(q, user))}>Close</button>}
                    {isOpen(q) && <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'cancel', q })}>Cancel query</button>}
                    {!isOpen(q) && <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'reopen', q })}>Reopen</button>}
                    {isOpen(q) && (q.escalated
                      ? <button className="btn-sm" disabled={busy} onClick={() => quick(() => escalateQuery(q, false, '', user))}>Remove escalation</button>
                      : <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'escalate', q })}>⚑ Escalate</button>)}
                    <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'note', q })}>📝 Note</button>
                    <button className="btn-sm" disabled={busy} onClick={() => setModal({ kind: 'edit', q })}>✏️ Edit</button>
                    {manager && (
                      <select value={q.owner_emp_id} disabled={busy} aria-label="Reassign"
                        onChange={e => quick(() => assignQuery(q, e.target.value, user))}>
                        {!people.some(p => p.emp_id === q.owner_emp_id) && <option value={q.owner_emp_id}>{names[q.owner_emp_id] ?? q.owner_emp_id}</option>}
                        {people.map(p => <option key={p.emp_id} value={p.emp_id}>Owner: {p.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
                <History q={q} names={names} reloadKey={historyKey} />
              </div>
            )}
          </div>
        );
      })}

      {modal?.kind === 'chase' && <ChaseModal q={modal.q} clientName={clientName(modal.q.client_id)} user={user} onClose={() => setModal(null)} onDone={done} />}
      {modal && TEXT_ACTIONS[modal.kind] && <TextAction kind={modal.kind} q={modal.q} user={user} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'edit' && <QueryEditor row={modal.q} ctx={ctx} people={people} user={user} onClose={() => setModal(null)} onSaved={done} />}
    </>
  );
}
