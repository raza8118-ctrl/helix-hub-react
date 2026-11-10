import { useState, useMemo } from 'react';
import Modal from './Modal';
import {
  readWorkbook, detectHeaderRow, autoMatch, mapRows, headerSignature, downloadSample, loadTemplates, saveTemplate,
  buildPreview, runImport, companyLabel,
} from '../../lib/smartImport';
import { importType, COMMON_TIPS } from '../../lib/importTypes';

/**
 * Smart Import (PO 2026-11-10): one import for every reference list. Upload (with "What we need in your file") →
 * pick a sheet → "Match your columns" (auto-matched, saved matchings) → preview (new · updates · duplicates · errors)
 * → Import. Built-in special files skip the matching. Never deletes; updates fill empty fields unless "Overwrite".
 */
const colName = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const SHOW = 100;

function NeedPanel({ type }) {
  const req = type.fields.filter(f => f.required && !f.hidden);
  const opt = type.fields.filter(f => !f.required && !f.hidden);
  return (
    <div className="si-need">
      <div className="si-need-t">What we need in your file</div>
      <div className="si-need-grid">
        <div>
          <div className="si-need-h">Required</div>
          <ul>{req.map(f => <li key={f.key}><strong>{f.label}</strong>{f.example ? <span className="text-muted"> — e.g. {f.example}</span> : null}{f.help ? <div className="text-sm text-muted">{f.help}</div> : null}</li>)}</ul>
        </div>
        <div>
          <div className="si-need-h">Optional</div>
          <ul>{opt.map(f => <li key={f.key}><strong>{f.label}</strong>{f.example ? <span className="text-muted"> — e.g. {f.example}</span> : null}</li>)}</ul>
        </div>
      </div>
      <div className="si-need-h">Tips</div>
      <ul className="si-tips">{[...(type.tips ?? []), ...COMMON_TIPS].map(t => <li key={t}>{t}</li>)}</ul>
      {type.builtIns?.length > 0 && (
        <p className="text-sm text-muted" style={{ margin: '6px 0 0' }}>Also recognised automatically: {type.builtIns.map(b => b.label).join(' · ')}.</p>
      )}
      <div className="si-row">
        <button type="button" className="btn-sm" onClick={() => downloadSample(type)}>⬇ Download sample file</button>
        {(type.downloads ?? []).map(d => <button key={d.label} type="button" className="btn-sm" onClick={d.run}>{d.label}</button>)}
      </div>
    </div>
  );
}

