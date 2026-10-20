import { useState, useEffect } from 'react';
import { placeholderMap, levelOf } from '../../lib/appeals';
import { fillTemplate, pickTemplate, templateTypeLabel, levelLabel } from '../../lib/appealTemplates';
import { loadPayerInfo } from '../../lib/denialSteps';
import AppealAIPanel from './AppealAIPanel';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayUS = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; };

// Opens the letter alone in a new window and prints it (nothing is stored)
function printLetter(text) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Appeal letter</title>
<style>body{font:12pt/1.5 'Times New Roman',serif;margin:1in;color:#000}pre{font:inherit;white-space:pre-wrap;margin:0}</style>
</head><body><pre>${esc(text)}</pre></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

/**
 * 📝 Letter (roadmap 5.2): the best template for this appeal, filled in on this computer only.
 * Empty placeholders are highlighted; the letter can be edited (kept in memory with the form), copied or printed.
 * 5.3: optional AI wording (only placeholders + non-identifying facts are sent) replaces the template text and is
 * filled in the same way.
 */
export default function AppealLetter({ form, set, effectiveType, client, payer, matched, templates, user }) {
  const [showTokens, setShowTokens] = useState(false);
  const [info, setInfo] = useState({ key: null, contact: null });
  const key = payer ? `${payer.id}|${client?.id ?? ''}` : null;
  useEffect(() => {
    let alive = true;
    if (payer) loadPayerInfo(payer.id, client?.id ?? null).then(d => { if (alive) setInfo({ key, contact: d.contacts[0] ?? null }); });
    return () => { alive = false; };
  }, [payer, client?.id, key]);
  const contact = info.key === key ? info.contact : null;

  if (templates === undefined) return null;
  if (templates === null) {
    return (
      <div className="card mb-16 text-muted">
        📝 Letter templates aren’t set up yet. An admin needs to run the appeal templates database update
        (<code>20261021f_appeal_templates.sql</code>) in Supabase.
      </div>
    );
  }

  const live = templates.filter(t => t.active !== false);
  const best = pickTemplate(live, { type: effectiveType, level: form.level, clientId: form.client_id });
  const chosen = (form.template_id && live.find(t => String(t.id) === String(form.template_id))) || best;

  // Placeholder values: 5.1 facts + letter frame (date, sender, payer appeals address / fax)
  const codesText = matched.map(m => `${m.parsed.group ? `${m.parsed.group}-` : ''}${m.parsed.code}`).join(', ');
  const reasonText = matched.map(m => m.row?.plain_reason).filter(Boolean).join(' ');
  const values = Object.fromEntries(placeholderMap({ ...form, denial_type: effectiveType }, {
    clientName: client?.name, payerName: payer?.name, codesText, reasonText,
  }).map(r => [r.token, r.value]));
  values['[TODAY]'] = todayUS();
  values['[SENDER_NAME]'] = user.name ?? '';
  values['[PAYER_APPEALS_ADDRESS]'] = contact ? [contact.attention_line, contact.mailing_address].filter(Boolean).join('\n') : '';
  values['[PAYER_APPEALS_FAX]'] = contact?.fax ?? '';
  if (!values['[APPEAL_LEVEL]']) values['[APPEAL_LEVEL]'] = levelOf(form.level).label;

  // 5.3: AI wording (placeholders only) is filled in exactly like the template
  const body = form.ai_body ?? chosen?.body;
  const filled = body ? fillTemplate(body, values) : null;
  const edited = form.letter_text != null;
  const letterText = edited ? form.letter_text : filled?.text ?? '';

  async function rebuild() {
    if (!await confirmDialog({ title: 'Rebuild the letter from the template?', message: 'Your edits to the letter text will be lost.', confirmText: 'Rebuild', tone: 'warning' })) return;
    set({ letter_text: null });
  }

  return (
    <div className="card mb-16">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <span className="card-title">📝 Letter</span>
        {live.length > 0 && (
          <select value={chosen ? String(chosen.id) : ''} onChange={e => set({ template_id: e.target.value, letter_text: null, ai_body: null, ai_notes: '' })} style={{ maxWidth: 320 }}>
            {live.map(t => (
              <option key={t.id} value={String(t.id)}>
                {t.name}{t.id === best?.id ? ' (best match)' : ''}
              </option>
            ))}
          </select>
        )}
        {chosen && (
          <span className="text-sm text-muted">
            {templateTypeLabel(chosen.denial_type)} · {levelLabel(chosen.level)}{chosen.client_id != null ? ` · ${client?.name ?? 'client'} only` : ''}
          </span>
        )}
      </div>

      {live.length === 0 && <div className="text-sm text-muted">No letter templates yet — someone with “Manage appeal letter templates” can add them in 📚 Templates.</div>}

      {chosen && (
        <AppealAIPanel template={chosen} form={form} set={set} effectiveType={effectiveType} user={user}
          clientName={client?.name} payerName={payer?.name} codesText={codesText} reasonText={reasonText} />
      )}
      {chosen && form.ai_body && (
        <details style={{ marginBottom: 8 }}>
          <summary className="text-sm" style={{ cursor: 'pointer' }}>🔀 Show changes (template vs AI wording, placeholders shown)</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, marginTop: 6 }}>
            {[['Template', chosen.body], ['AI wording', form.ai_body]].map(([label, text]) => (
              <div key={label}>
                <div className="text-sm bold">{label}</div>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'Times New Roman', serif", fontSize: 13, margin: 0,
                  border: '1px solid var(--border)', borderRadius: 6, padding: 8, maxHeight: 360, overflowY: 'auto' }}>{text}</pre>
              </div>
            ))}
          </div>
        </details>
      )}

      {chosen && !edited && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showTokens} onChange={e => setShowTokens(e.target.checked)} /> Show placeholders
            </label>
            {filled.missing.length > 0 && (
              <span className="badge badge-yellow">{filled.missing.length} not filled in yet</span>
            )}
          </div>
          <div style={{
            whiteSpace: 'pre-wrap', fontFamily: "'Times New Roman', serif", fontSize: 15, lineHeight: 1.5,
            border: '1px solid var(--border)', borderRadius: 6, padding: 14, background: 'var(--surface)',
          }}>
            {filled.lines.map((parts, i) => (
              <div key={i}>
                {parts.length === 0 ? ' ' : parts.map((p, j) => p.text !== undefined
                  ? <span key={j}>{p.text}</span>
                  : (!p.value || showTokens)
                    ? <mark key={j} title={p.value ? `Filled: ${p.value}` : 'Not filled in yet'}
                        style={{ background: p.value ? 'var(--surface-2)' : '#fef08a', color: 'inherit', padding: '0 2px', borderRadius: 3 }}>{p.token}</mark>
                    : <span key={j}>{p.value}</span>)}
              </div>
            ))}
          </div>
        </>
      )}

      {edited && (
        <div className="text-sm" style={{ marginBottom: 6 }}>
          ✎ You edited the letter text. <button className="btn-sm" onClick={rebuild}>↺ Rebuild from the template</button>
        </div>
      )}
      {(chosen || edited) && (
        <details style={{ marginTop: 8 }} open={edited}>
          <summary className="text-sm" style={{ cursor: 'pointer' }}>✎ Edit the letter text</summary>
          <textarea rows={16} value={letterText} onChange={e => set({ letter_text: e.target.value })}
            style={{ width: '100%', marginTop: 6, fontFamily: "'Times New Roman', serif" }} />
        </details>
      )}

      {letterText && (
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <CopyButton value={letterText} label="📋 Copy letter" title="Copy the letter" />
          <button className="btn-sm" onClick={() => printLetter(letterText)}>🖨 Print</button>
          <span className="text-sm text-muted">🔒 Filled in on this computer only — not saved.</span>
        </div>
      )}
    </div>
  );
}
