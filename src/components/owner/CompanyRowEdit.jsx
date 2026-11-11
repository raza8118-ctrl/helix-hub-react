import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import { EDITS, companyPeople, saveCompanyEdit } from '../../lib/companyData';

/**
 * Owner → Company Data → "Edit" (PO 2026-11-10, Stage 4). Only the fields listed for the list; nothing is deleted
 * (Active / Inactive instead). Step 1 change the fields, step 2 confirm "before → after", then save. Logged in the owner
 * log and the company's Audit Log with before → after.
 */
const toInput = (f, v) => (f.type === 'list' ? (v ?? []).join(', ') : f.type === 'bool' ? (f.key === 'active' ? v !== false : !!v) : f.type === 'date' ? (v ? String(v).slice(0, 10) : '') : v ?? '');
const fromInput = (f, v) => {
  if (f.type === 'list') return [...new Set(String(v).split(',').map(x => x.trim()).filter(Boolean))];
  if (f.type === 'bool') return !!v;
  if (f.type === 'number') return v === '' ? null : Number(v);
  return String(v).trim() === '' ? null : String(v).trim();
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default function CompanyRowEdit({ owner, company, mod, view, row, onClose, onSaved }) {
  const edit = EDITS[view.id];
  const [form, setForm] = useState(() => Object.fromEntries(edit.fields.map(f => [f.key, toInput(f, row._raw[f.key])])));
  const [people, setPeople] = useState([]);
  const [step, setStep] = useState('edit');   // edit · confirm · done
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const needsPeople = edit.fields.some(f => f.type === 'person');

  useEffect(() => {
    let alive = true;
    if (needsPeople) companyPeople(company.prefix ?? '').then(p => alive && setPeople(p));
    return () => { alive = false; };
  }, [needsPeople, company.prefix]);

  const before = f => (f.type === 'bool' && f.key === 'active' ? row._raw.active !== false : row._raw[f.key]);
  const patch = Object.fromEntries(edit.fields
    .map(f => [f, fromInput(f, form[f.key])])
    .filter(([f, v]) => !same(f.type === 'bool' ? !!before(f) : f.type === 'date' ? (before(f) ? String(before(f)).slice(0, 10) : null) : before(f), v))
    .map(([f, v]) => [f.key, v]));
  const missing = edit.fields.filter(f => f.required && !fromInput(f, form[f.key]));
  const show = (f, v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (f.type === 'bool') return v ? 'Yes' : 'No';
    if (f.type === 'list') return v.join(', ');
    if (f.type === 'select') return f.options.find(o => o.value === v)?.label ?? v;
    if (f.type === 'person') return people.find(p => p.emp_id === v)?.name ?? v;
    return String(v);
  };

  async function save() {
    setBusy(true); setErr('');
    const r = await saveCompanyEdit({ owner, company, mod, view, row, patch });
    setBusy(false);
    if (r.error) { setErr(`Not saved: ${r.error}`); return; }
    setStep('done');
  }

  const label = row.name ?? row.title ?? (row.code ? `${row.type ?? row.code_set ?? ''} ${row.code}` : null) ?? row.claim_number ?? `#${row.id}`;
  return (
    <Modal title={`Edit — ${view.label}`} onClose={busy ? () => {} : onClose}>
      <p style={{ marginTop: 0 }}><strong>{label}</strong> <span className="text-sm text-muted">in {company.name}</span></p>
      {step === 'edit' && (
        <>
          {mod.phi && <p className="text-sm text-muted" style={{ marginTop: 0 }}>Only work fields can be changed here — never patient details, claim numbers or amounts.</p>}
          {edit.fields.map(f => (
            <label key={f.key} className={f.type === 'bool' ? 'omp-check' : 'ocd-field'}>
              {f.type === 'bool'
                ? <><input type="checkbox" checked={!!form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.checked }))} /><span>{f.label}</span></>
                : (
                  <>
                    <span className="text-sm">{f.label}{f.required && <span className="si-req"> *</span>}</span>
                    {f.type === 'textarea' && <textarea rows={3} value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />}
                    {f.type === 'select' && (
                      <select value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))}>
                        {!f.options.some(o => o.value === form[f.key]) && <option value={form[f.key]}>{form[f.key] || '—'}</option>}
                        {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                    {f.type === 'person' && (
                      <select value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))}>
                        <option value="">— Nobody —</option>
                        {form[f.key] && !people.some(p => p.emp_id === form[f.key]) && <option value={form[f.key]}>{form[f.key]}</option>}
                        {people.map(p => <option key={p.emp_id} value={p.emp_id}>{p.name} ({p.emp_id})</option>)}
                      </select>
                    )}
                    {['text', 'list', 'date', 'number'].includes(f.type) && (
                      <input type={f.type === 'list' ? 'text' : f.type} value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />
                    )}
                  </>
                )}
            </label>
          ))}
          {missing.length > 0 && <p className="ot-err">Needed: {missing.map(f => f.label).join(', ')}.</p>}
          <div className="si-actions">
            <button type="button" className="btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!Object.keys(patch).length || missing.length > 0} onClick={() => setStep('confirm')}>Review changes</button>
          </div>
        </>
      )}
      {step === 'confirm' && (
        <>
          <p className="text-sm" style={{ marginTop: 0 }}>Save these changes to <strong>{company.name}</strong>’s data? They’re recorded in your owner log and the company’s Audit Log.</p>
          <div className="table-wrap">
            <table className="ocd-table">
              <thead><tr><th>Field</th><th>Now</th><th>After saving</th></tr></thead>
              <tbody>
                {edit.fields.filter(f => f.key in patch).map(f => (
                  <tr key={f.key}><td>{f.label}</td><td>{show(f, before(f))}</td><td><strong>{show(f, patch[f.key])}</strong></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {err && <p className="ot-err" role="alert">{err}</p>}
          <div className="si-actions">
            <button type="button" className="btn-sm" onClick={() => setStep('edit')} disabled={busy}>Back</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </>
      )}
      {step === 'done' && (
        <>
          <p>✓ Saved. Recorded in your owner log and {company.name}’s Audit Log.</p>
          <div className="si-actions"><button type="button" className="btn-primary" onClick={() => { onSaved?.(); onClose(); }}>Done</button></div>
        </>
      )}
    </Modal>
  );
}
