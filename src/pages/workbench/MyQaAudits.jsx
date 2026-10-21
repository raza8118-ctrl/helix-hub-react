import { useState } from 'react';
import { qaStatusOf, failed, scoreOf, DEFAULT_PASS_MARK, acknowledgeAudit, disputeAudit, resolveDispute, commentProblem } from '../../lib/qa';
import { openSopLibrary } from '../../lib/sops';
import Modal from '../../components/shared/Modal';

const fmtDate = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

/** Score + every checkpoint of one audit; failed ones show the error category and a 📚 Read the SOP button. */
export function AuditDetails({ audit, setup, ctx, names }) {
  const catName = id => setup.categories.find(c => c.id === id)?.name ?? 'No category';
  const sop = id => ctx.sops.find(s => s.id === id);
  const card = setup.scorecards.find(c => c.id === audit.scorecard_id);
  const client = ctx.clients.find(c => c.id === audit.client_id);
  const payer = ctx.payers.find(p => p.id === audit.payer_id);
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <span className="bold" style={{ fontSize: 18 }}>{audit.score == null ? '—' : `${audit.score}%`}</span>
        {audit.fatal ? <span className="badge badge-red">Critical error</span>
          : audit.passed != null && <span className={`badge ${audit.passed ? 'badge-green' : 'badge-red'}`}>{audit.passed ? 'Pass' : 'Below pass mark'}</span>}
        <span className={`badge ${qaStatusOf(audit.status).badge}`}>{qaStatusOf(audit.status).label}</span>
        {audit.resolution && <span className="badge badge-gray">{audit.resolution === 'overturned' ? 'Partly / fully overturned' : 'Upheld'}</span>}
      </div>
      <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
        {card?.name ?? 'Scorecard'} · work date {fmtDate(audit.work_date)}
        {client && <> · {client.name}</>}{payer && <> · {payer.name}</>}
        {audit.claim_number && <> · claim {audit.claim_number}</>}
        {audit.auditor_emp_id && <> · audited by {names[audit.auditor_emp_id] ?? audit.auditor_emp_id}</>}
      </div>
      {(audit.results ?? []).map((r, i) => {
        const s = r.sop_id ? sop(r.sop_id) : null;
        return (
          <div key={r.checkpoint_id ?? i} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ width: 22 }}>{r.result === 'na' ? '–' : failed(r) ? '❌' : '✅'}</span>
            <span style={{ flex: '1 1 240px' }}>
              {r.text}
              {r.critical && <span className="badge badge-red" style={{ marginLeft: 6 }}>Critical</span>}
              {r.overturned && <span className="badge badge-green" style={{ marginLeft: 6 }}>Overturned</span>}
              {failed(r) && <div className="text-sm"><b>{catName(r.category_id)}</b>{r.comment ? ` — ${r.comment}` : ''}</div>}
            </span>
            {failed(r) && s && <button type="button" className="btn-sm" onClick={() => openSopLibrary(s.title)}>📚 Read the SOP</button>}
          </div>
        );
      })}
      {audit.comment && <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>💬 {audit.comment}</p>}
      {audit.dispute_reason && <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>⚖️ Dispute: {audit.dispute_reason}</p>}
      {audit.resolution_note && <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>📝 Resolution: {audit.resolution_note}</p>}
    </div>
  );
}

