import { useState } from 'react';
import { SUGGESTION_SECTIONS, showValue, approveSuggestion } from '../../lib/payerSuggestions';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * Review one suggested Payer Directory change (roadmap 8.3): pick the payer if unmatched, edit the values, see the
 * current directory values and the bulletin's own words, then ✓ Approve (written to the directory, verified today).
 */
export default function SuggestionEditor({ suggestion, bulletin, ctx, user, onClose, onSaved }) {
  const t = SUGGESTION_SECTIONS[suggestion.section];
  const [payerId, setPayerId] = useState(suggestion.payer_id);
  const [values, setValues] = useState(() => Object.fromEntries(t.fields.map(f => [f.key, suggestion.proposed?.[f.key] ?? suggestion.current?.[f.key] ?? ''])));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const payer = payerId ? ctx.payers.find(p => p.id === payerId) : null;
  const set = (k, v) => setValues(s => ({ ...s, [k]: v }));

  async function approve() {
    setSaving(true);
    const problem = await approveSuggestion(suggestion, values, payer, bulletin?.title, user);
    setSaving(false);
    if (problem) return setError(problem);
    onSaved();
  }

  return (
    <Modal title={`${t.icon} Review suggested change — ${t.title}`} onClose={onClose} wide>
      <div className="field"><label>Payer</label>
        {payer
          ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => setPayerId(null)}>✕</button></div>
          : (
            <>
              <PayerSearch payers={ctx.payers} onSelect={p => setPayerId(p.id)} />
              {suggestion.payer_name && <span className="text-sm text-muted">The bulletin says “{suggestion.payer_name}”.</span>}
            </>
          )}
      </div>
      {suggestion.evidence && (
        <blockquote className="text-sm" style={{ margin: '0 0 10px', padding: '6px 10px', borderLeft: '3px solid var(--border)' }}>
          “{suggestion.evidence}”{suggestion.source_page ? <span className="text-muted"> — page {suggestion.source_page}</span> : null}
        </blockquote>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {t.fields.map(f => {
          const cur = suggestion.current?.[f.key];
          return (
            <div key={f.key} className="field" style={{ flex: f.type === 'textarea' ? '1 1 100%' : '1 1 200px' }}>
              <label>{f.label}{f.required ? '' : ' (optional)'}</label>
              {f.type === 'select' ? (
                <select value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea rows={3} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
              ) : (
                <input type={f.type === 'number' ? 'number' : 'text'} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
              )}
              {suggestion.current && <span className="text-sm text-muted">Now in the directory: {showValue(suggestion.section, f.key, cur)}</span>}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>
        Approving adds this to the payer card (or changes the matching {t.title.toLowerCase()} entry) and marks it verified today.
      </p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={approve} disabled={saving}>{saving ? 'Saving…' : '✓ Approve'}</button>
      </div>
    </Modal>
  );
}
