import { useState } from 'react';
import { TRACKERS, checkItem, addItem, editItem } from '../../lib/medicareTrackers';
import { addDays } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * Add / edit one Medicare tracker item (roadmap 7.5) — the fields come from TRACKERS[kind]. A due date with `from` is
 * filled from its base date (e.g. ADR letter + 45 days) until the user types their own.
 */
export default function MedicareItemEditor({ kind, row, ctx, user, onClose, onSaved }) {
  const t = TRACKERS[kind];
  const [v, setV] = useState(() => Object.fromEntries(t.fields.map(f => [f.key, row?.[f.key] ?? (f.type === 'select' && f.required ? f.options[0].value : '')])));
  const [dueTouched, setDueTouched] = useState(!!row);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function set(key, value) {
    setV(s => {
      const next = { ...s, [key]: value };
      // Auto due date from its base date
      for (const f of t.fields) if (f.from === key && !dueTouched && value) next[f.key] = addDays(value, f.days);
      return next;
    });
    if (t.fields.some(f => f.key === key && f.from)) setDueTouched(true);
  }

  async function save() {
    const problem = checkItem(kind, v);
    if (problem) return setError(problem);
    setSaving(true);
    const ok = row ? await editItem(kind, row, v, user) : await addItem(kind, v, user);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved(ok);
  }

  const input = f => {
    const val = v[f.key] ?? '';
    if (f.type === 'client') {
      return (
        <select value={val} onChange={e => set(f.key, e.target.value ? Number(e.target.value) : '')}>
          <option value="">— Choose —</option>
          {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      );
    }
    if (f.type === 'payer') {
      const payer = val ? ctx.payers.find(p => p.id === val) : null;
      return payer
        ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set(f.key, '')}>✕</button></div>
        : <PayerSearch payers={ctx.payers} onSelect={p => set(f.key, p.id)} />;
    }
    if (f.type === 'select') {
      return (
        <select value={val} onChange={e => set(f.key, e.target.value)}>
          {!f.required && <option value="">—</option>}
          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (f.type === 'date') return <input type="date" value={val} onChange={e => set(f.key, e.target.value)} />;
    if (f.type === 'money') return <input type="number" step="0.01" value={val} onChange={e => set(f.key, e.target.value)} />;
    return <input type="text" value={val} maxLength={60} onChange={e => set(f.key, e.target.value)} />;
  };

  return (
    <Modal title={`${row ? 'Edit' : 'Add'} ${t.label}`} onClose={onClose} wide>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {t.fields.map(f => (
          <div key={f.key} className="field" style={{ flex: f.type === 'payer' || f.type === 'client' ? '1 1 260px' : '1 1 180px' }}>
            <label>{f.label}</label>
            {input(f)}
            {f.hint && <span className="text-sm text-muted">{f.hint}</span>}
          </div>
        ))}
      </div>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient names, dates of birth or MBIs — only the claim # / DCN. It is wiped 90 days after the item is closed.</p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save' : 'Add'}</button>
      </div>
    </Modal>
  );
}
