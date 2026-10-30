import { useState } from 'react';
import { STYLES, buildAIRequest, improveWording, validateAILetter } from '../../lib/appealAI';
import { Card, Button, Badge, Tabs, Check, Notice } from '../../components/ui';

/**
 * ✨ Improve wording with AI (roadmap 5.3). Shows exactly what will be sent (the template with placeholders + facts
 * that don't identify the patient), blocks sending when typed text looks like patient information, needs a
 * confirmation tick, then checks the answer keeps every identifier placeholder. Real values are filled in locally.
 */
export default function AppealAIPanel({ template, form, set, effectiveType, clientName, payerName, codesText, reasonText, user }) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null);   // { warnings } of the last accepted answer

  const req = buildAIRequest({
    templateBody: template.body, form, effectiveType, clientName, payerName, codesText, reasonText, useNotes: form.ai_use_notes,
  });
  const blocked = req.problems.length > 0;

  async function run() {
    setBusy(true);
    setError('');
    setCheck(null);
    try {
      const result = await improveWording(req, form.ai_style, user);
      const v = validateAILetter(template.body, result.letter);
      if (!v.ok) {
        setError(`The AI answer wasn’t used: ${v.errors.join(' ')} Try again, or keep the template version.`);
      } else {
        set({ ai_body: result.letter, ai_notes: result.notes, letter_text: null });
        setCheck({ warnings: v.warnings });
        setConfirmed(false);
      }
    } catch (e) {
      setError(e.message === 'NO_KEY' ? 'AI wording isn’t set up — an admin can add the AI key in Settings.' : e.message);
    }
    setBusy(false);
  }

  return (
    <Card variant="soft">
      <button type="button" className="ui-disclose" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="ui-disclose-arrow" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="bold">✨ Improve wording with AI</span>
        {form.ai_body && <Badge tone="accent">AI wording in use</Badge>}
      </button>

      {open && (
        <div className="ui-stack" style={{ marginTop: 'var(--ui-s3)' }}>
          <div>
            <Tabs value={form.ai_style} onChange={v => set({ ai_style: v })} label="Letter style"
              options={STYLES.map(s => ({ value: s.value, label: s.label, title: s.hint }))} />
          </div>
          <Check checked={form.ai_use_notes} onChange={e => { set({ ai_use_notes: e.target.checked }); setConfirmed(false); }}>
            Use my “Why we disagree” notes as arguments
          </Check>

          <details className="ui-details">
            <summary>🔍 What AI will see (exactly this, nothing else)</summary>
            <div className="ui-small ui-item">
              <div className="bold">Facts</div>
              {req.facts.map(f => <div key={f.label}>• {f.label}: {f.value}</div>)}
              <div className="bold">Template “{template.name}” (placeholders only)</div>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', fontSize: 11 }}>{template.body}</pre>
              <div className="ui-text-muted">
                Never sent: patient name, date of birth, member ID, claim #, auth #, any dates or other 🔒 fields — only their placeholders.
              </div>
            </div>
          </details>

          {blocked && (
            <Notice tone="bad">
              ⛔ Can’t send — this looks like patient information:
              {req.problems.map(p => <div key={p.label}>• {p.label}: {p.issues.join(', ')}</div>)}
              Remove it (or untick the notes) and try again.
            </Notice>
          )}

          <Check checked={confirmed} disabled={blocked} onChange={e => setConfirmed(e.target.checked)}>
            I confirm there is no patient information in what will be sent.
          </Check>
          <div className="ui-row">
            <Button size="sm" variant="primary" disabled={busy || blocked || !confirmed} onClick={run}>
              {busy ? 'Asking AI…' : form.ai_body ? '✨ Try again' : '✨ Improve wording'}
            </Button>
            {form.ai_body && (
              <Button size="sm" onClick={() => { set({ ai_body: null, ai_notes: '', letter_text: null }); setCheck(null); }}>
                ↺ Use the template version instead
              </Button>
            )}
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          {form.ai_body && form.ai_notes && <div className="ui-muted">AI: {form.ai_notes}</div>}
          {check?.warnings.length > 0 && (
            <Notice tone="warn">
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {check.warnings.map(w => <li key={w}>⚠ {w}</li>)}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </Card>
  );
}
