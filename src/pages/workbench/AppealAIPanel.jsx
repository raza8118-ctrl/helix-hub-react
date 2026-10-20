import { useState } from 'react';
import { STYLES, buildAIRequest, improveWording, validateAILetter } from '../../lib/appealAI';

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
    <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen(o => !o)} role="button" aria-expanded={open}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="bold">✨ Improve wording with AI</span>
        {form.ai_body && <span className="badge badge-blue">AI wording in use</span>}
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {STYLES.map(s => (
              <button key={s.value} type="button" title={s.hint} className={form.ai_style === s.value ? 'btn-primary btn-sm' : 'btn-sm'}
                aria-pressed={form.ai_style === s.value} onClick={() => set({ ai_style: s.value })}>{s.label}</button>
            ))}
          </div>
          <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={form.ai_use_notes} onChange={e => { set({ ai_use_notes: e.target.checked }); setConfirmed(false); }} />
            Use my “Why we disagree” notes as arguments
          </label>

          <details style={{ marginBottom: 6 }}>
            <summary className="text-sm" style={{ cursor: 'pointer' }}>🔍 What AI will see (exactly this, nothing else)</summary>
            <div className="text-sm" style={{ background: 'var(--surface-2)', borderRadius: 6, padding: 8, marginTop: 4 }}>
              <div className="bold">Facts</div>
              {req.facts.map(f => <div key={f.label}>• {f.label}: {f.value}</div>)}
              <div className="bold" style={{ marginTop: 6 }}>Template “{template.name}” (placeholders only)</div>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', fontSize: 11 }}>{template.body}</pre>
              <div className="text-muted" style={{ marginTop: 6 }}>
                Never sent: patient name, date of birth, member ID, claim #, auth #, any dates or other 🔒 fields — only their placeholders.
              </div>
            </div>
          </details>

          {blocked && (
            <div className="text-sm" style={{ color: 'var(--danger)', marginBottom: 6 }}>
              ⛔ Can’t send — this looks like patient information:
              {req.problems.map(p => <div key={p.label}>• {p.label}: {p.issues.join(', ')}</div>)}
              Remove it (or untick the notes) and try again.
            </div>
          )}

          <label className="row text-sm" style={{ gap: 6, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={confirmed} disabled={blocked} onChange={e => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
            I confirm there is no patient information in what will be sent.
          </label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-primary btn-sm" disabled={busy || blocked || !confirmed} onClick={run}>
              {busy ? 'Asking AI…' : form.ai_body ? '✨ Try again' : '✨ Improve wording'}
            </button>
            {form.ai_body && (
              <button className="btn-sm" onClick={() => { set({ ai_body: null, ai_notes: '', letter_text: null }); setCheck(null); }}>
                ↺ Use the template version instead
              </button>
            )}
          </div>
          {error && <div className="text-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
          {form.ai_body && form.ai_notes && <div className="text-sm text-muted" style={{ marginTop: 6 }}>AI: {form.ai_notes}</div>}
          {check?.warnings.length > 0 && (
            <ul className="text-sm" style={{ color: 'var(--warning)', paddingLeft: 18, marginBottom: 0 }}>
              {check.warnings.map(w => <li key={w}>⚠ {w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
