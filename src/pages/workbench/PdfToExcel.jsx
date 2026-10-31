import { useState, useEffect, useMemo, useRef } from 'react';
import { readPdf, parsePageList } from '../../lib/pdfTools';
import {
  EXTRACT_METHODS, loadMethodConfig, saveMethodConfig, methodReady, extractTables, arrangeSheets, downloadXlsx,
  downloadStructuredXlsx,
} from '../../lib/pdfExtract';
import { structure, buildView } from '../../lib/pdfStructure';
import { logAudit } from '../../lib/audit';
import { confirmDialog } from '../../components/shared/Dialog';
import { Modal, Card, Button, Badge, Tabs, Check, Field, FormActions, Notice, Table, Toolbar, EmptyState } from '../../components/ui';

const PREVIEW_ROWS = 100;

/** Admin-only pop-up to switch a service method on (B / C / D). */
function MethodSetup({ method, config, user, onClose, onSaved }) {
  const cur = config[method.id] ?? {};
  const [enabled, setEnabled] = useState(!!cur.enabled);
  const [url, setUrl]         = useState(cur.url ?? '');
  const [fn, setFn]           = useState(cur.functionName ?? '');
  const [key, setKey]         = useState(cur.accessKey ?? '');
  const [baa, setBaa]         = useState(!!cur.baa);
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  async function save() {
    if (enabled) {
      if (!baa) return setError('Switching this on needs a signed BAA with the provider. Tick the box only if one is in place.');
      if (method.kind === 'supabase' && !fn.trim()) return setError('Enter the Edge Function name.');
      if (method.kind === 'url' && !(/^https:\/\//i.test(url.trim()) || url.trim().startsWith('/'))) {
        return setError('Enter the service address — it must start with https:// (or / for a function in this app).');
      }
    }
    if (!await confirmDialog({
      title: enabled ? `Switch on “${method.label}”?` : `Switch off “${method.label}”?`,
      message: enabled
        ? 'PDFs processed with this method — which may contain patient information — will be sent to this service.'
        : 'People won’t be able to choose this method until it is switched on again.',
      tone: enabled ? 'warning' : undefined,
      confirmText: enabled ? 'Switch On' : 'Switch Off',
    })) return;
    setSaving(true);
    const next = {
      ...config,
      [method.id]: {
        enabled, baa, url: url.trim(), functionName: fn.trim(), accessKey: key.trim(),
        updatedBy: user.emp_id, updatedAt: new Date().toISOString(),
      },
    };
    const ok = await saveMethodConfig(next);
    setSaving(false);
    if (!ok) return setError('Could not save. Please try again.');
    logAudit({
      actor: user, action: 'configure_extract_engine', entityType: 'setting', entityId: `pdf_extract:${method.id}`,
      details: { method: method.label, enabled, baa_confirmed: baa },   // never the key
    });
    onSaved(next);
  }

  return (
    <Modal title={`Set up — ${method.label}`} onClose={onClose}>
      <div>
        <p className="ui-muted" style={{ margin: '0 0 var(--ui-s3)' }}>
          {method.hint} What the service must accept and return is described in <code>docs/PDF_EXTRACTION_SERVER.md</code>.
        </p>
        {method.kind === 'supabase' ? (
          <Field label="Edge Function name">
            <input type="text" value={fn} onChange={e => { setFn(e.target.value); setError(''); }} placeholder="e.g. pdf-to-excel" />
          </Field>
        ) : (
          <Field label="Service address">
            <input type="text" value={url} onChange={e => { setUrl(e.target.value); setError(''); }}
              placeholder={method.id === 'vercel' ? '/api/pdf-to-excel' : 'https://extract.yourcompany.com/pdf-to-excel'} />
          </Field>
        )}
        {method.kind === 'url' && (
          <Field label="Access key (optional)" hint="Use a key that only works for this service — signed-in users of this company can read it.">
            <input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" />
          </Field>
        )}
        <Check checked={baa} onChange={e => { setBaa(e.target.checked); setError(''); }}>
          We have a <strong>signed BAA</strong> with this provider that covers patient files sent to this service.
        </Check>
        <Check checked={enabled} onChange={e => { setEnabled(e.target.checked); setError(''); }}>
          Switch this method on for everyone in this company
        </Check>
        {error && <Notice tone="bad">{error}</Notice>}
        <FormActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </FormActions>
      </div>
    </Modal>
  );
}

const KIND_LABELS = { date: 'Date', amount: 'Amount', number: 'Number', id: 'ID', text: 'Text' };
const thBtn = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'inherit', cursor: 'pointer', letterSpacing: 'inherit', textTransform: 'inherit' };

