import { useState, useEffect, useCallback } from 'react';
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { checkFormFile, uploadPayerForm, payerFormLink, FORM_EXTENSIONS } from '../../lib/payerForms';
import { alertDialog, confirmDialog } from '../../components/shared/Dialog';
import { CardSection, Item, Button, LinkButton, Badge, Notice, Field, FormActions, EmptyState, Modal } from '../../components/ui';
import { VerifiedBadge, ReportWrongInfo } from './PayerAccuracy';

const FORM_TYPES = [
  { value: 'appeal',          label: 'Appeal' },
  { value: 'recon',           label: 'Reconsideration' },
  { value: 'auth',            label: 'Authorization' },
  { value: 'corrected_claim', label: 'Corrected claim' },
  { value: 'other',           label: 'Other' },
];
const typeLabel = v => FORM_TYPES.find(t => t.value === v)?.label ?? v;

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDate = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

// Newest first: latest version date, then latest upload
const newest = (a, b) => String(b.version_date ?? '').localeCompare(String(a.version_date ?? '')) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));

/**
 * Forms section of the payer card (roadmap 1.4). Everyone can download;
 * "Edit Payer Directory" can upload, add new versions, edit details and make inactive.
 * Old versions are always kept.
 */
export default function PayerForms({ payer, user, canEdit, showInactive, plans, names = {}, reports, onReported }) {
  const [rows, setRows]       = useState(undefined);   // undefined = loading, null = table missing
  const [open, setOpen]       = useState({});          // family id → older versions expanded
  const [form, setForm]       = useState(null);        // upload / edit pop-up
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    setRows(await S.get('payer_forms', { payer_id: payer.id }));
  }, [payer.id]);

  useEffect(() => { load(); }, [load]);

  const planName = id => (id == null ? '' : `Plan: ${plans.find(p => p.id === id)?.plan_name ?? 'unknown'}`);

  // Group every version under its first upload
  const families = Object.values((rows ?? []).reduce((acc, r) => {
    const fam = r.family_id ?? r.id;
    (acc[fam] ??= []).push(r);
    return acc;
  }, {})).map(versions => {
    const sorted = [...versions].sort(newest);
    const latest = sorted.find(v => !v.superseded_at) ?? sorted[0];
    return { id: latest.family_id ?? latest.id, latest, older: sorted.filter(v => v !== latest) };
  })
    .filter(f => showInactive || f.latest.active !== false)
    .sort((a, b) => FORM_TYPES.findIndex(t => t.value === a.latest.form_type) - FORM_TYPES.findIndex(t => t.value === b.latest.form_type)
      || (a.latest.title ?? '').localeCompare(b.latest.title ?? ''));

  async function download(r) {
    if (!r.file_path) return;
    const url = await payerFormLink(r.file_path, r.file_name);
    if (!url) {
      await alertDialog({ title: 'Download failed', message: 'The file could not be opened. Please try again, or ask an admin to check the payer forms storage setup.', tone: 'danger' });
      return;
    }
    // The signed link is sent as a download, so following it saves the file without leaving the page
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openUpload(family = null) {
    const base = family?.latest;
    setForm({
      mode: family ? 'version' : 'new',
      family,
      form_type: base?.form_type ?? 'appeal',
      title: base?.title ?? '',
      plan_id: base?.plan_id != null ? String(base.plan_id) : '',
      version_date: localToday(),
      notes: '',
      file: null,
      error: '',
    });
  }

  function openEditDetails(r) {
    setForm({
      mode: 'edit', row: r,
      form_type: r.form_type ?? 'other', title: r.title ?? '',
      plan_id: r.plan_id != null ? String(r.plan_id) : '',
      version_date: r.version_date ?? '', notes: r.notes ?? '', error: '',
    });
  }
  const setF = patch => setForm(f => ({ ...f, ...patch, error: '' }));

  async function save() {
    const title = form.title.trim();
    if (!title) return setForm(f => ({ ...f, error: 'Enter a title, e.g. “Provider appeal form”.' }));
    const now = new Date().toISOString();
    const details = {
      form_type: form.form_type, title,
      plan_id: form.plan_id === '' ? null : Number(form.plan_id),
      version_date: form.version_date || null,
      notes: form.notes.trim() || null,
      updated_by: user.emp_id, updated_at: now,
    };

    if (form.mode === 'edit') {
      if (!await confirmDialog({ title: 'Save changes?', message: `${payer.name} → ${title}`, confirmText: 'Save Changes' })) return;
      setSaving(true);
      const ok = await S.update('payer_forms', details, { id: form.row.id });
      setSaving(false);
      if (!ok?.length) return setForm(f => ({ ...f, error: 'Could not save. Please try again.' }));
      logAudit({ actor: user, action: 'edit_payer_info', entityType: 'payer_form', entityId: form.row.id, details: { payer: payer.name, payer_id: payer.id, section: 'Forms', title } });
      setForm(null);
      return load();
    }

    const fileProblem = checkFormFile(form.file);
    if (fileProblem) return setForm(f => ({ ...f, error: fileProblem }));
    const isVersion = form.mode === 'version';
    if (!await confirmDialog({
      title: isVersion ? 'Upload a new version?' : 'Upload this form?',
      message: `${payer.name} → ${title}\nBlank forms only — no patient documents.${isVersion ? '\n\nThe current version will be kept under “Older versions”.' : ''}`,
      confirmText: 'Upload',
    })) return;

    setSaving(true);
    const path = await uploadPayerForm(payer.id, form.file);
    if (!path) {
      setSaving(false);
      return setForm(f => ({ ...f, error: 'Upload failed. The payer forms storage may not be set up yet — ask an admin.' }));
    }
    const familyId = isVersion ? (form.family.latest.family_id ?? form.family.latest.id) : null;
    const result = await S.set('payer_forms', {
      ...details, payer_id: payer.id, file_path: path, file_name: form.file.name,
      family_id: familyId, active: true, created_by: user.emp_id,
      verified_at: now, verified_by: user.emp_id,   // a freshly uploaded form counts as checked today
    });
    if (result?.length && isVersion) {
      await S.update('payer_forms', { superseded_at: now, updated_by: user.emp_id, updated_at: now }, { id: form.family.latest.id });
    }
    setSaving(false);
    if (!result?.length) return setForm(f => ({ ...f, error: 'The file uploaded but its details could not be saved. Please try again.' }));
    logAudit({
      actor: user, action: isVersion ? 'upload_payer_form_version' : 'upload_payer_form',
      entityType: 'payer_form', entityId: result[0].id,
      details: { payer: payer.name, payer_id: payer.id, form_type: form.form_type, title },
    });
    setForm(null);
    await load();
  }

  async function markVerified(r) {
    if (!await confirmDialog({
      title: 'Mark as verified?',
      message: `${payer.name} → ${r.title}\n\nConfirm this is still the payer’s current version of the form.`,
      confirmText: 'Mark Verified',
    })) return;
    const ok = await S.update('payer_forms', { verified_at: new Date().toISOString(), verified_by: user.emp_id }, { id: r.id });
    if (!ok) return;
    logAudit({
      actor: user, action: 'verify_payer_info', entityType: 'payer_form', entityId: r.id,
      details: { payer: payer.name, payer_id: payer.id, section: 'Forms', title: r.title },
    });
    await load();
  }

  const openReportsFor = id => (reports ?? []).filter(x => x.status === 'open' && x.entity_table === 'payer_forms' && x.entity_id === id).length;

  async function toggleActive(r) {
    const deactivating = r.active !== false;
    if (!await confirmDialog(deactivating
      ? { title: 'Make this form inactive?', message: 'It will be hidden from the payer card. The file and its versions are kept.', tone: 'warning', confirmText: 'Make Inactive' }
      : { title: 'Reactivate this form?', message: 'It will show on the payer card again.', confirmText: 'Reactivate' })) return;
    const ok = await S.update('payer_forms', { active: !deactivating, updated_by: user.emp_id, updated_at: new Date().toISOString() }, { id: r.id });
    if (!ok) return;
    logAudit({
      actor: user, action: deactivating ? 'deactivate_payer_info' : 'activate_payer_info',
      entityType: 'payer_form', entityId: r.id, details: { payer: payer.name, payer_id: payer.id, section: 'Forms', title: r.title },
    });
    await load();
  }

  return (
    <CardSection icon="📄" title="Forms"
      actions={canEdit && rows != null && <Button size="sm" onClick={() => openUpload()}>⬆ Upload Form</Button>}>
      {rows === undefined && <EmptyState compact title="Loading forms…" />}
      {rows === null && <EmptyState compact title="Not set up yet." />}
      {rows != null && families.length === 0 && (
        <EmptyState compact title={`No forms yet${canEdit ? ' — click “⬆ Upload Form”.' : '.'}`} />
      )}

      <div className="ui-grid">
        {families.map(({ id, latest, older }) => (
          <Item key={id} dim={latest.active === false}>
            <div>
              <div className="ui-item-t">
                {latest.title}{latest.active === false && <Badge tone="bad" style={{ marginLeft: 6 }}>Inactive</Badge>}
              </div>
              <div className="ui-muted">
                {[typeLabel(latest.form_type), `Version ${fmtDate(latest.version_date)}`, planName(latest.plan_id)].filter(Boolean).join(' · ')}
              </div>
            </div>
            {latest.notes && <div className="ui-kv-v">{latest.notes}</div>}
            <div>
              <Button variant="primary" size="sm" onClick={() => download(latest)} disabled={!latest.file_path}>
                ⬇ Download
              </Button>
            </div>

            {older.length > 0 && (
              <div>
                <LinkButton onClick={() => setOpen(o => ({ ...o, [id]: !o[id] }))}>
                  {open[id] ? '▾' : '▸'} Older versions ({older.length})
                </LinkButton>
                {open[id] && (
                  <div className="ui-stack" style={{ gap: 4, marginTop: 4 }}>
                    {older.map(v => (
                      <div key={v.id} className="ui-row" style={{ justifyContent: 'space-between' }}>
                        <span className="ui-muted">Version {fmtDate(v.version_date)}</span>
                        <Button size="xs" onClick={() => download(v)} disabled={!v.file_path} aria-label="Download this version">⬇</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="ui-item-foot">
              <VerifiedBadge row={latest} names={names} />
              {openReportsFor(latest.id) > 0 && (
                <span><Badge tone="warn">
                  🚩 {openReportsFor(latest.id)} open report{openReportsFor(latest.id) > 1 ? 's' : ''}
                </Badge></span>
              )}
              {reports != null && (
                <div>
                  <ReportWrongInfo payer={payer} section="Forms" table="payer_forms" entityId={latest.id}
                    entityTitle={latest.title} user={user} onReported={onReported} />
                </div>
              )}
            </div>

            {canEdit && (
              <div className="ui-row" style={{ gap: 4 }}>
                <Button size="xs" onClick={() => markVerified(latest)}>✓ Mark verified</Button>
                <Button size="xs" onClick={() => openUpload({ latest })}>⬆ New Version</Button>
                <Button size="xs" onClick={() => openEditDetails(latest)}>Edit</Button>
                <Button size="xs" variant={latest.active !== false ? 'danger' : 'success'} onClick={() => toggleActive(latest)}>
                  {latest.active !== false ? 'Make Inactive' : 'Reactivate'}
                </Button>
              </div>
            )}
          </Item>
        ))}
      </div>

      {form && (
        <Modal
          title={form.mode === 'edit' ? `Edit form — ${payer.name}` : form.mode === 'version' ? `New version — ${form.title}` : `Upload form — ${payer.name}`}
          onClose={() => setForm(null)}
        >
          <div>
            <Field label="Form type">
              <select value={form.form_type} disabled={form.mode === 'version'} onChange={e => setF({ form_type: e.target.value })}>
                {FORM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Title" required>
              <input type="text" value={form.title} disabled={form.mode === 'version'} placeholder="e.g. Provider appeal form"
                onChange={e => setF({ title: e.target.value })} />
            </Field>
            <Field label="Applies to">
              <select value={form.plan_id} onChange={e => setF({ plan_id: e.target.value })}>
                <option value="">Whole payer (all plans)</option>
                {plans.map(p => <option key={p.id} value={String(p.id)}>{p.plan_name}</option>)}
              </select>
            </Field>
            <Field label="Version date (date printed on the form or when it was published)">
              <input type="date" value={form.version_date} onChange={e => setF({ version_date: e.target.value })} />
            </Field>
            {form.mode !== 'edit' && (
              <Field label="File * (PDF, Word or Excel, up to 10 MB)">
                <input type="file" accept={FORM_EXTENSIONS.map(x => `.${x}`).join(',')}
                  onChange={e => setF({ file: e.target.files?.[0] ?? null })} />
                <Notice tone="warn">⚠ Blank forms only — never upload a form that contains patient information.</Notice>
              </Field>
            )}
            <Field label="Notes (optional)">
              <textarea rows={2} value={form.notes} onChange={e => setF({ notes: e.target.value })}
                placeholder="e.g. Must be faxed with the EOB attached" />
            </Field>
            {form.error && <Notice tone="bad">{form.error}</Notice>}
            <FormActions>
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : form.mode === 'edit' ? 'Save Changes' : 'Upload'}
              </Button>
            </FormActions>
          </div>
        </Modal>
      )}
    </CardSection>
  );
}