/** Auditor / manager settles a dispute: tick the failed checkpoints that are overturned (none ticked = upheld). */
export function ResolveModal({ audit, setup, ctx, names, user, onClose, onSaved }) {
  const [overturned, setOverturned] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const card = setup.scorecards.find(c => c.id === audit.scorecard_id);
  const fails = (audit.results ?? []).filter(r => r.result === 'fail');
  const preview = scoreOf(audit.results.map(r => ({ ...r, overturned: r.result === 'fail' && overturned.has(r.checkpoint_id) })), Number(card?.pass_mark ?? DEFAULT_PASS_MARK));
  const toggle = id => setOverturned(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save() {
    const p = commentProblem(note);
    if (p) return setError(p);
    setSaving(true);
    const ok = await resolveDispute(audit, { overturnedIds: [...overturned], note }, card, user);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title={`Resolve dispute — ${names[audit.agent_emp_id] ?? audit.agent_emp_id}`} onClose={onClose} wide>
      <AuditDetails audit={audit} setup={setup} ctx={ctx} names={names} />
      <div className="field" style={{ marginTop: 8 }}><label>Overturn these errors (the agent was right)</label>
        {fails.map(r => (
          <label key={r.checkpoint_id} className="row text-sm" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={overturned.has(r.checkpoint_id)} onChange={() => toggle(r.checkpoint_id)} />
            {r.text}
          </label>
        ))}
      </div>
      <p className="text-sm">New score: <b>{preview.score == null ? '—' : `${preview.score}%`}</b> · {overturned.size ? 'Overturned' : 'Upheld'}</p>
      <div className="field"><label>Note to the agent (optional)</label>
        <textarea rows={2} maxLength={600} value={note} onChange={e => setNote(e.target.value)} />
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Resolve'}</button>
      </div>
    </Modal>
  );
}

/** 🙋 My audits: audits sent to me — acknowledge, or dispute with a reason. */
export default function MyQaAudits({ audits, setup, ctx, names, user, onChanged }) {
  const [open, setOpen] = useState(null);
  const [disputing, setDisputing] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function ack(a) {
    setBusy(true);
    if (await acknowledgeAudit(a, user)) onChanged();
    setBusy(false);
  }
  async function sendDispute() {
    if (!reason.trim()) return setError('Say why you disagree.');
    const p = commentProblem(reason);
    if (p) return setError(p);
    setBusy(true);
    const ok = await disputeAudit(disputing, reason, user);
    setBusy(false);
    if (!ok) return setError('Could not save. Please try again.');
    setDisputing(null); setReason(''); onChanged();
  }

  const scored = audits.filter(a => a.score != null);
  const avg = scored.length ? Math.round((scored.reduce((t, a) => t + Number(a.score), 0) / scored.length) * 10) / 10 : null;

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <div><div className="text-sm text-muted">Audits</div><div className="bold" style={{ fontSize: 20 }}>{audits.length}</div></div>
          <div><div className="text-sm text-muted">Average score</div><div className="bold" style={{ fontSize: 20 }}>{avg == null ? '—' : `${avg}%`}</div></div>
          <div><div className="text-sm text-muted">Waiting for you</div><div className="bold" style={{ fontSize: 20 }}>{audits.filter(a => a.status === 'sent').length}</div></div>
        </div>
      </div>
      {audits.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>No QA audits of your work yet.</div>}
      {audits.map(a => (
        <div key={a.id} className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setOpen(open === a.id ? null : a.id)} role="button" aria-expanded={open === a.id}>
            <span>{open === a.id || a.status === 'sent' ? '▾' : '▸'}</span>
            <span className="bold">{a.score == null ? '—' : `${a.score}%`}</span>
            <span className="text-sm text-muted">{setup.scorecards.find(c => c.id === a.scorecard_id)?.name} · {fmtDate(a.work_date)}</span>
            <span className={`badge ${qaStatusOf(a.status).badge}`}>{a.status === 'sent' ? 'Please review' : qaStatusOf(a.status).label}</span>
          </div>
          {(open === a.id || a.status === 'sent') && (
            <div style={{ marginTop: 8 }}>
              <AuditDetails audit={a} setup={setup} ctx={ctx} names={names} />
              {a.status === 'sent' && (
                <div className="form-actions">
                  <button className="btn-sm" disabled={busy} onClick={() => { setDisputing(a); setReason(''); setError(''); }}>⚖️ Dispute</button>
                  <button className="btn-primary" disabled={busy} onClick={() => ack(a)}>✓ Acknowledge</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {disputing && (
        <Modal title="Dispute this audit" onClose={() => setDisputing(null)}>
          <div className="field"><label>Why do you disagree?</label>
            <textarea rows={3} maxLength={600} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. The SOP for this client says to rebill, not appeal." />
          </div>
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient or claim details.</p>
          {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setDisputing(null)}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={sendDispute}>Send dispute</button>
          </div>
        </Modal>
      )}
    </>
  );
}