/**
 * Proper-format review (fix to 2.4): the tables found by pdfStructure.js. Header, rename, remove, split names
 * and sort apply to every row of the file; the filter box narrows the preview and the download.
 */
function StructuredPreview({ tables, other, edits, setTableEdit, splitNames, setSplitNames, filter, setFilter, tab, setTab, outName, setOutName }) {
  const [renaming, setRenaming] = useState(null);   // { key, draft }
  const views = useMemo(
    () => tables.map((t, i) => buildView(t, { ...edits[i], splitNames, filter })),
    [tables, edits, splitNames, filter],
  );
  const otherTab = tables.length;
  const t = Math.min(tab, otherTab);
  const view = views[t];
  const ed = edits[t] ?? {};
  const removedCount = ed.removed?.size ?? 0;

  function sortBy(key) {
    const s = ed.sort;
    setTableEdit(t, { sort: s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null });
  }
  function remove(key) {
    setTableEdit(t, { removed: new Set([...(ed.removed ?? []), key]), sort: ed.sort?.key === key ? null : ed.sort });
  }
  function saveRename() {
    if (renaming) setTableEdit(t, { renames: { ...ed.renames, [renaming.key]: renaming.draft.trim() } });
    setRenaming(null);
  }
  function download() {
    const sheets = views.map((v, i) => ({ name: tables[i].name, columns: v.columns, rows: v.rows.map(r => r.cells) }));
    if (other.length) {
      sheets.push({
        name: 'Other text',
        columns: [{ name: 'Page', kind: 'number' }, { name: 'Text', kind: 'text' }],
        rows: other.map(o => [String(o.page), o.text]),
      });
    }
    downloadStructuredXlsx(sheets, outName.trim() || 'extracted.xlsx');
  }
  const shownRows = views.reduce((s, v) => s + v.rows.length, 0);

  return (
    <div className="ui-stack">
      <Toolbar>
        <Check inline checked={splitNames} onChange={e => setSplitNames(e.target.checked)}>Split names into Last Name / First Name</Check>
        <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="🔍 Filter rows…" aria-label="Filter rows" />
        {filter.trim() && <span className="ui-count">{shownRows.toLocaleString()} matching row{shownRows === 1 ? '' : 's'}</span>}
      </Toolbar>

      {(tables.length > 1 || other.length > 0) && (
        <div>
          <Tabs value={t} onChange={setTab} label="Tables" options={[
            ...tables.map((tb, i) => ({ value: i, label: `${tb.name} (${views[i].rows.length.toLocaleString()})` })),
            other.length > 0 && { value: otherTab, label: `Other text (${other.length.toLocaleString()})`, title: 'Titles, addresses, page numbers and totals that aren\'t part of the table — kept so nothing is lost' },
          ]} />
        </div>
      )}

      {t === otherTab ? (
        <Table dense maxHeight={420}>
          <thead><tr><th>Page</th><th>Text</th></tr></thead>
          <tbody>
            {other.slice(0, PREVIEW_ROWS).map((o, i) => <tr key={i}><td>{o.page}</td><td>{o.text}</td></tr>)}
          </tbody>
        </Table>
      ) : (
        <>
          <div className="ui-row ui-muted" style={{ gap: 10 }}>
            <span>Click a column name to sort · ✎ rename · ✕ remove · ⤒ on a row uses it as the header. Changes apply to the whole file.</span>
            {ed.headerRow != null && (
              <Button size="xs" onClick={() => setTableEdit(t, { headerRow: null, renames: {}, removed: new Set(), sort: null })}>↺ Use the detected header</Button>
            )}
            {removedCount > 0 && (
              <Button size="xs" onClick={() => setTableEdit(t, { removed: new Set() })}>↺ Show {removedCount} removed column{removedCount === 1 ? '' : 's'}</Button>
            )}
          </div>
          {!view.rows.length
            ? <EmptyState compact title={filter.trim() ? 'No rows match the filter.' : 'No rows.'} />
            : (
              <div className="ui-stack" style={{ gap: 6 }}>
                <Table dense maxHeight={420}>
                  <thead>
                    <tr>
                      <th aria-label="Row actions" />
                      {view.columns.map(c => (
                        <th key={c.key} style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                          {renaming?.key === c.key ? (
                            <input type="text" className="ui-input" autoFocus value={renaming.draft} style={{ minWidth: 110, fontSize: 12, minHeight: 28, padding: '3px 8px' }}
                              onChange={e => setRenaming({ key: c.key, draft: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null); }}
                              onBlur={saveRename} aria-label="Column name" />
                          ) : (
                            <>
                              <button type="button" onClick={() => sortBy(c.key)} title="Sort by this column" style={thBtn}>
                                {c.name}{ed.sort?.key === c.key ? (ed.sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                              </button>
                              {' '}
                              <Button size="xs" variant="ghost" title="Rename this column" aria-label="Rename this column" onClick={() => setRenaming({ key: c.key, draft: c.name })}>✎</Button>
                              <Button size="xs" variant="ghost" title="Remove this column" aria-label="Remove this column" onClick={() => remove(c.key)}>✕</Button>
                              <div style={{ fontWeight: 400, fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>{KIND_LABELS[c.kind]}</div>
                            </>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.slice(0, PREVIEW_ROWS).map(r => (
                      <tr key={r.index}>
                        <td>
                          <Button size="xs" variant="ghost" title="Use this row as the header (for the whole file)" aria-label="Use this row as the header"
                            onClick={() => setTableEdit(t, { headerRow: r.index, renames: {}, removed: new Set(), sort: null })}>⤒</Button>
                        </td>
                        {r.cells.map((v, c) => {
                          const doubt = r.low?.has(c);
                          return (
                            <td key={c} className={doubt ? 'mark' : undefined} title={doubt ? 'OCR was unsure of this — please check' : undefined}
                              style={{ whiteSpace: 'nowrap' }}>
                              {v}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {view.rows.length > PREVIEW_ROWS && (
                  <div className="ui-muted">Showing the first {PREVIEW_ROWS} of {view.rows.length.toLocaleString()} rows — the download has them all.</div>
                )}
              </div>
            )}
        </>
      )}

      <Toolbar>
        <label className="ui-label" htmlFor="xlsx-name-structured">File name</label>
        <input id="xlsx-name-structured" type="text" value={outName} onChange={e => setOutName(e.target.value)} />
        <Button variant="primary" disabled={!shownRows} onClick={download}>
          ⬇ Download Excel{filter.trim() ? ` (${shownRows.toLocaleString()} filtered rows)` : ''}
        </Button>
      </Toolbar>
      <div className="ui-muted">
        The Excel file has a filter on every column, a frozen header row, real dates and amounts
        {other.length > 0 ? ', and an “Other text” tab with everything that wasn’t part of the table' : ''}.
      </div>
    </div>
  );
}

/**
 * PDF → Excel (roadmap 2.4): choose a method, extract, preview, download .xlsx.
 * “In this browser” always works; service methods appear once an admin sets them up with a BAA.
 */
export default function PdfToExcel({ user }) {
  const isAdmin = user.role === 'admin';
  const [config, setConfig]   = useState({});
  const [method, setMethod]   = useState('browser');
  const [setupFor, setSetupFor] = useState(null);
  const [file, setFile]       = useState(null);    // { file, name, bytes, pageCount }
  const [busy, setBusy]       = useState(false);
  const [progress, setProgress] = useState('');
  const [problem, setProblem] = useState('');
  const [pagesMode, setPagesMode] = useState('all');
  const [pagesText, setPagesText] = useState('');
  const [result, setResult]   = useState(null);    // { key, pages, method, structured }
  const [layout, setLayout]   = useState(null);    // null = the one detected; 'table' | 'records' | 'raw'
  const [splitNames, setSplitNames] = useState(true);
  const [edits, setEdits]     = useState({});      // per layout + table: { headerRow, renames, removed, sort }
  const [filter, setFilter]   = useState('');
  const [combine, setCombine] = useState(true);
  const [skipHeaders, setSkipHeaders] = useState(true);
  const [asNumbers, setAsNumbers] = useState(true);
  const [outName, setOutName] = useState('');
  const [tab, setTab]         = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const control = useRef(null);   // { cancelled, onCancel } while an extraction runs

  useEffect(() => { loadMethodConfig().then(setConfig).catch(() => {}); }, []);

  const chosen = EXTRACT_METHODS.find(m => m.id === method);
  const chosenReady = chosen && methodReady(chosen, config);
  // A result only stays on screen while the file, method and pages are the ones it came from
  const runKey = `${file?.name}|${file?.bytes.length}|${method}|${pagesMode}|${pagesText}`;
  const current = result?.key === runKey ? result : null;

  async function pick(list) {
    const f = list?.[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return setProblem(`${f.name}: not a PDF`);
    setBusy(true); setProblem(''); setResult(null);
    try {
      const { bytes, pageCount } = await readPdf(f);
      setFile({ file: f, name: f.name, bytes, pageCount });
      setOutName(f.name.replace(/\.pdf$/i, '.xlsx'));
    } catch (err) {
      setProblem(err.message === 'password'
        ? `${f.name} is password-protected — remove the password in your PDF reader and try again.`
        : `${f.name} is damaged or not a real PDF.`);
    }
    setBusy(false);
  }

  async function extract() {
    let pageNumbers = null;
    if (pagesMode === 'some') {
      const res = parsePageList(pagesText, file.pageCount);
      if (res.error) return setProblem(res.error);
      pageNumbers = res.pages;
    }
    setBusy(true); setProblem(''); setTab(0);
    control.current = { cancelled: false, onCancel: null };
    try {
      const out = await extractTables({
        methodId: method, config, file: file.file, bytes: file.bytes, pageNumbers, control: control.current,
        onProgress: (p, total, isOcr) => setProgress(isOcr
          ? `Reading page ${p} of ${total} with OCR — a few seconds per page…`
          : `Reading page ${p} of ${total}…`),
      });
      let structured = null;
      try { structured = structure(out.pages); } catch { /* “As on page” still works */ }
      setResult({ key: runKey, pages: out.pages, method, structured });
      setLayout(null); setEdits({}); setFilter('');
      logAudit({
        actor: user, action: 'pdf_to_excel', entityType: 'file_tool',
        details: {
          method: chosen.label, pages: out.pages.length, layout_detected: structured?.auto ?? 'raw',
          rows: out.pages.reduce((s, p) => s + p.rows.length, 0),
          ocr_pages: out.pages.filter(p => p.ocr).length,
          scanned_pages: out.pages.filter(p => p.scanned).length,
        },
      });
    } catch (err) {
      setProblem(
        err.message === 'cancelled' ? 'Stopped. Nothing was saved.'
        : err.message === 'ocr-setup' ? 'OCR couldn’t start because its files weren’t found. Please tell your admin (File Tools OCR setup, step 2.4b).'
        : err.message || 'Extraction failed. Please try again.',
      );
    }
    control.current = null;
    setProgress('');
    setBusy(false);
  }

  function cancel() {
    const c = control.current;
    if (!c) return;
    c.cancelled = true;
    c.onCancel?.();
    setProgress('Stopping…');
  }

  const sheets = useMemo(
    () => (current ? arrangeSheets(current.pages, { combine, skipRepeatedHeaders: skipHeaders }) : []),
    [current, combine, skipHeaders],
  );
  const scannedPages = current?.pages.filter(p => p.scanned).map(p => p.page) ?? [];
  const usedOcr = current?.method === 'ocr';
  const ocrPages = current?.pages.filter(p => p.ocr).length ?? 0;
  const sheet = sheets[Math.min(tab, Math.max(sheets.length - 1, 0))];
  const width = sheet ? sheet.rows.reduce((m, r) => Math.max(m, r.length), 0) : 0;
  const totalRows = sheets.reduce((s, x) => s + x.rows.length, 0);
  const doubtful = sheets.reduce((s, x) => s + (x.lows ?? []).reduce((n, set) => n + (set?.size ?? 0), 0), 0);

  // Proper format: the layout detected for this file unless the user picked another
  const st = current?.structured;
  const layoutNow = layout ?? st?.auto ?? 'raw';
  const structTables = layoutNow === 'table' ? st?.table ?? [] : layoutNow === 'records' ? st?.records ?? [] : [];
  const structOther = layoutNow === 'table' ? st?.tableOther ?? [] : st?.recordsOther ?? [];
  const detected = !st ? null
    : st.auto === 'table' ? `a table — ${st.summary.columns} columns, ${st.summary.tableRows.toLocaleString()} rows${st.summary.tables > 1 ? ` (+ ${st.summary.tables - 1} more table${st.summary.tables > 2 ? 's' : ''})` : ''}`
    : st.auto === 'records' ? `records (Label: value) — ${st.summary.recordRows.toLocaleString()} records, ${st.summary.recordColumns} fields`
    : 'no clear table — showing it as on the page';
  const layoutKey = `${layoutNow}`;
  const tableEdits = edits[layoutKey] ?? {};
  const setTableEdit = (i, patch) => setEdits(e => ({ ...e, [layoutKey]: { ...e[layoutKey], [i]: { ...e[layoutKey]?.[i], ...patch } } }));
  const LAYOUTS = [
    { id: 'table', label: 'Structured table', hint: 'Aging, denial and claim reports', ok: !!st?.table.length },
    { id: 'records', label: 'Records (Label: value)', hint: 'EOBs, remits, letters — one row per claim / patient', ok: !!st?.records.length },
    { id: 'raw', label: 'As on page', hint: 'Every line exactly as printed', ok: true },
  ];

  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      {/* Method */}
      <Card title="How should the PDF be read?">
        <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
          {EXTRACT_METHODS.map(m => {
            const ready = methodReady(m, config);
            const status = m.kind === 'browser' ? 'Ready' : m.kind === 'soon' ? 'Coming soon' : ready ? 'Ready (BAA confirmed)' : 'Needs setup';
            return (
              <div key={m.id}>
                <div className="ui-row">
                  <span style={{ opacity: ready ? 1 : 0.6 }}>
                    <Check type="radio" inline name="extract-method" checked={method === m.id} disabled={!ready} onChange={() => setMethod(m.id)}>
                      <strong style={{ color: 'var(--text)' }}>{m.label}</strong>
                    </Check>
                  </span>
                  <Badge tone={ready ? 'good' : m.kind === 'soon' ? 'neutral' : 'warn'}>{status}</Badge>
                  {isAdmin && (m.kind === 'url' || m.kind === 'supabase') && (
                    <Button size="xs" onClick={() => setSetupFor(m)}>⚙ Set up</Button>
                  )}
                </div>
                <div className="ui-muted" style={{ marginLeft: 24 }}>{m.hint}</div>
              </div>
            );
          })}
        </div>
        {chosen && chosen.kind !== 'browser' && chosenReady && (
          <Notice tone="warn" style={{ marginTop: 'var(--ui-s3)' }}>
            ⚠ With this method the PDF is sent to the service your admin set up (BAA confirmed).
          </Notice>
        )}
      </Card>

      {/* File */}
      <div
        className={`ui-drop${dragOver ? ' over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files); }}
      >
        {file ? (
          <div className="ui-row" style={{ justifyContent: 'center' }}>
            <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>📄 {file.name}</span>
            <span className="ui-muted">{file.pageCount} page{file.pageCount === 1 ? '' : 's'}</span>
            <Button size="sm" onClick={() => { setFile(null); setResult(null); setProblem(''); }}>Choose another</Button>
          </div>
        ) : (
          <>
            <div className="ui-drop-ico" aria-hidden="true">📑</div>
            <div>Drag a PDF here (EOB, remit, aging or payer report), or</div>
            <label className="ui-btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Reading…' : '+ Choose a PDF'}
              <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} disabled={busy}
                onChange={e => { const l = e.target.files; pick(l); e.target.value = ''; }} />
            </label>
          </>
        )}
      </div>

      {file && (
        <Card>
          <Toolbar>
            <Check type="radio" inline name="extract-pages" checked={pagesMode === 'all'} onChange={() => setPagesMode('all')}>All pages</Check>
            <Check type="radio" inline name="extract-pages" checked={pagesMode === 'some'} onChange={() => setPagesMode('some')}>Only pages</Check>
            <input type="text" value={pagesText} placeholder="e.g. 2-5, 8" disabled={pagesMode !== 'some'}
              onChange={e => { setPagesText(e.target.value); setProblem(''); }} style={{ maxWidth: 140 }} aria-label="Pages to extract" />
            <Button variant="primary" onClick={extract} disabled={busy || !chosenReady} loading={busy}>
              {busy ? 'Working…' : 'Extract tables'}
            </Button>
            {busy && <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>}
            {busy && progress && <span className="ui-muted">{progress}</span>}
          </Toolbar>
          {chosen?.ocr && !busy && (
            <div className="ui-muted" style={{ marginTop: 'var(--ui-s2)' }}>
              The first time OCR is used on this computer it downloads its reading files (about 7 MB) from Helix Hub itself — after that it starts quickly.
            </div>
          )}
        </Card>
      )}

      {problem && <Notice tone="bad">⚠ {problem}</Notice>}

      {current && (
        <Card title="Preview">
          <div className="ui-stack">
            {detected && (
              <Notice tone="info">
                <span style={{ color: 'var(--text)' }}>
                  ✨ <strong>Detected:</strong> {detected}. Titles, page numbers and totals were moved out, wrapped lines joined
                  and every page lined up under the same columns.
                </span>
              </Notice>
            )}
            <Toolbar>
              <span className="ui-label">Layout:</span>
              <Tabs value={layoutNow} onChange={id => { setLayout(id); setTab(0); }} label="Layout"
                options={LAYOUTS.map(l => ({ value: l.id, label: `${l.label}${st?.auto === l.id ? ' (detected)' : ''}`, title: l.hint, disabled: !l.ok }))} />
            </Toolbar>

            {scannedPages.length > 0 && (
              <Notice tone="warn">
                ⚠ Page{scannedPages.length === 1 ? '' : 's'} {scannedPages.join(', ')} look{scannedPages.length === 1 ? 's' : ''} scanned (a picture of paper)
                {usedOcr
                  ? ' and couldn’t be read even with OCR — the scan may be too faint, blurry or handwritten.'
                  : <>, so no text could be read. Choose <strong>“In this browser with OCR (scanned PDFs)”</strong> above and extract again.</>}
              </Notice>
            )}
            {ocrPages > 0 && (
              <Notice tone={doubtful ? 'warn' : 'neutral'}>
                {ocrPages} scanned page{ocrPages === 1 ? ' was' : 's were'} read with OCR.
                {doubtful > 0
                  ? <> <strong>{doubtful} cell{doubtful === 1 ? '' : 's'}</strong> contain words OCR was unsure of — highlighted in yellow. Please check them (especially amounts) before using the file.</>
                  : ' OCR was confident about every word, but please still spot-check amounts.'}
              </Notice>
            )}

            {layoutNow === 'raw' ? (
              <div className="ui-stack">
                <Toolbar>
                  <select value={combine ? 'one' : 'per'} onChange={e => { setCombine(e.target.value === 'one'); setTab(0); }} aria-label="Excel tabs">
                    <option value="one">All pages in one Excel tab</option>
                    <option value="per">One Excel tab per page</option>
                  </select>
                  <Check inline checked={skipHeaders} onChange={e => setSkipHeaders(e.target.checked)}>Skip repeated header rows</Check>
                  <Check inline checked={asNumbers} onChange={e => setAsNumbers(e.target.checked)}>Treat amounts as numbers</Check>
                </Toolbar>

                {sheets.length > 1 && (
                  <div>
                    <Tabs value={Math.min(tab, sheets.length - 1)} onChange={setTab} label="Sheets" options={sheets.map((s, i) => ({ value: i, label: s.name }))} />
                  </div>
                )}

                {!sheet || sheet.rows.length === 0
                  ? <EmptyState compact title={`No table text found${scannedPages.length ? ' — the selected pages look scanned' : ''}.`} />
                  : (
                    <div className="ui-stack" style={{ gap: 6 }}>
                      <Table dense maxHeight={420}>
                        <tbody>
                          {sheet.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                            <tr key={i}>
                              {Array.from({ length: width }, (_, c) => {
                                const doubt = sheet.lows?.[i]?.has(c);
                                return (
                                  <td key={c} className={doubt ? 'mark' : undefined} title={doubt ? 'OCR was unsure of this — please check' : undefined}
                                    style={{ whiteSpace: 'nowrap' }}>
                                    {r[c] ?? ''}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                      {sheet.rows.length > PREVIEW_ROWS && (
                        <div className="ui-muted">Showing the first {PREVIEW_ROWS} of {sheet.rows.length.toLocaleString()} rows — the download has them all.</div>
                      )}
                    </div>
                  )}

                <Toolbar>
                  <label className="ui-label" htmlFor="xlsx-name">File name</label>
                  <input id="xlsx-name" type="text" value={outName} onChange={e => setOutName(e.target.value)} />
                  <Button variant="primary" disabled={!totalRows}
                    onClick={() => downloadXlsx(sheets, outName.trim() || 'extracted.xlsx', { numbersAsNumbers: asNumbers })}>
                    ⬇ Download Excel
                  </Button>
                </Toolbar>
                <div className="ui-muted">
                  Tables with merged cells or text wrapped onto several lines may need a little tidying in Excel.
                </div>
              </div>
            ) : (
              <StructuredPreview tables={structTables} other={structOther} edits={tableEdits} setTableEdit={setTableEdit}
                splitNames={splitNames} setSplitNames={setSplitNames} filter={filter} setFilter={setFilter}
                tab={tab} setTab={setTab} outName={outName} setOutName={setOutName} />
            )}
          </div>
        </Card>
      )}

      {setupFor && (
        <MethodSetup method={setupFor} config={config} user={user}
          onClose={() => setSetupFor(null)}
          onSaved={next => { setConfig(next); setSetupFor(null); }} />
      )}
    </div>
  );
}
