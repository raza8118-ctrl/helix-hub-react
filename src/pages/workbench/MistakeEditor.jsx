import { useState } from 'react';
import { SEVERITIES, TEXT_FIELDS, checkMistake, addMistake, editMistake, canEditMistakes } from '../../lib/mistakes';
import { TEAMS } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import PayerSearch from '../../components/shared/PayerSearch';

const HINTS = {
  what_happened: 'e.g. A denial caused by our own billing error was appealed instead of corrected.',
  why_it_matters: 'e.g. The appeal is upheld and the appeal level is used up.',
  fix_steps: 'One step per line',
  prevent_steps: 'One step per line',
};

/** Add / edit / suggest an error library entry (roadmap 7.2). Non-editors' new entries go in as suggestions. */
export default function MistakeEditor({ row, categories, ctx, user, onClose, onSaved }) {
  const editor = canEditMistakes(user);
  const [m, setM] = useState(() => ({
    title: row?.title ?? '', team: row?.team ?? '', category_id: row?.category_id ?? null, severity: row?.severity ?? 'medium',
    what_happened: row?.what_happened ?? '', why_it_matters: row?.why_it_matters ?? '', fix_steps: row?.fix_steps ?? '',
    prevent_steps: row?.prevent_steps ?? '', sop_id: row?.sop_id ?? null, client_id: row?.client_id ?? null,
    payer_id: row?.payer_id ?? null, denial_code: row?.denial_code ?? '',
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setM(s => ({ ...s, [k]: v }));
  const payer = m.payer_id ? ctx.payers.find(p => p.id === m.payer_id) : null;
  const num = v => (v ? Number(v) : null);

  async function save() {
    const problem = checkMistake(m);
    if (problem) return setError(problem);
    setSaving(true);
    const ok = row ? await editMistake(row, m, user) : await addMistake(m, user);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title={row ? 'Edit mistake' : editor ? 'Add a mistake' : '💡 Suggest a mistake'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!row && !editor && <p className="text-sm text-muted" style={{ marginTop: 0 }}>Your suggestion is reviewed by QA before everyone sees it.</p>}
        <div className="field"><label>Title</label>
          <input type="text" value={m.title} maxLength={150} onChange={e => set('title', e.target.value)} placeholder="e.g. Appealed when a corrected claim was needed" />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 150px' }}><label>Team</label>
            <select value={m.team} onChange={e => set('team', e.target.value)}>
              <option value="">Any team</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}><label>QA error category</label>
            <select value={m.category_id ?? ''} onChange={e => set('category_id', num(e.target.value))}>
              <option value="">— None —</option>
              {categories.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}><label>Severity</label>
            <select value={m.severity} onChange={e => set('severity', e.target.value)}>
              {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        {TEXT_FIELDS.map(f => (
          <div key={f.key} className="field"><label>{f.label}</label>
            <textarea rows={f.steps ? 3 : 2} maxLength={1500} value={m[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={HINTS[f.key]} />
          </div>
        ))}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 220px' }}><label>SOP to read (optional)</label>
            <select value={m.sop_id ?? ''} onChange={e => set('sop_id', num(e.target.value))}>
              <option value="">— None —</option>
              {ctx.sops.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}><label>Denial code (optional)</label>
            <input type="text" value={m.denial_code} maxLength={20} onChange={e => set('denial_code', e.target.value)} placeholder="e.g. CO-29" />
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}><label>Only for this client (optional)</label>
            <select value={m.client_id ?? ''} onChange={e => set('client_id', num(e.target.value))}>
              <option value="">All clients</option>
              {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}><label>Only for this payer (optional)</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => set('payer_id', null)}>✕</button></div>
              : <PayerSearch payers={ctx.payers} onSelect={p => set('payer_id', p.id)} />}
          </div>
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 General know-how only — no patient names, dates, member IDs or claim numbers.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save' : editor ? 'Add' : 'Send suggestion'}</button>
        </div>
      </div>
    </Modal>
  );
}
