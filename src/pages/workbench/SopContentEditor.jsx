// Not used since roadmap 3.3 — replaced by the full-page editor SopEditorPage.jsx. Kept (nothing is deleted).
import { useState } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { TEAMS } from '../../lib/constants';
import { SOP_SECTIONS, sopSteps } from '../../lib/sops';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const hintOf = key => SOP_SECTIONS.find(s => s.key === key)?.hint;
const blankStep = () => ({ text: '', tip: '', image: null });

/**
 * "Edit content" pop-up for one SOP page (roadmap 3.2): the template sections as plain text,
 * plus numbered steps that can be added, removed and moved. Screenshots arrive in 3.3.
 */
export default function SopContentEditor({ sop, user, onClose, onSaved }) {
  const [values, setValues] = useState(() => ({
    purpose:         sop.purpose ?? '',
    audience_teams:  sop.audience_teams ?? [],
    audience_notes:  sop.audience_notes ?? '',
    prerequisites:   sop.prerequisites ?? '',
    expected_result: sop.expected_result ?? '',
    troubleshooting: sop.troubleshooting ?? '',
  }));
  const [steps, setSteps] = useState(() => {
    const list = sopSteps(sop);
    return list.length ? list : [blankStep()];
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const setV = patch => { setValues(v => ({ ...v, ...patch })); setError(''); };

  const toggleTeam = team => setV({
    audience_teams: values.audience_teams.includes(team)
      ? values.audience_teams.filter(t => t !== team)
      : TEAMS.filter(t => t === team || values.audience_teams.includes(t)),
  });
  const setStep = (i, patch) => { setSteps(list => list.map((s, j) => j === i ? { ...s, ...patch } : s)); setError(''); };
  const moveStep = (i, dir) => setSteps(list => {
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    return next;
  });
  const removeStep = i => setSteps(list => list.filter((_, j) => j !== i));

  async function save() {
    const cleanSteps = steps
      .map(s => ({ text: s.text.trim(), tip: s.tip.trim(), image: s.image ?? null }))
      .filter(s => s.text || s.tip || s.image);
    if (cleanSteps.some(s => !s.text)) return setError('Every step needs an instruction (a tip on its own isn’t enough).');
    if (!await confirmDialog({ title: 'Save SOP content?', message: sop.title, confirmText: 'Save Changes' })) return;

    const text = v => v.trim() || null;
    const payload = {
      purpose:         text(values.purpose),
      audience_teams:  values.audience_teams,
      audience_notes:  text(values.audience_notes),
      prerequisites:   text(values.prerequisites),
      steps:           cleanSteps,
      expected_result: text(values.expected_result),
      troubleshooting: text(values.troubleshooting),
      updated_by: user.emp_id, updated_at: new Date().toISOString(),
    };
    setSaving(true);
    const result = await S.update('sops', payload, { id: sop.id });
    setSaving(false);
    if (!result?.length) return setError('Could not save. Please try again.');
    logAudit({ actor: user, action: 'sop_content_edit', entityType: 'sop', entityId: sop.id, details: { steps: cleanSteps.length } });
    onSaved();
  }

  const area = (key, rows = 3) => (
    <textarea rows={rows} value={values[key]} placeholder={hintOf(key)} onChange={e => setV({ [key]: e.target.value })} />
  );

  return (
    <Modal title={`Edit SOP content — ${sop.title}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm" style={{ marginTop: 0, padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)' }}>
          🔒 Never type patient information here (names, DOB, member IDs, claim notes). Use made-up examples.
        </p>

        <div className="field"><label>Purpose</label>{area('purpose')}</div>

        <div className="field">
          <label>Who uses it</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {TEAMS.map(team => {
              const on = values.audience_teams.includes(team);
              return (
                <button key={team} type="button" className={on ? 'btn-primary btn-sm' : 'btn-sm'}
                  aria-pressed={on} onClick={() => toggleTeam(team)}>
                  {on ? '✓ ' : ''}{team}
                </button>
              );
            })}
          </div>
          <input type="text" value={values.audience_notes} placeholder="Anything more, e.g. “New joiners after Day 3”, “Only for client ABC”"
            onChange={e => setV({ audience_notes: e.target.value })} />
        </div>

        <div className="field"><label>Before you start</label>{area('prerequisites')}</div>

        <div className="field">
          <label>Steps</label>
          {steps.map((s, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
              <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span className="bold">Step {i + 1}</span>
                <span style={{ marginLeft: 'auto' }} className="row">
                  <button type="button" className="btn-sm" title="Move up" disabled={i === 0} onClick={() => moveStep(i, -1)}>▲</button>
                  <button type="button" className="btn-sm" title="Move down" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}>▼</button>
                  <button type="button" className="btn-sm" title="Remove step" onClick={() => removeStep(i)}>✕</button>
                </span>
              </div>
              <textarea rows={2} value={s.text} placeholder="What to do, e.g. “Click Claims › Claim Status and enter the payer ID”"
                onChange={e => setStep(i, { text: e.target.value })} />
              <input type="text" value={s.tip} placeholder="Optional tip / watch out" style={{ marginTop: 6 }}
                onChange={e => setStep(i, { tip: e.target.value })} />
            </div>
          ))}
          <button type="button" className="btn-sm" onClick={() => setSteps(list => [...list, blankStep()])}>+ Add step</button>
          <p className="text-sm text-muted" style={{ marginBottom: 0 }}>Screenshots for each step can be added in a later update.</p>
        </div>

        <div className="field"><label>What you should see</label>{area('expected_result')}</div>
        <div className="field"><label>If it goes wrong</label>{area('troubleshooting', 4)}</div>

        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </Modal>
  );
}
