import { useState } from 'react';
import { ESC_TYPES, ESC_SEVERITIES, targetFor, checkEsc, addEscalation, editEscalation } from '../../lib/escalations';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * Raise / edit an escalation (roadmap 7.4). initial = prefill (e.g. from a handover carry-over item);
 * create(values) replaces the normal insert (used by “⚑ Escalate” on a handover item). Supervisors / managers first
 * in the “Goes to” list.
 */
export default function EscalationEditor({ row, initial = {}, create, ctx, people, user, onClose, onSaved }) {
  const [e, setE] = useState(() => {
    const severity = row?.severity ?? initial.severity ?? 'medium';
    return {
      title: row?.title ?? initial.title ?? '', type: row?.type ?? initial.type ?? 'other', severity,
      client_id: row?.client_id ?? initial.client_id ?? null, payer_id: row?.payer_id ?? initial.payer_id ?? null,
      claim_number: row?.claim_number ?? initial.claim_number ?? '', details: row?.details ?? initial.details ?? '',
      assigned_to: row?.assigned_to ?? '', target_date: row?.target_date ?? targetFor(severity),
    };
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setE(s => ({ ...s, [k]: v }));
  const payer = e.payer_id ? ctx.payers.find(p => p.id === e.payer_id) : null;
  const leads = people.filter(p => p.emp_id !== user.emp_id && p.role && p.role !== 'employee');
  const others = people.filter(p => p.emp_id !== user.emp_id && !leads.includes(p));

  async function save() {
    const problem = checkEsc(e);
    if (problem) return setError(problem);
    setSaving(true);
    const ok = row ? await editEscalation(row, e, user) : create ? await create(e) : await addEscalation(e, user);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved(ok);
  }

  return (
    <Modal title={row ? 'Edit escalation' : '⚑ Raise an escalation'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="field"><label>Title</label>
          <input type="text" value={e.title} maxLength={150} onChange={ev => set('title', ev.target.value)} placeholder="e.g. Waystar rejecting all claims for one client" />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 180px' }}><label>Type</label>
            <select value={e.type} onChange={ev => set('type', ev.target.value)}>
              {ESC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Severity</label>
            <select value={e.severity} onChange={ev => { const s = ev.target.value; setE(x => ({ ...x, severity: s, ...(row ? {} : { target_date: targetFor(s) }) })); }}>
              {ESC_SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Target date</label>
            <input type="date" value={e.target_date ?? ''} onChange={ev => set('target_date', ev.target.value)} />
          </div>
        </div>
        <div className="field"><label>Goes to</label>
          <select value={e.assigned_to} onChange={ev => set('assigned_to', ev.target.value)}>
            <option value="">— Choose —</option>
            {leads.length > 0 && <optgroup label="Supervisors / managers">{leads.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label="Others">{others.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name}</option>)}</optgroup>}
          </select>
        </div>
        <div className="field"><label>Details</label>
          <textarea rows={3} maxLength={1500} value={e.details} onChange={ev => set('details', ev.target.value)} placeholder="What happened, what you tried, what you need" />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 180px' }}><label>Client (optional)</label>
            <select value={e.client_id ?? ''} onChange={ev => set('client_id', ev.target.value ? Number(ev.target.value) : null)}>
              <option value="">—</option>
              {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}><label>Payer (optional)</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set('payer_id', null)}>✕</button></div>
              : <PayerSearch payers={ctx.payers} onSelect={p => set('payer_id', p.id)} />}
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Claim # (optional)</label>
            <input type="text" value={e.claim_number} onChange={ev => set('claim_number', ev.target.value)} />
          </div>
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient names, dates of birth, member IDs or dates — use the claim # field.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save' : 'Raise escalation'}</button>
        </div>
      </div>
    </Modal>
  );
}
