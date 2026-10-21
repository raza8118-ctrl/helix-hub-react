import { useState } from 'react';
import { UPDATE_CATEGORIES, editUpdate } from '../../lib/payerUpdates';
import { TEAMS } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/** ✏️ Edit one payer change (roadmap 8.2, “Manage payer updates”). */
export default function UpdateEditor({ update, ctx, user, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    payer_id: update.payer_id, payer_name: update.payer_name ?? '', effective_date: update.effective_date ?? '',
    change_text: update.change_text ?? '', category: update.category ?? 'other', teams: update.teams ?? [], action_needed: update.action_needed ?? '',
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, x) => setV(s => ({ ...s, [k]: x }));
  const payer = v.payer_id ? ctx.payers.find(p => p.id === v.payer_id) : null;

  async function save() {
    if (!v.change_text.trim()) return setError('Say what changed.');
    setSaving(true);
    const ok = await editUpdate(update, v, user);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title="Edit payer change" onClose={onClose} wide>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 240px' }}><label>Payer</label>
          {payer
            ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set('payer_id', null)}>✕</button></div>
            : (
              <>
                <PayerSearch payers={ctx.payers} onSelect={p => set('payer_id', p.id)} placeholder="Match to the Payer Directory…" />
                <input type="text" style={{ marginTop: 4 }} value={v.payer_name} maxLength={120} placeholder="…or as written in the bulletin" onChange={e => set('payer_name', e.target.value)} />
              </>
            )}
        </div>
        <div className="field" style={{ flex: '0 1 160px' }}><label>Effective date</label>
          <input type="date" value={v.effective_date} onChange={e => set('effective_date', e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 180px' }}><label>Category</label>
          <select value={v.category} onChange={e => set('category', e.target.value)}>
            {UPDATE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>What changed</label>
        <textarea rows={3} maxLength={1000} value={v.change_text} onChange={e => set('change_text', e.target.value)} />
      </div>
      <div className="field"><label>Action needed</label>
        <input type="text" value={v.action_needed} maxLength={500} onChange={e => set('action_needed', e.target.value)} />
      </div>
      <div className="row text-sm" style={{ gap: 10, flexWrap: 'wrap' }}>
        <span className="text-muted">Teams:</span>
        {TEAMS.map(t => (
          <label key={t} className="row" style={{ gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={v.teams.includes(t)}
              onChange={() => set('teams', v.teams.includes(t) ? v.teams.filter(x => x !== t) : [...v.teams, t])} /> {t}
          </label>
        ))}
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}
