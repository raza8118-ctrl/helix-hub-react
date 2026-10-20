import { useState, useRef } from 'react';
import {
  ACTIONS, DATE_STYLES, NOTE_TOKENS, SAMPLE_NOTE_VALUES, actionOf, buildNote, checkFormat, saveFormat, reviewFormat,
  setFormatActive, missingStarterFormats, addStarterFormats,
} from '../../lib/claimNotes';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Add / edit one note format: placeholder picker, options, live preview with made-up values, checks
function FormatEditor({ format, copyOf, clients, user, onClose, onSaved }) {
  const src = format ?? copyOf;
  const [v, setV] = useState({
    name: format ? format.name : copyOf ? `${copyOf.name} (copy)` : '',
    client_id: src?.client_id ? String(src.client_id) : '', action: src?.action ?? 'any', body: src?.body ?? '',
    date_style: src?.date_style ?? 'mdy2', upper_case: src?.upper_case ?? false,
    max_length: src?.max_length ? String(src.max_length) : '', name_style: src?.name_style ?? 'initials',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);
  const set = patch => { setV(x => ({ ...x, ...patch })); setError(''); };
  const warnings = checkFormat(v.body);
  const sample = { ...SAMPLE_NOTE_VALUES, '{USER}': v.name_style === 'full' ? 'Alex Example' : 'AE',
    '{DATE}': v.date_style === 'iso' ? '2026-10-20' : v.date_style === 'mdy4' ? '10/20/2026' : '10/20/26' };
  const preview = buildNote(v.body, sample, { upperCase: v.upper_case });
  const max = Number(v.max_length) || 0;

  function insert(token) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? v.body.length;
    const end = el?.selectionEnd ?? v.body.length;
    set({ body: v.body.slice(0, start) + token + v.body.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  }

  async function save() {
    if (!v.name.trim()) return setError('Please give the format a name.');
    if (!v.body.trim()) return setError('The note text is empty.');
    if (warnings.length && !await confirmDialog({ title: 'Save with warnings?', message: warnings.join(' '), confirmText: 'Save Anyway', tone: 'warning' })) return;
    setSaving(true);
    const row = await saveFormat(format, {
      name: v.name.trim(), client_id: v.client_id ? Number(v.client_id) : null, action: v.action, body: v.body.trim(),
      date_style: v.date_style, upper_case: v.upper_case, max_length: max || null, name_style: v.name_style,
    }, user);
    setSaving(false);
    if (!row) return setError('Could not save. Please try again.');
    onSaved();
  }

  return (
    <Modal title={format ? `Edit note format — ${format.name}` : 'New note format'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm" style={{ marginTop: 0, padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)' }}>
          🔒 Placeholders only — never patient details. Put optional parts in <b>[ ]</b>: they’re left out when their
          placeholder is empty, e.g. <code>[, ref# {'{REF}'}]</code>.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 220px' }}><label>Name *</label>
            <input type="text" value={v.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. ABC Home Health – calls" />
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}><label>Client</label>
            <select value={v.client_id} onChange={e => set({ client_id: e.target.value })}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name} only</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}><label>Action</label>
            <select value={v.action} onChange={e => set({ action: e.target.value })}>
              <option value="any">Any action</option>
              {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Date style</label>
            <select value={v.date_style} onChange={e => set({ date_style: e.target.value })}>
              {DATE_STYLES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Your name as</label>
            <select value={v.name_style} onChange={e => set({ name_style: e.target.value })}>
              <option value="initials">Initials</option>
              <option value="full">Full name</option>
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}><label>Max length (EMR limit)</label>
            <input type="number" min={0} value={v.max_length} placeholder="none" onChange={e => set({ max_length: e.target.value })} />
          </div>
          <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', alignSelf: 'center' }}>
            <input type="checkbox" checked={v.upper_case} onChange={e => set({ upper_case: e.target.checked })} /> ALL CAPS
          </label>
        </div>
        <div className="field">
          <label>Insert a placeholder</label>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {NOTE_TOKENS.map(t => <button key={t.token} type="button" className="btn-sm" title={t.label} onClick={() => insert(t.token)}>{t.label}</button>)}
          </div>
        </div>
        <div className="field">
          <label>Note text *</label>
          <textarea ref={bodyRef} rows={4} value={v.body} onChange={e => set({ body: e.target.value })} style={{ fontFamily: 'monospace', fontSize: 12 }}
            placeholder="{DATE} {USER} - Called {PAYER}[, ref# {REF}]. Claim {STATUS}[ - {STATUS_DETAILS}]." />
        </div>
        <div className="text-sm bold">Preview with made-up values</div>
        <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, overflowWrap: 'anywhere' }}>
          {preview || <span className="text-muted">Nothing yet.</span>}
        </div>
        <div className="text-sm text-muted" style={{ color: max && preview.length > max ? 'var(--danger)' : undefined }}>
          {preview.length}{max ? ` / ${max}` : ''} characters
        </div>
        {warnings.length > 0 && <ul className="text-sm" style={{ color: 'var(--warning)', paddingLeft: 18 }}>{warnings.map(w => <li key={w}>⚠ {w}</li>)}</ul>}
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : format ? 'Save Changes' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** 📚 Note formats (roadmap 6.1): each client's claim note format, for holders of “Manage claim note formats”. */
export default function NoteFormats({ formats, clients, user, onChanged }) {
  const [editor, setEditor] = useState(null);   // { format?, copyOf? }
  const [showInactive, setShowInactive] = useState(false);
  const missing = missingStarterFormats(formats);
  const shown = formats.filter(f => showInactive || f.active !== false);
  const clientName = id => clients.find(c => c.id === id)?.name ?? `Client #${id}`;
  const groups = [{ id: null, name: 'All clients' }, ...clients.filter(c => shown.some(f => f.client_id === c.id))];

  async function addStarters() {
    if (!await confirmDialog({ title: `Add ${missing.length} standard formats?`, message: missing.map(s => s.name).join(', '), confirmText: 'Add' })) return;
    if (await addStarterFormats(missing, user)) onChanged();
  }
  async function review(f) {
    if (await confirmDialog({ title: 'Mark this format as reviewed?', message: f.name, confirmText: 'Mark Reviewed' }) && await reviewFormat(f, user)) onChanged();
  }
  async function toggle(f) {
    const off = f.active !== false;
    if (!await confirmDialog(off
      ? { title: 'Make this format inactive?', message: f.name, confirmText: 'Make Inactive', tone: 'warning' }
      : { title: 'Reactivate this format?', message: f.name, confirmText: 'Reactivate' })) return;
    if (await setFormatActive(f, !off, user)) onChanged();
  }

  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-primary btn-sm" onClick={() => setEditor({})}>+ New format</button>
        {missing.length > 0 && <button className="btn-sm" onClick={addStarters}>Add standard formats ({missing.length})</button>}
        <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      {shown.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>No note formats yet.</div>}
      {groups.map(g => {
        const list = shown.filter(f => (f.client_id ?? null) === g.id);
        if (!list.length) return null;
        return (
          <div key={g.id ?? 'all'} className="card mb-16">
            <div className="card-title" style={{ marginBottom: 6 }}>{g.id == null ? 'All clients' : clientName(g.id)}</div>
            {list.map(f => (
              <div key={f.id} style={{ padding: '6px 0', borderTop: '1px solid var(--border)', opacity: f.active === false ? 0.6 : 1 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="bold">{f.name}</span>
                  <span className="badge badge-gray">{f.action === 'any' ? 'Any action' : actionOf(f.action).label}</span>
                  {f.max_length ? <span className="badge badge-gray">max {f.max_length}</span> : null}
                  {f.source === 'starter' && !f.reviewed_at && <span className="badge badge-yellow">Standard – please review</span>}
                  {f.reviewed_at && <span className="text-sm text-muted">reviewed {fmtDate(f.reviewed_at)}</span>}
                  {f.active === false && <span className="badge badge-gray">Inactive</span>}
                  <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                    {!f.reviewed_at && f.active !== false && <button className="btn-sm" onClick={() => review(f)}>✓ Reviewed</button>}
                    {f.active !== false && <button className="btn-sm" title="Edit" onClick={() => setEditor({ format: f })}>✎</button>}
                    <button className="btn-sm" onClick={() => setEditor({ copyOf: f })}>Copy</button>
                    <button className="btn-sm" title={f.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => toggle(f)}>{f.active === false ? '↺' : '⊘'}</button>
                  </span>
                </div>
                <div className="text-sm text-muted" style={{ fontFamily: 'monospace', marginTop: 2, overflowWrap: 'anywhere' }}>{f.body}</div>
              </div>
            ))}
          </div>
        );
      })}

      {editor && (
        <FormatEditor format={editor.format} copyOf={editor.copyOf} clients={clients} user={user}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />
      )}
    </div>
  );
}
