import { useState } from 'react';
import { REMINDER_ACTIONS, addReminder } from '../../lib/followups';
import { addDays, today } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * “+ Reminder” (roadmap 6.5): a personal follow-up for a claim that isn't on a worklist.
 * Minimum fields only — no free text and no patient details; the claim # is optional and wiped 90 days later.
 */
export default function ReminderModal({ ctx, user, onClose, onSaved }) {
  const [clientId, setClientId] = useState('');
  const [payer, setPayer] = useState(null);
  const [action, setAction] = useState('call_back');
  const [due, setDue] = useState(addDays(today(), 1));
  const [claim, setClaim] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!due) return setError('Choose the date.');
    setSaving(true);
    const row = await addReminder({ empId: user.emp_id, clientId: clientId ? Number(clientId) : null, payerId: payer?.id ?? null,
      claimNumber: claim, action, dueDate: due }, user);
    setSaving(false);
    if (!row) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title="Add a follow-up reminder" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="field"><label>What to do</label>
          <select value={action} onChange={e => setAction(e.target.value)}>
            {REMINDER_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 160px' }}><label>When</label>
            <input type="date" value={due} min={today()} onChange={e => setDue(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}><label>Claim # (optional)</label>
            <input type="text" value={claim} onChange={e => setClaim(e.target.value)} />
          </div>
        </div>
        <div className="field"><label>Client</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">— Not set —</option>
            {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Payer</label>
          {payer
            ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => setPayer(null)}>✕</button></div>
            : <PayerSearch payers={ctx.payers} onSelect={setPayer} />}
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient names, dates of birth or member IDs. The claim # is wiped 90 days after the reminder is done.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add reminder'}</button>
        </div>
      </div>
    </Modal>
  );
}
