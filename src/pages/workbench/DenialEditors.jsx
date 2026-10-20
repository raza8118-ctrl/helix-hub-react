import { useState } from 'react';
import {
  CODE_TYPES, CATEGORIES, typeOf, saveCode, readImportFile, compareImport, applyImport,
  missingStarterCodes, addStarterCodes,
} from '../../lib/denials';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

/** Add / edit one denial code (roadmap 4.1). */
export function DenialCodeModal({ codes, row, presetCode, user, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    code_type: row?.code_type ?? presetCode?.type ?? 'carc',
    code: row?.code ?? presetCode?.code ?? '',
    plain_reason: row?.plain_reason ?? '',
    category: row?.category ?? '',
    official_text: row?.official_text ?? '',
    notes: row?.notes ?? '',
    stopped_on: row?.stopped_on ?? '',
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = patch => { setV(x => ({ ...x, ...patch })); setError(''); };

  async function save() {
    if (!v.code.trim()) return setError('Please enter the code.');
    if (!v.plain_reason.trim()) return setError('Please write the plain-English reason.');
    setSaving(true);
    const result = await saveCode(codes, row, {
      code_type: v.code_type, code: v.code, plain_reason: v.plain_reason.trim(), category: v.category || null,
      official_text: v.official_text.trim() || null, notes: v.notes.trim() || null, stopped_on: v.stopped_on || null,
    }, user);
    setSaving(false);
    if (result.error) return setError(result.error);
    onSaved(result);
  }

  return (
    <Modal title={row ? `Edit ${typeOf(row.code_type).label} ${row.code}` : 'Add denial code'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label>Type</label>
            <select value={v.code_type} onChange={e => set({ code_type: e.target.value })}>
              {CODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label} — {t.long}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}>
            <label>Code *</label>
            <input type="text" value={v.code} placeholder="e.g. 16, N290, CO" onChange={e => set({ code: e.target.value })} />
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label>Category</label>
            <select value={v.category} onChange={e => set({ category: e.target.value })}>
              <option value="">— Choose —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Plain-English reason *</label>
          <textarea rows={3} value={v.plain_reason} onChange={e => set({ plain_reason: e.target.value })}
            placeholder="What it means for the AR caller, in simple words, and what to check first" />
        </div>
        <div className="field">
          <label>Official description (X12)</label>
          <textarea rows={2} value={v.official_text} onChange={e => set({ official_text: e.target.value })}
            placeholder="Usually filled by importing the official list" />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 260px' }}>
            <label>Notes</label>
            <input type="text" value={v.notes} onChange={e => set({ notes: e.target.value })} placeholder="Optional" />
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label>No longer used after</label>
            <input type="date" value={v.stopped_on} onChange={e => set({ stopped_on: e.target.value })} />
          </div>
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>🔒 No patient information here.</p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save Changes' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Import an official X12 list from Excel / CSV with a preview (roadmap 4.1). Never touches plain-English reasons. */
export function DenialImportModal({ codes, user, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [read, setRead] = useState(null);           // { rows, hasType } or { error }
  const [defaultType, setDefaultType] = useState('carc');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  async function pick(f) {
    setFile(f);
    setRead(null);
    setDone(null);
    if (!f) return;
    setBusy(true);
    try {
      setRead(await readImportFile(f));
    } catch {
      setRead({ error: 'This file couldn’t be read. Please save it as .xlsx or .csv.' });
    }
    setBusy(false);
  }

  const diff = read?.rows ? compareImport(codes, read.rows, read.hasType ? null : defaultType) : null;

  async function save() {
    const total = diff.added.length + diff.changed.length;
    if (!await confirmDialog({
      title: 'Import these codes?',
      message: `${diff.added.length} new and ${diff.changed.length} updated (official wording / retired dates only). Plain-English reasons are not changed.`,
      confirmText: `Import ${total}`,
    })) return;
    setBusy(true);
    const result = await applyImport(diff, user);
    setBusy(false);
    setDone(result);
  }

  return (
    <Modal title="Import official code list" onClose={done ? onSaved : onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          Download the official CARC or RARC list from <b>x12.org</b> (Codes → Claim Adjustment Reason Codes / Remittance
          Advice Remark Codes), save it as Excel or CSV with a <b>Code</b> and a <b>Description</b> column, and pick it here.
          Only the official wording and retired dates are updated — your plain-English reasons are never changed.
        </p>
        {!done && (
          <>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e => pick(e.target.files?.[0] ?? null)} />
            {busy && <div className="text-sm text-muted" style={{ marginTop: 8 }}>Working…</div>}
            {read?.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{read.error}</p>}
            {read?.rows && !read.hasType && (
              <div className="field" style={{ marginTop: 10 }}>
                <label>What list is this?</label>
                <select value={defaultType} onChange={e => setDefaultType(e.target.value)} style={{ maxWidth: 320 }}>
                  {CODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label} — {t.long}</option>)}
                </select>
              </div>
            )}
            {diff && (
              <div className="card" style={{ marginTop: 10, background: 'var(--surface-2)' }}>
                <div className="bold">{file?.name}: {read.rows.length} rows</div>
                <div className="text-sm" style={{ marginTop: 4 }}>
                  <span className="badge badge-green">{diff.added.length} new</span>{' '}
                  <span className="badge badge-blue">{diff.changed.length} changed</span>{' '}
                  <span className="badge badge-gray">{diff.same} unchanged</span>
                  {diff.skipped > 0 && <> <span className="badge badge-orange">{diff.skipped} skipped (repeated / no type)</span></>}
                </div>
                {[...diff.added.slice(0, 5).map(r => ({ r, k: 'New' })), ...diff.changed.slice(0, 5).map(c => ({ r: c.row, k: 'Changed' }))].map(({ r, k }) => (
                  <div key={`${k}-${r.code_type}-${r.code}`} className="text-sm" style={{ marginTop: 4 }}>
                    <b>{k}</b> · {typeOf(r.code_type).label} {r.code}: <span className="text-muted">{(r.official_text ?? '').slice(0, 120)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {done && (
          <p className="text-sm">✓ Imported: {done.added} new, {done.updated} updated.</p>
        )}
        <div className="form-actions">
          {done
            ? <button className="btn-primary" onClick={onSaved}>Done</button>
            : (
              <>
                <button className="btn-sm" onClick={onClose}>Cancel</button>
                <button className="btn-primary" onClick={save}
                  disabled={busy || !diff || (diff.added.length + diff.changed.length === 0)}>Import</button>
              </>
            )}
        </div>
      </div>
    </Modal>
  );
}

/** "Add starter codes": common denial codes with our own plain-English reasons, to be verified (roadmap 4.1). */
export function DenialStarterModal({ codes, user, onClose, onSaved }) {
  const missing = missingStarterCodes(codes);
  const [picked, setPicked] = useState(() => new Set(missing.map(s => `${s.t}|${s.c}`)));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const toggle = key => setPicked(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  async function save() {
    const chosen = missing.filter(s => picked.has(`${s.t}|${s.c}`));
    if (!chosen.length) return setError('Tick at least one.');
    setSaving(true);
    const added = await addStarterCodes(chosen, user);
    setSaving(false);
    if (!added) return setError('Could not add them. Please try again.');
    onSaved();
  }

  return (
    <Modal title="Add starter denial codes" onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          Common home health, hospice and AR denial codes with plain-English reasons written for our teams.
          They show <b>“Starter – please verify”</b> until someone checks each one and clicks ✓ Verified.
        </p>
        <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 6 }}>
          {CODE_TYPES.map(t => {
            const list = missing.filter(s => s.t === t.value);
            if (!list.length) return null;
            return (
              <div key={t.value} style={{ marginBottom: 8 }}>
                <div className="bold text-sm" style={{ marginBottom: 2 }}>{t.label} — {t.long}</div>
                {list.map(s => {
                  const key = `${s.t}|${s.c}`;
                  return (
                    <label key={key} className="row text-sm" style={{ gap: 8, padding: '3px 0', cursor: 'pointer', alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={picked.has(key)} onChange={() => { toggle(key); setError(''); }} style={{ marginTop: 3 }} />
                      <span><b>{s.c}</b> · <span className="text-muted">{s.cat}</span><br />{s.r}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !picked.size}>{saving ? 'Adding…' : `Add ${picked.size} codes`}</button>
        </div>
      </div>
    </Modal>
  );
}