export default function SmartImport({ typeId, user, onClose, onDone }) {
  const type = useMemo(() => importType(typeId), [typeId]);
  const [step, setStep] = useState('upload');          // upload · sheet · match · preview · done
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState({});
  const [constants, setConstants] = useState({});
  const [templates, setTemplates] = useState([]);
  const [usedTemplate, setUsedTemplate] = useState(null);
  const [tplName, setTplName] = useState('');
  const [builtIn, setBuiltIn] = useState(null);        // { label, records }
  const [preview, setPreview] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [options, setOptions] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const rows = sheets[sheetIdx]?.rows ?? [];
  const headers = rows[headerRow] ?? [];
  const sample = rows[headerRow + 1] ?? [];
  const target = companyLabel();

  function matchFor(rowsOfSheet, hr, tpls) {
    const hs = rowsOfSheet[hr] ?? [];
    const tpl = (tpls ?? []).find(t => t.signature === headerSignature(hs));
    if (tpl) { setMapping(tpl.mapping ?? {}); setConstants(tpl.constants ?? {}); setUsedTemplate(tpl.name); return; }
    setMapping(autoMatch(hs, type.fields)); setConstants({}); setUsedTemplate(null);
  }

  function chooseSheet(i, list = sheets, tpls = templates) {
    setSheetIdx(i);
    const r = list[i]?.rows ?? [];
    const hr = detectHeaderRow(r, type.fields);
    setHeaderRow(hr);
    matchFor(r, hr, tpls);
    setStep('match');
  }

  async function pickFile(f) {
    if (!f) return;
    setErr(''); setFile(f); setBuiltIn(null); setBusy('Reading the file…');
    try {
      // built-in special files first (they have their own rules)
      for (const b of type.builtIns ?? []) {
        if (await b.detect(f)) {
          const out = await b.parse(f);
          setBusy('');
          if (out.error) { setErr(out.error); return; }
          setBuiltIn({ label: b.label, out });
          await makePreview(out, overwrite);
          return;
        }
      }
      if (!/\.(xlsx|xls|csv)$/i.test(f.name)) { setBusy(''); setErr('Please choose an Excel (.xlsx / .xls) or CSV file.'); return; }
      const list = await readWorkbook(f);
      const tpls = (await loadTemplates(type.id)) ?? [];
      setTemplates(tpls);
      setSheets(list);
      setBusy('');
      if (!list.length) { setErr('The file is empty.'); return; }
      if (list.length > 1) { setStep('sheet'); return; }
      chooseSheet(0, list, tpls);
    } catch (e) {
      setBusy(''); setErr(`Could not read this file (${e.message}).`);
    }
  }

  const missing = type.fields.filter(f => f.required && mapping[f.key] == null && !constants[f.key]);

  async function makePreview(input, ow) {
    setBusy('Checking against what is already there…'); setErr('');
    try {
      const p = await buildPreview(type, input, { overwrite: ow }, msg => setBusy(msg));
      setPreview(p); setStep('preview');
    } catch (e) { setErr(e.message); }
    setBusy('');
  }
  const input = () => (builtIn ? builtIn.out : { records: mapRows(rows, headerRow, mapping, constants) });

  async function save() {
    if (!tplName.trim()) return;
    const t = await saveTemplate(type.id, { name: tplName, signature: headerSignature(headers), mapping, constants, headerRow }, user);
    if (t) { setTemplates(x => [...x, t]); setUsedTemplate(t.name); setTplName(''); } else setErr('Could not save the matching (it needs the Smart Import database update, migration 53).');
  }

  async function doImport() {
    setErr(''); setBusy('Importing…');
    try {
      const r = await runImport(type, preview, { fileName: file.name, options }, user, msg => setBusy(msg));
      setResult(r); setStep('done');
    } catch (e) { setErr(e.message); }
    setBusy('');
  }

  const list = (items, render) => (
    <ul className="si-list">
      {items.slice(0, SHOW).map((it, i) => <li key={i}>{render(it)}</li>)}
      {items.length > SHOW && <li className="text-muted">… and {(items.length - SHOW).toLocaleString()} more</li>}
    </ul>
  );

  return (
    <Modal title={`Smart Import — ${type.title}`} onClose={onClose} wide>
      <div className="si">
        <div className="text-sm text-muted si-target">Imports into <strong>{target}</strong>. Nothing is saved until you click Import, and nothing is ever deleted.</div>

        {step === 'upload' && (
          <>
            {type.intro && <p className="text-sm" style={{ marginTop: 0 }}>{type.intro}</p>}
            <label className="si-drop">
              <input type="file" accept={type.accept ?? '.xlsx,.xls,.csv'} onChange={e => pickFile(e.target.files?.[0])} />
              <span>⬆ Choose a file (.xlsx, .xls or .csv{type.accept?.includes('.txt') ? ', or the CMS .txt file' : ''})</span>
            </label>
            <NeedPanel type={type} />
          </>
        )}

        {step === 'sheet' && (
          <>
            <p style={{ marginTop: 0 }}><strong>{file?.name}</strong> has {sheets.length} sheets. Which one should be imported?</p>
            <div className="si-sheets">
              {sheets.map((s, i) => (
                <button key={s.name} type="button" className="btn-sm" onClick={() => chooseSheet(i)}>{s.name} <span className="text-muted">({s.rows.length} rows)</span></button>
              ))}
            </div>
          </>
        )}

        {step === 'match' && (
          <>
            <div className="si-row">
              <strong>Match your columns</strong>
              <span className="text-sm text-muted">{file?.name}{sheets.length > 1 ? ` · sheet “${sheets[sheetIdx]?.name}”` : ''}</span>
              {usedTemplate && <span className="badge badge-green">Using your saved matching “{usedTemplate}”</span>}
            </div>
            <label className="text-sm si-hrow">Column names are in row
              <input type="number" min={1} max={Math.min(rows.length, 50)} value={headerRow + 1}
                onChange={e => { const hr = Math.max(0, Math.min(rows.length - 1, (parseInt(e.target.value, 10) || 1) - 1)); setHeaderRow(hr); matchFor(rows, hr, templates); }} />
              <span className="text-muted">(found automatically — change it if it’s wrong)</span>
            </label>
            <div className="table-wrap">
              <table className="si-match">
                <thead><tr><th>We need</th><th>Your column</th><th>Example from your file</th></tr></thead>
                <tbody>
                  {type.fields.filter(f => !f.hidden).map(f => (
                    <tr key={f.key} className={f.required && mapping[f.key] == null && !constants[f.key] ? 'si-missing' : ''}>
                      <td><strong>{f.label}</strong>{f.required && <span className="si-req" title="Required"> *</span>}<div className="text-sm text-muted">e.g. {f.example || '—'}</div></td>
                      <td>
                        <select value={mapping[f.key] ?? ''} aria-label={`Column for ${f.label}`}
                          onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}>
                          <option value="">— Don’t import —</option>
                          {headers.map((h, i) => (h ? <option key={i} value={i}>{colName(i)} · {h}</option> : null))}
                        </select>
                        {f.options && mapping[f.key] == null && (
                          <select value={constants[f.key] ?? ''} aria-label={`One value for every row: ${f.label}`} style={{ marginTop: 4 }}
                            onChange={e => setConstants(c => ({ ...c, [f.key]: e.target.value }))}>
                            <option value="">…or one value for every row</option>
                            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="text-sm text-muted">{mapping[f.key] != null ? (sample[mapping[f.key]] || '(empty)') : constants[f.key] ? `Every row: ${f.options?.find(o => o.value === constants[f.key])?.label ?? constants[f.key]}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="si-row">
              <input type="text" value={tplName} onChange={e => setTplName(e.target.value)} placeholder="Name this matching, e.g. “Waystar payer list”" aria-label="Matching name" style={{ maxWidth: 300 }} />
              <button type="button" className="btn-sm" onClick={save} disabled={!tplName.trim()}>Save matching</button>
              <span className="text-sm text-muted">Used automatically next time a file has the same columns.</span>
            </div>
            {missing.length > 0 && <p className="ot-err">Still needed: {missing.map(f => f.label).join(', ')}.</p>}
            <div className="si-actions">
              <button type="button" className="btn-sm" onClick={() => setStep(sheets.length > 1 ? 'sheet' : 'upload')}>Back</button>
              <button type="button" className="btn-primary" disabled={!!busy || missing.length > 0} onClick={() => makePreview(input(), overwrite)}>Preview</button>
            </div>
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <div className="si-row">
              <strong>Preview</strong><span className="text-sm text-muted">{file?.name}{builtIn ? ` · recognised: ${builtIn.label}` : ''}</span>
            </div>
            <div className="si-counts">
              <div className="oc-co-stat"><div className="oc-co-stat-l">New</div><div className="bold">{preview.adds.length.toLocaleString()}</div></div>
              <div className="oc-co-stat"><div className="oc-co-stat-l">Updates</div><div className="bold">{preview.updates.length.toLocaleString()}</div></div>
              <div className="oc-co-stat"><div className="oc-co-stat-l">Duplicates skipped</div><div className="bold">{preview.dups.length.toLocaleString()}</div></div>
              <div className="oc-co-stat"><div className="oc-co-stat-l">Errors</div><div className={`bold ${preview.errors.length ? 'col-red' : ''}`}>{preview.errors.length.toLocaleString()}</div></div>
            </div>
            {preview.note && <p className="text-sm si-note">{preview.note}</p>}
            {!preview.noOverwrite && <label className="omp-check">
              <input type="checkbox" checked={overwrite} onChange={e => { setOverwrite(e.target.checked); makePreview(input(), e.target.checked); }} />
              <span><strong>Overwrite existing values</strong> <span className="text-muted text-sm">— otherwise only empty fields of existing items are filled</span></span>
            </label>}
            {(type.options ?? []).map(o => (
              <label key={o.key} className="omp-check">
                <input type="checkbox" checked={!!options[o.key]} onChange={e => setOptions(x => ({ ...x, [o.key]: e.target.checked }))} />
                <span className="text-sm">{o.label}</span>
              </label>
            ))}
            {preview.errors.length > 0 && (
              <details className="si-sec" open><summary>Rows with errors ({preview.errors.length}) — these are not imported</summary>
                {list(preview.errors, e => <>Row {e.rowNum}{e.label ? ` · ${e.label}` : ''}: <span className="col-red">{e.why}</span></>)}</details>
            )}
            {preview.adds.length > 0 && (
              <details className="si-sec"><summary>New ({preview.adds.length.toLocaleString()})</summary>
                {list(preview.adds, a => <>Row {a.rowNum} · {a.label ?? type.labelOf(a.values)}</>)}</details>
            )}
            {preview.updates.length > 0 && (
              <details className="si-sec"><summary>Updates to existing items ({preview.updates.length.toLocaleString()})</summary>
                {list(preview.updates, u => <>Row {u.rowNum} · {u.label ?? type.labelOf(u.values)} — {u.changes ?? Object.keys(u.patch).map(k => type.fields.find(f => f.key === k)?.label ?? k).join(', ')}</>)}</details>
            )}
            {preview.dups.length > 0 && (
              <details className="si-sec"><summary>Duplicates skipped ({preview.dups.length.toLocaleString()})</summary>
                {list(preview.dups, d => <>Row {d.rowNum} · {d.label} — {d.why}</>)}</details>
            )}
            <div className="si-actions">
              <button type="button" className="btn-sm" onClick={() => setStep(builtIn ? 'upload' : 'match')}>Back</button>
              <button type="button" className="btn-primary" disabled={!!busy || (!preview.adds.length && !preview.updates.length && !Object.values(options).some(Boolean))} onClick={doImport}>
                Import {(preview.adds.length + preview.updates.length).toLocaleString()} row{preview.adds.length + preview.updates.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <>
            <p style={{ marginTop: 0 }}>✓ Imported into <strong>{target}</strong>: {result.added ?? 0} new, {result.updated ?? 0} updated{result.retired ? `, ${result.retired} marked retired` : ''}.</p>
            <p className="text-sm text-muted">Recorded in the Audit Log{target === 'the Master Library' ? ' and your owner log' : ''}, with the file name “{file?.name}”.</p>
            <div className="si-actions"><button type="button" className="btn-primary" onClick={() => { onDone?.(); onClose(); }}>Done</button></div>
          </>
        )}

        {busy && <div className="loading-row"><div className="spinner" /> {busy}</div>}
        {err && <p className="ot-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}
