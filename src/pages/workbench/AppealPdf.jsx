import { useState, useEffect } from 'react';
import { kv } from '../../lib/supabase';
import { hasAccess } from '../../lib/access';
import { levelOf } from '../../lib/appeals';
import { buildAppealPdf, listFormFields } from '../../lib/appealPdf';
import { loadPayerFormBytes, hasFieldMaps } from '../../lib/payerForms';
import { fromKeyOf, computeDeadline, fmtDue } from '../../lib/deadlines';
import { applyNaming, DEFAULT_NAMING } from '../../lib/packet';
import PdfSaveOptions from './PdfSaveOptions';
import FormFieldMapper from './FormFieldMapper';
import CopyButton from '../../components/shared/CopyButton';

const FORM_TYPES = { appeal: 'Appeal form', recon: 'Reconsideration form', corrected_claim: 'Corrected claim form' };
const SOON = 3;

/**
 * 📄 Build the PDF (roadmap 5.4): fax cover sheet (no patient details) + cover letter + payer form (pre-filled when it
 * has a field map), a deadline check before saving, then the shared Original / Compress save step.
 * Everything happens in the browser — the PDF is never uploaded, saved or logged.
 */
export default function AppealPdf({ letterText, values, info, payer, client, form, effectiveType, user, onFormsChanged }) {
  const contact = info?.contacts[0] ?? null;
  const forms = info?.forms ?? [];
  const [coverOn, setCoverOn] = useState(null);          // null = automatic (on when there is an appeals fax)
  const [letterOn, setLetterOn] = useState(true);
  const [formId, setFormId] = useState('');
  const [flatten, setFlatten] = useState(true);
  const [loaded, setLoaded] = useState({ id: null, bytes: null, fields: null, error: '' });
  const [mapping, setMapping] = useState(false);
  const [convention, setConvention] = useState(DEFAULT_NAMING);
  const [nameOverride, setNameOverride] = useState(null);
  const [acked, setAcked] = useState(false);

  useEffect(() => {
    let alive = true;
    kv.get('packet_naming').then(v => { if (alive && v) setConvention(v); });
    return () => { alive = false; };
  }, []);

  const payerForm = forms.find(f => String(f.id) === formId) ?? null;
  useEffect(() => {
    let alive = true;
    if (payerForm) {
      loadPayerFormBytes(payerForm.file_path).then(async bytes => {
        if (!alive) return;
        if (!bytes) return setLoaded({ id: payerForm.id, bytes: null, fields: null, error: 'The form file couldn’t be loaded.' });
        const isPdf = /\.pdf$/i.test(payerForm.file_name ?? payerForm.file_path);
        const r = isPdf ? await listFormFields(bytes) : { error: 'Only PDF forms can be added — this one is a Word / Excel file.' };
        if (alive) setLoaded({ id: payerForm.id, bytes: r.error ? null : bytes, fields: r.fields ?? null, error: r.error ?? '' });
      });
    }
    return () => { alive = false; };
  }, [payerForm]);
  const formData = payerForm && loaded.id === payerForm.id ? loaded : null;
  const fillable = !!formData?.fields?.length;
  const mapReady = payerForm && hasFieldMaps(payerForm);
  const mapped = fillable && mapReady && Object.keys(payerForm.field_map ?? {}).length > 0;

  const cover = coverOn ?? !!contact?.fax;
  const anything = (letterOn && letterText?.trim()) || formData?.bytes;

  // Deadline for the chosen appeal level
  const want = levelOf(form.level).limit;
  const limit = info?.limits.find(l => l.limit_type === want.type && (want.level == null || (l.level ?? 1) === want.level));
  const result = limit?.days != null
    ? computeDeadline({ days: limit.days, fromKey: fromKeyOf(limit.measured_from).key, receiptDays: 0 }, { denial: form.denial_date, dos: form.dos_to || form.dos_from, discharge: '', paid: '' })
    : null;
  const status = !result ? 'unknown' : result.daysLeft < 0 ? 'late' : result.daysLeft <= SOON ? 'soon' : 'ok';
  const needsAck = status === 'late' || status === 'soon';

  const autoName = applyNaming(convention, {
    claimNo: form.claim_number, payer: payer?.name, client: client?.name, type: levelOf(form.level).label,
    dos: form.dos_from, patientLast: (form.patient_name ?? '').trim().split(/\s+/).pop(),
  });
  const fileName = nameOverride ?? autoName;
  const ctx = { level: form.level, type: effectiveType };

  const build = () => buildAppealPdf({
    letterText: letterOn ? letterText : '',
    form: formData?.bytes ? { bytes: formData.bytes, fieldMap: mapped ? payerForm.field_map : null, flatten } : null,
    values, ctx,
    cover: cover ? { toName: payer?.name, toFax: contact?.fax, toPhone: contact?.phone, fromName: user.name, fromClient: client?.name } : null,
  });
  const resetKey = JSON.stringify([cover, letterOn, letterText, formId, formData?.id, flatten, mapped, fileName, values]);

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>📄 Build the PDF</div>

      <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }} title={contact?.fax ? '' : 'No appeals fax recorded for this payer'}>
          <input type="checkbox" checked={cover} onChange={e => setCoverOn(e.target.checked)} /> Fax cover sheet
        </label>
        <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={letterOn} disabled={!letterText?.trim()} onChange={e => setLetterOn(e.target.checked)} /> Cover letter
        </label>
      </div>
      {cover && <div className="text-sm text-muted" style={{ marginBottom: 8 }}>The fax cover sheet shows the payer, fax, sender and page count only — no patient details.</div>}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <span className="text-sm">Payer form:</span>
        <select value={formId} onChange={e => { setFormId(e.target.value); setAcked(false); }} style={{ maxWidth: 320 }}>
          <option value="">— None —</option>
          {forms.map(f => <option key={f.id} value={String(f.id)}>{f.title} ({FORM_TYPES[f.form_type] ?? f.form_type})</option>)}
        </select>
        {!payer && <span className="text-sm text-muted">Pick a payer to see its forms.</span>}
        {payer && !forms.length && <span className="text-sm text-muted">No appeal forms recorded for {payer.name}.</span>}
      </div>
      {payerForm && !formData && <div className="text-sm text-muted">Loading the form…</div>}
      {formData?.error && <div className="text-sm" style={{ color: 'var(--danger)' }}>{formData.error}</div>}
      {formData?.bytes && (
        <div className="text-sm" style={{ marginBottom: 8 }}>
          {!fillable && '📝 This form isn’t fillable — it’s added as-is. Fill it in by hand (or print, fill and scan).'}
          {fillable && mapped && <>✅ Pre-filled from this appeal ({Object.keys(payerForm.field_map).length} mapped fields). </>}
          {fillable && !mapped && <>This form has {formData.fields.length} fillable fields but no field map yet — it’s added empty. </>}
          {fillable && !mapReady && <span className="text-muted">(Field maps need the payer form fields database update — <code>20261021g_payer_form_fields.sql</code>.)</span>}
          {fillable && mapReady && hasAccess(user, 'payers_edit') && (
            <button className="btn-sm" onClick={() => setMapping(true)}>🧩 {mapped ? 'Edit' : 'Map'} form fields</button>
          )}
          {fillable && mapped && (
            <label className="row" style={{ gap: 4, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={flatten} onChange={e => setFlatten(e.target.checked)} /> Flatten (filled values can’t be changed in the PDF)
            </label>
          )}
        </div>
      )}

      {contact && (
        <div className="text-sm" style={{ marginBottom: 8 }}>
          <b>Send to:</b> {payer?.name} appeals
          {contact.fax && <> · Fax {contact.fax} <CopyButton value={contact.fax} /></>}
          {contact.mailing_address && <> · <CopyButton value={[contact.attention_line, contact.mailing_address].filter(Boolean).join('\n')} label="Copy address" /></>}
          {contact.portal_url && <> · <a href={contact.portal_url} target="_blank" rel="noopener noreferrer">Portal ↗</a></>}
        </div>
      )}

      <div className="text-sm" style={{
        padding: '6px 10px', borderRadius: 6, marginBottom: 8,
        background: status === 'late' ? 'rgba(239,68,68,0.12)' : status === 'soon' ? 'rgba(245,158,11,0.15)' : 'var(--surface-2)',
      }}>
        {status === 'unknown' && '⏰ Deadline not checked — no limit recorded for this payer and appeal level, or no denial date entered.'}
        {status === 'ok' && <>⏰ Deadline {fmtDue(result.due)} — {result.daysLeft} days left.</>}
        {status === 'soon' && <>🟠 Deadline {fmtDue(result.due)} — {result.daysLeft === 0 ? 'due today' : `only ${result.daysLeft} day${result.daysLeft === 1 ? '' : 's'} left`}. Send it today.</>}
        {status === 'late' && <>🔴 The deadline was {fmtDue(result.due)} — {-result.daysLeft} days ago. Check whether the payer accepts late appeals with good cause before sending.</>}
        {needsAck && (
          <label className="row" style={{ gap: 4, cursor: 'pointer', marginTop: 4 }}>
            <input type="checkbox" checked={acked} onChange={e => setAcked(e.target.checked)} /> I understand — build the PDF anyway
          </label>
        )}
      </div>

      <div className="field" style={{ maxWidth: 520 }}>
        <label>File name</label>
        <input type="text" value={fileName} onChange={e => setNameOverride(e.target.value)} />
        {nameOverride != null && <button type="button" className="btn-sm" style={{ marginTop: 4 }} onClick={() => setNameOverride(null)}>↺ Use the naming convention</button>}
      </div>

      {!anything && <div className="text-sm text-muted">Tick the cover letter or pick a payer form to build a PDF.</div>}
      {anything && (!needsAck || acked) && (
        <PdfSaveOptions outputs={[{ name: /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`, build }]} resetKey={resetKey} user={user}
          auditAction="appeal_pdf_built"
          auditDetails={{ fax_cover: cover, letter: letterOn && !!letterText?.trim(), form: !!formData?.bytes, prefilled: !!mapped, flatten: !!(mapped && flatten), deadline: status }} />
      )}

      {mapping && formData?.fields && (
        <FormFieldMapper payerForm={payerForm} bytes={formData.bytes} fields={formData.fields} user={user}
          onClose={() => setMapping(false)} onSaved={() => { setMapping(false); onFormsChanged(); }} />
      )}
    </div>
  );
}
