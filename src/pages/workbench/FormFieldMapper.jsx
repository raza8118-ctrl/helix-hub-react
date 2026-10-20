import { useState } from 'react';
import { TOKEN_GROUPS, SAMPLE_VALUES } from '../../lib/appealTemplates';
import { CHECK_RULES, fillForm } from '../../lib/appealPdf';
import { saveFieldMap } from '../../lib/payerForms';
import Modal from '../../components/shared/Modal';

/**
 * 🧩 Map form fields (roadmap 5.4): for each field of a fillable payer form, choose which appeal value fills it
 * (a placeholder, fixed text, a tick-box rule or nothing). Saved on the payer form; holds no patient data.
 * "Test fill" opens the form filled with made-up sample values.
 */
export default function FormFieldMapper({ payerForm, bytes, fields, user, onClose, onSaved }) {
  const [map, setMap] = useState(() => ({ ...(payerForm.field_map ?? {}) }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const setRule = (name, rule) => setMap(m => {
    const next = { ...m };
    if (rule) next[name] = rule; else delete next[name];
    return next;
  });
  const usable = fields.filter(f => ['text', 'checkbox', 'dropdown'].includes(f.type));
  const skipped = fields.length - usable.length;

  async function testFill() {
    const { bytes: out } = await fillForm(bytes, map, SAMPLE_VALUES, { level: 'first', type: 'auth' }, { flatten: false });
    window.open(URL.createObjectURL(new Blob([out], { type: 'application/pdf' })), '_blank');
  }
  async function save() {
    setSaving(true);
    const ok = await saveFieldMap(payerForm, map, user);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved();
  }

  const selectValue = rule => !rule ? '' : rule.kind === 'token' ? `token:${rule.token}` : rule.kind === 'text' ? 'text' : '';
  return (
    <Modal title={`Map form fields — ${payerForm.title}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          Choose what fills each field. This is saved on the form for everyone — it says <b>where</b> values go and never stores
          patient details. {skipped > 0 && `${skipped} field(s) of other kinds (e.g. radio buttons, signatures) are left as they are.`}
        </p>
        {usable.length === 0 && <p className="text-sm">This form has no fields that can be filled.</p>}
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {usable.map(f => {
            const rule = map[f.name];
            return (
              <div key={f.name} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>
                  <b>{f.name}</b> <span className="text-sm text-muted">{f.type}{f.page ? ` · page ${f.page}` : ''}</span>
                </span>
                {f.type === 'checkbox' ? (
                  <select value={rule?.when ?? ''} onChange={e => setRule(f.name, e.target.value ? { kind: 'check', when: e.target.value } : null)} style={{ maxWidth: 280 }}>
                    <option value="">Never tick</option>
                    {CHECK_RULES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                ) : (
                  <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    <select value={selectValue(rule)} style={{ maxWidth: 260 }}
                      onChange={e => {
                        const v = e.target.value;
                        setRule(f.name, !v ? null : v === 'text' ? { kind: 'text', text: rule?.text ?? '' } : { kind: 'token', token: v.slice(6) });
                      }}>
                      <option value="">Leave blank</option>
                      <option value="text">Fixed text…</option>
                      {TOKEN_GROUPS.map(g => (
                        <optgroup key={g.label} label={g.label}>
                          {g.tokens.map(t => <option key={t.token} value={`token:${t.token}`}>{t.label}{t.id ? ' 🔒' : ''}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {rule?.kind === 'text' && (
                      <input type="text" value={rule.text} placeholder="e.g. provider NPI" style={{ maxWidth: 200 }}
                        onChange={e => setRule(f.name, { kind: 'text', text: e.target.value })} />
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-sm text-muted">🔒 Fixed text is for things that are the same on every appeal (NPI, tax ID, provider address) — never patient details.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={testFill} disabled={!usable.length}>👁 Test fill with sample data</button>
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save field map'}</button>
        </div>
      </div>
    </Modal>
  );
}
