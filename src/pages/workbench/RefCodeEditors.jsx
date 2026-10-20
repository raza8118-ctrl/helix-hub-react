import { useState } from 'react';
import { CODE_SETS, setOf, displayRef, saveRefCode, readRefFile, compareRefImport, applyRefImport } from '../../lib/refCodes';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

/** Add / edit one reference code (roadmap 6.3). */
export function RefCodeModal({ row, user, onClose, onSaved }) {
  const [v, setV] = useState({
    code_set: row?.code_set ?? 'revenue', code: row ? displayRef(row.code_set, row.code) : '', description: row?.description ?? '',
    notes: row?.notes ?? '', list_year: row?.list_year ? String(row.list_year) : '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = patch => { setV(x => ({ ...x, ...patch })); setError(''); };

  async function save() {
    if (!v.code.trim()) return setError('Please enter the code.');
    if (!v.description.trim()) return setError('Please enter the description.');
    setSaving(true);
    const result = await saveRefCode(row, {
      code_set: v.code_set, code: v.code, description: v.description.trim(), notes: v.notes.trim() || null,
      list_year: parseInt(v.list_year, 10) || null,
    }, user);
    setSaving(false);
    if (result.error) return setError(result.error);
    onSaved();
  }

  return (
    <Modal title={row ? `Edit ${setOf(row.code_set).label} ${displayRef(row.code_set, row.code)}` : 'Add a code'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 160px' }}><label>List</label>
            <select value={v.code_set} disabled={!!row} onChange={e => set({ code_set: e.target.value })}>
              {CODE_SETS.map(s => <option key={s.value} value={s.value}>{s.long}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}><label>Code *</label>
            <input type="text" value={v.code} onChange={e => set({ code: e.target.value })} placeholder="e.g. 0551, I50.9" />
          </div>
          <div className="field" style={{ flex: '0 1 100px' }}><label>List year</label>
            <input type="number" value={v.list_year} onChange={e => set({ list_year: e.target.value })} placeholder="2027" />
          </div>
        </div>
        <div className="field"><label>Description *</label>
          <textarea rows={2} value={v.description} onChange={e => set({ description: e.target.value })} />
        </div>
        <div className="field"><label>Notes</label>
          <input type="text" value={v.notes} onChange={e => set({ notes: e.target.value })} placeholder="Optional, e.g. how our clients use it" />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : row ? 'Save Changes' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Import a code list (CMS ICD-10-CM text file or Excel / CSV) with a preview (roadmap 6.3). Nothing is deleted. */
export function RefImportModal({ user, onClose, onSaved }) {
  const [codeSet, setCodeSet] = useState('icd10');
  const [listYear, setListYear] = useState(String(new Date().getFullYear() + 1));
  const [rows, setRows] = useState(null);
  const [diff, setDiff] = useState(null);
  const [retireMissing, setRetireMissing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function pick(file) {
    setRows(null); setDiff(null); setError('');
    if (!file) return;
    setBusy('Reading the file…');
    try {
      const r = await readRefFile(file, codeSet);
      if (r.error) { setError(r.error); setBusy(''); return; }
      setRows(r.rows);
      setDiff(await compareRefImport(codeSet, r.rows, setBusy));
    } catch {
      setError('This file couldn’t be read. Use the CMS .txt file or an .xlsx / .csv with Code and Description columns.');
    }
    setBusy('');
  }

  async function save() {
    if (!await confirmDialog({
      title: `Import ${setOf(codeSet).long} list?`,
      message: `${diff.added.length.toLocaleString()} new, ${diff.changed.length.toLocaleString()} changed`
        + (retireMissing ? `, ${diff.missing.length.toLocaleString()} marked retired` : '') + '. Nothing is deleted.',
      confirmText: 'Import',
    })) return;
    try {
      setDone(await applyRefImport(codeSet, diff, { listYear: parseInt(listYear, 10), retireMissing }, user, setBusy));
    } catch {
      setError('The import stopped part-way. Run it again — codes already added are skipped.');
    }
    setBusy('');
  }

  return (
    <Modal title="Import a code list" onClose={done ? onSaved : onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!done && (
          <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '1 1 220px' }}><label>List</label>
                <select value={codeSet} onChange={e => { setCodeSet(e.target.value); setRows(null); setDiff(null); }}>
                  {CODE_SETS.map(s => <option key={s.value} value={s.value}>{s.long}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: '0 1 120px' }}><label>List year</label>
                <input type="number" value={listYear} onChange={e => setListYear(e.target.value)} />
              </div>
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 0 }}>
              {codeSet === 'icd10'
                ? <>ICD-10-CM is free from CMS: cms.gov → ICD-10 → the year’s “Code Descriptions in Tabular Order” zip → <code>icd10cm-codes-YYYY.txt</code>. Pick that file here.</>
                : <>Use an Excel / CSV with a <b>Code</b> and a <b>Description</b> column (revenue code descriptions come from your licensed UB-04 / NUBC manual).</>}
            </p>
            <input type="file" accept=".txt,.xlsx,.xls,.csv" onChange={e => pick(e.target.files?.[0] ?? null)} />
          </>
        )}
        {busy && <div className="text-sm text-muted" style={{ marginTop: 8 }}>⏳ {busy}</div>}
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        {diff && !done && (
          <div className="card" style={{ marginTop: 10, background: 'var(--surface-2)' }}>
            <div className="bold">{rows.length.toLocaleString()} codes in the file</div>
            <div className="text-sm" style={{ marginTop: 4 }}>
              <span className="badge badge-green">{diff.added.length.toLocaleString()} new</span>{' '}
              <span className="badge badge-blue">{diff.changed.length.toLocaleString()} changed</span>{' '}
              <span className="badge badge-gray">{diff.same.toLocaleString()} unchanged</span>{' '}
              <span className="badge badge-orange">{diff.missing.length.toLocaleString()} not in this file</span>
            </div>
            {diff.missing.length > 0 && (
              <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', marginTop: 6 }}>
                <input type="checkbox" checked={retireMissing} onChange={e => setRetireMissing(e.target.checked)} />
                Mark the {diff.missing.length.toLocaleString()} codes that aren’t in this file as “retired” (they stay searchable)
              </label>
            )}
            {diff.added.slice(0, 5).map(r => (
              <div key={r.code} className="text-sm" style={{ marginTop: 2 }}>New · {displayRef(codeSet, r.code)} {r.description.slice(0, 90)}</div>
            ))}
          </div>
        )}
        {done && <p className="text-sm">✓ Imported: {done.added.toLocaleString()} new, {done.updated.toLocaleString()} updated, {done.retired.toLocaleString()} marked retired.</p>}
        <div className="form-actions">
          {done
            ? <button className="btn-primary" onClick={onSaved}>Done</button>
            : (
              <>
                <button className="btn-sm" onClick={onClose} disabled={!!busy}>Cancel</button>
                <button className="btn-primary" onClick={save}
                  disabled={!!busy || !diff || (diff.added.length + diff.changed.length + (retireMissing ? diff.missing.length : 0) === 0)}>Import</button>
              </>
            )}
        </div>
      </div>
    </Modal>
  );
}
