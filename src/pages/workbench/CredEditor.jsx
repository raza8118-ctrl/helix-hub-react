import { useState } from 'react';
import { CRED_RECORDS, checkCred, saveCred, suggestReval } from '../../lib/credentialing';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * Add / edit a provider, payer enrollment or expiring item (roadmap 9.3) — fields from CRED_RECORDS[kind].
 * extra = parent link for new rows (e.g. { provider_id }). No SSN / date of birth / home address fields, on purpose.
 */
export default function CredEditor({ kind, row, extra = {}, preset = {}, ctx, user, onClose, onSaved }) {
  const t = CRED_RECORDS[kind];
  const [v, setV] = useState(() => Object.fromEntries(t.fields.map(f => [f.key, row?.[f.key] ?? preset[f.key] ?? (f.type === 'select' && f.required ? f.options[0].value : '')])));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, x) => setV(s => ({ ...s, [k]: x }));
  const isMedicare = kind === 'enrollment' && /medicare|palmetto|cgs|ngs|novitas|noridian|wps|first coast/i.test(ctx.payers.find(p => p.id === v.payer_id)?.name ?? '');

  async function save() {
    const problem = checkCred(kind, v);
    if (problem) return setError(problem);
    setSaving(true);
    const saved = await saveCred(kind, row, v, user, row ? {} : extra);
    setSaving(false);
    if (!saved) return setError('Could not save. Please try again.');
    onSaved(saved);
  }

  const input = f => {
    const val = v[f.key] ?? '';
    if (f.type === 'select') {
      return (
        <select value={val} onChange={e => set(f.key, e.target.value)}>
          {!f.required && <option value="">—</option>}
          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (f.type === 'client') {
      return (
        <select value={val} onChange={e => set(f.key, e.target.value ? Number(e.target.value) : '')}>
          <option value="">—</option>
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
    if (f.type === 'textarea') return <textarea rows={2} value={val} onChange={e => set(f.key, e.target.value)} />;
    if (f.type === 'date') return <input type="date" value={val} onChange={e => set(f.key, e.target.value)} />;
    return <input type="text" value={val} maxLength={120} onChange={e => set(f.key, e.target.value)} />;
  };

  return (
    <Modal title={`${row ? 'Edit' : 'Add'} ${t.one}`} onClose={onClose} wide>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {t.fields.map(f => (
          <div key={f.key} className="field" style={{ flex: f.type === 'textarea' ? '1 1 100%' : f.type === 'payer' ? '1 1 280px' : '1 1 200px' }}>
            <label>{f.label}</label>
            {input(f)}
            {f.hint && <span className="text-sm text-muted">{f.hint}</span>}
            {f.key === 'revalidation_due' && isMedicare && v.effective_on && !v.revalidation_due && (
              <button type="button" className="btn-sm" style={{ marginTop: 4 }} onClick={() => set('revalidation_due', suggestReval(v.effective_on))}>
                Use approval + 5 years ({suggestReval(v.effective_on)})
              </button>
            )}
          </div>
        ))}
      </div>
      {kind === 'provider' && <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 Social Security numbers, dates of birth and home addresses are never stored in Helix Hub.</p>}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save' : 'Add'}</button>
      </div>
    </Modal>
  );
}
