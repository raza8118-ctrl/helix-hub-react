import { useState } from 'react';
import { typeOf } from '../../lib/denials';
import { scopeOf, saveSteps } from '../../lib/denialSteps';
import { Modal, Field, FormActions, Button, Notice } from '../../components/ui';

/**
 * Add / edit the steps for one denial code in one layer (roadmap 4.2).
 * target = { id, name } of the client or payer (null for common steps).
 */
export default function DenialStepsModal({ code, scope, target, existing, allSteps, sops, user, onClose, onSaved }) {
  const [steps, setSteps] = useState(existing?.steps ?? '');
  const [sopId, setSopId] = useState(existing?.sop_id ? String(existing.sop_id) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Client layer: that client's SOPs first, then common ones; inactive SOPs only if already linked
  const sopChoices = sops
    .filter(s => s.active !== false || String(s.id) === sopId)
    .sort((a, b) => (scope === 'client' && target
      ? (String(b.client_id) === String(target.id)) - (String(a.client_id) === String(target.id)) : 0)
      || a.title.localeCompare(b.title));

  async function save() {
    if (!steps.trim()) return setError('Please write the steps.');
    setSaving(true);
    const result = await saveSteps(allSteps, existing, {
      codeId: code.id, scope, targetId: target?.id ?? null, steps: steps.trim(),
      sopId: sopId ? Number(sopId) : null, notes: notes.trim(),
    }, user);
    setSaving(false);
    if (result.error) return setError(result.error);
    onSaved();
  }

  const s = scopeOf(scope);
  return (
    <Modal title={`${s.icon} ${s.label}${target ? ` — ${target.name}` : ''} · ${typeOf(code.code_type).label} ${code.code}`} onClose={onClose} wide>
      <div>
        <Field label="Steps" required
          hint={<>Formatting: <b>1.</b> numbered step · <b>-</b> bullet · <b>**bold**</b> · <b>!</b> at the start = ⚠ important line.</>}>
          <textarea rows={8} value={steps} onChange={e => { setSteps(e.target.value); setError(''); }}
            placeholder={'One step per line, e.g.\n1. Check the remark code on the ERA\n2. Correct the rendering NPI in the claim\n3. Resubmit as a corrected claim (TOB xx7)\n! Don’t send an appeal for this one'} />
        </Field>
        <Field label="Linked SOP (optional)">
          <select value={sopId} onChange={e => setSopId(e.target.value)}>
            <option value="">— None —</option>
            {sopChoices.map(sop => (
              <option key={sop.id} value={String(sop.id)}>
                {sop.title}{sop.status !== 'published' ? ' (draft)' : ''}{sop.active === false ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional, e.g. who to ask" />
        </Field>
        <p className="ui-muted" style={{ margin: '0 0 var(--ui-s3)' }}>🔒 No patient information — describe what to do, not a specific claim.</p>
        {error && <Notice tone="bad">{error}</Notice>}
        <FormActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : existing ? 'Save Changes' : 'Add'}</Button>
        </FormActions>
      </div>
    </Modal>
  );
}
