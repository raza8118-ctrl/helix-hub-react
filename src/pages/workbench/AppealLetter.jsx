import { useState, useEffect } from 'react';
import { placeholderMap, levelOf } from '../../lib/appeals';
import { fillTemplate, pickTemplate, templateTypeLabel, levelLabel } from '../../lib/appealTemplates';
import { loadPayerInfo } from '../../lib/denialSteps';
import AppealAIPanel from './AppealAIPanel';
import AppealPdf from './AppealPdf';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';
import { Card, Button, Badge, Check, Notice, Toolbar, EmptyState } from '../../components/ui';

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
 * filled in the same way. 5.4: 📄 Build the PDF (fax cover, cover letter, pre-filled payer form) underneath.
 */
export default function AppealLetter({ form, set, effectiveType, client, payer, matched, templates, user }) {
  const [showTokens, setShowTokens] = useState(false);
  const [info, setInfo] = useState({ key: null, data: null });   // Payer Directory: contacts, limits, forms
  const [infoVersion, setInfoVersion] = useState(0);              // bumped after a form's field map is saved
  const key = payer ? `${payer.id}|${client?.id ?? ''}|${infoVersion}` : null;
  useEffect(() => {
    let alive = true;
    if (payer) loadPayerInfo(payer.id, client?.id ?? null, infoVersion > 0).then(d => { if (alive) setInfo({ key, data: d }); });
    return () => { alive = false; };
  }, [payer, client?.id, key, infoVersion]);
  const payerData = info.key === key ? info.data : null;
  const contact = payerData?.contacts[0] ?? null;

  if (templates === undefined) return null;
  if (templates === null) {
    return (
      <Card>
        <EmptyState icon="📝" title="Letter templates aren’t set up yet.">
          An admin needs to run the appeal templates database update
          (<code>20261021f_appeal_templates.sql</code>) in Supabase.
        </EmptyState>
      </Card>
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
    <Card>
      <Toolbar style={{ marginBottom: 'var(--ui-s3)' }}>
        <span className="ui-card-t">📝 Letter</span>
        {live.length > 0 && (
          <select value={chosen ? String(chosen.id) : ''} onChange={e => set({ template_id: e.target.value, letter_text: null, ai_body: null, ai_notes: '' })} aria-label="Letter template" style={{ maxWidth: 320 }}>
            {live.map(t => (
              <option key={t.id} value={String(t.id)}>
                {t.name}{t.id === best?.id ? ' (best match)' : ''}
              </option>
            ))}
          </select>
        )}
        {chosen && (
          <span className="ui-muted">
            {templateTypeLabel(chosen.denial_type)} · {levelLabel(chosen.level)}{chosen.client_id != null ? ` · ${client?.name ?? 'client'} only` : ''}
          </span>
        )}
      </Toolbar>

      <div className="ui-stack">
        {live.length === 0 && <EmptyState compact title="No letter templates yet — someone with “Manage appeal letter templates” can add them in 📚 Templates." />}

        {chosen && (
          <AppealAIPanel template={chosen} form={form} set={set} effectiveType={effectiveType} user={user}
            clientName={client?.name} payerName={payer?.name} codesText={codesText} reasonText={reasonText} />
        )}
        {chosen && form.ai_body && (
          <details className="ui-details">
            <summary>🔀 Show changes (template vs AI wording, placeholders shown)</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--ui-s2)' }}>
              {[['Template', chosen.body], ['AI wording', form.ai_body]].map(([label, text]) => (
                <div key={label}>
                  <div className="ui-kv-l">{label}</div>
                  <pre className="ui-paper small">{text}</pre>
                </div>
              ))}
            </div>
          </details>
        )}

        {chosen && !edited && (
          <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
            <div className="ui-row">
              <Check inline checked={showTokens} onChange={e => setShowTokens(e.target.checked)}>Show placeholders</Check>
              {filled.missing.length > 0 && (
                <Badge tone="warn">{filled.missing.length} not filled in yet</Badge>
              )}
            </div>
            <div className="ui-paper">
              {filled.lines.map((parts, i) => (
                <div key={i}>
                  {parts.length === 0 ? ' ' : parts.map((p, j) => p.text !== undefined
                    ? <span key={j}>{p.text}</span>
                    : (!p.value || showTokens)
                      ? <mark key={j} className={`ui-token${p.value ? ' filled' : ''}`} title={p.value ? `Filled: ${p.value}` : 'Not filled in yet'}>{p.token}</mark>
                      : <span key={j}>{p.value}</span>)}
                </div>
              ))}
            </div>
          </div>
        )}

        {edited && (
          <Notice tone="info">
            <span className="ui-row">✎ You edited the letter text. <Button size="xs" onClick={rebuild}>↺ Rebuild from the template</Button></span>
          </Notice>
        )}
        {(chosen || edited) && (
          <details className="ui-details" open={edited}>
            <summary>✎ Edit the letter text</summary>
            <textarea rows={16} className="ui-input" value={letterText} onChange={e => set({ letter_text: e.target.value })}
              style={{ fontFamily: "'Times New Roman', serif" }} aria-label="Letter text" />
          </details>
        )}

        {letterText && (
          <div className="ui-row">
            <CopyButton value={letterText} label="📋 Copy letter" title="Copy the letter" />
            <Button size="sm" onClick={() => printLetter(letterText)}>🖨 Print</Button>
            <span className="ui-muted">🔒 Filled in on this computer only — not saved.</span>
          </div>
        )}
      </div>

      <AppealPdf letterText={letterText} values={values} info={payerData} payer={payer} client={client} form={form}
        effectiveType={effectiveType} user={user} onFormsChanged={() => setInfoVersion(v => v + 1)} />
    </Card>
  );
}
