import { useState, useEffect, useMemo } from 'react';
import { readPdf, parsePageList } from '../../lib/pdfTools';
import {
  EXTRACT_METHODS, loadMethodConfig, saveMethodConfig, methodReady, extractTables, arrangeSheets, downloadXlsx,
} from '../../lib/pdfExtract';
import { logAudit } from '../../lib/audit';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

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
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm text-muted" style={{ marginBottom: 10 }}>
          {method.hint} What the service must accept and return is described in <code>docs/PDF_EXTRACTION_SERVER.md</code>.
        </p>
        {method.kind === 'supabase' ? (
          <div className="field">
            <label>Edge Function name</label>
            <input type="text" value={fn} onChange={e => { setFn(e.target.value); setError(''); }} placeholder="e.g. pdf-to-excel" />
          </div>
        ) : (
          <div className="field">
            <label>Service address</label>
            <input type="text" value={url} onChange={e => { setUrl(e.target.value); setError(''); }}
              placeholder={method.id === 'vercel' ? '/api/pdf-to-excel' : 'https://extract.yourcompany.com/pdf-to-excel'} />
          </div>
        )}
        {method.kind === 'url' && (
          <div className="field">
            <label>Access key (optional)</label>
            <input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" />
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              Use a key that only works for this service — signed-in users of this company can read it.
            </div>
          </div>
        )}
        <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', alignItems: 'flex-start', marginBottom: 10 }}>
          <input type="checkbox" checked={baa} onChange={e => { setBaa(e.target.checked); setError(''); }} style={{ marginTop: 2 }} />
          <span>We have a <strong>signed BAA</strong> with this provider that covers patient files sent to this service.</span>
        </label>
        <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', alignItems: 'center', marginBottom: 10 }}>
          <input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setError(''); }} />
          Switch this method on for everyone in this company
        </label>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
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
  const [result, setResult]   = useState(null);    // { key, pages, method }
  const [combine, setCombine] = useState(true);
  const [skipHeaders, setSkipHeaders] = useState(true);
  const [asNumbers, setAsNumbers] = useState(true);
  const [outName, setOutName] = useState('');
  const [tab, setTab]         = useState(0);
  const [dragOver, setDragOver] = useState(false);

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
    try {
      const out = await extractTables({
        methodId: method, config, file: file.file, bytes: file.bytes, pageNumbers,
        onProgress: (p, total) => setProgress(`Reading page ${p} of ${total}…`),
      });
      setResult({ key: runKey, pages: out.pages, method });
      logAudit({
        actor: user, action: 'pdf_to_excel', entityType: 'file_tool',
        details: {
          method: chosen.label, pages: out.pages.length,
          rows: out.pages.reduce((s, p) => s + p.rows.length, 0),
          scanned_pages: out.pages.filter(p => p.scanned).length,
        },
      });
    } catch (err) {
      setProblem(err.message || 'Extraction failed. Please try again.');
    }
    setProgress('');
    setBusy(false);
  }

  const sheets = useMemo(
    () => (current ? arrangeSheets(current.pages, { combine, skipRepeatedHeaders: skipHeaders }) : []),
    [current, combine, skipHeaders],
  );
  const scannedPages = current?.pages.filter(p => p.scanned).map(p => p.page) ?? [];
  const sheet = sheets[Math.min(tab, Math.max(sheets.length - 1, 0))];
  const width = sheet ? sheet.rows.reduce((m, r) => Math.max(m, r.length), 0) : 0;
  const totalRows = sheets.reduce((s, x) => s + x.rows.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Method */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>How should the PDF be read?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {EXTRACT_METHODS.map(m => {
            const ready = methodReady(m, config);
            const status = m.kind === 'browser' ? 'Ready' : m.kind === 'soon' ? 'Coming soon' : ready ? 'Ready (BAA confirmed)' : 'Needs setup';
            return (
              <div key={m.id} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="row text-sm" style={{ gap: 6, alignItems: 'center', cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.6 }}>
                  <input type="radio" name="extract-method" checked={method === m.id} disabled={!ready} onChange={() => setMethod(m.id)} />
                  <strong>{m.label}</strong>
                </label>
                <span className={`badge ${ready ? 'badge-green' : m.kind === 'soon' ? 'badge-gray' : 'badge-yellow'}`}>{status}</span>
                {isAdmin && (m.kind === 'url' || m.kind === 'supabase') && (
                  <button className="btn-sm" onClick={() => setSetupFor(m)}>⚙ Set up</button>
                )}
                <span className="text-sm text-muted" style={{ flexBasis: '100%', marginLeft: 22 }}>{m.hint}</span>
              </div>
            );
          })}
        </div>
        {chosen && chosen.kind !== 'browser' && chosenReady && (
          <div className="text-sm" style={{ color: 'var(--warning)', marginTop: 8 }}>
            ⚠ With this method the PDF is sent to the service your admin set up (BAA confirmed).
          </div>
        )}
      </div>

      {/* File */}
      <div
        className="card"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files); }}
        style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, textAlign: 'center', padding: 24 }}
      >
        {file ? (
          <div className="row" style={{ gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>📄 {file.name}</span>
            <span className="text-sm text-muted">{file.pageCount} page{file.pageCount === 1 ? '' : 's'}</span>
            <button className="btn-sm" onClick={() => { setFile(null); setResult(null); setProblem(''); }}>Choose another</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 28 }}>📑</div>
            <div style={{ margin: '6px 0 10px' }}>Drag a PDF here (EOB, remit, aging or payer report), or</div>
            <label className="btn-primary" style={{ cursor: busy ? 'wait' : 'pointer', display: 'inline-block' }}>
              {busy ? 'Reading…' : '+ Choose a PDF'}
              <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} disabled={busy}
                onChange={e => { const l = e.target.files; pick(l); e.target.value = ''; }} />
            </label>
          </>
        )}
      </div>

      {file && (
        <div className="card">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="row text-sm" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="extract-pages" checked={pagesMode === 'all'} onChange={() => setPagesMode('all')} /> All pages
            </label>
            <label className="row text-sm" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="extract-pages" checked={pagesMode === 'some'} onChange={() => setPagesMode('some')} /> Only pages
              <input type="text" value={pagesText} placeholder="e.g. 2-5, 8" disabled={pagesMode !== 'some'}
                onChange={e => { setPagesText(e.target.value); setProblem(''); }} style={{ maxWidth: 140 }} />
            </label>
            <button className="btn-primary" onClick={extract} disabled={busy || !chosenReady}>
              {busy ? 'Working…' : 'Extract tables'}
            </button>
            {busy && progress && <span className="text-sm text-muted">{progress}</span>}
          </div>
        </div>
      )}

      {problem && <div className="text-sm" style={{ color: 'var(--danger)' }}>⚠ {problem}</div>}

      {current && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">Preview ({totalRows.toLocaleString()} rows)</div>
          </div>

          {scannedPages.length > 0 && (
            <div className="text-sm" style={{ color: 'var(--warning)', marginBottom: 8 }}>
              ⚠ Page{scannedPages.length === 1 ? '' : 's'} {scannedPages.join(', ')} look{scannedPages.length === 1 ? 's' : ''} scanned (a picture of paper), so no text could be read.
              Scanned PDFs need OCR — coming in step 2.4b.
            </div>
          )}

          <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <label className="row text-sm" style={{ gap: 6, alignItems: 'center' }}>
              <select value={combine ? 'one' : 'per'} onChange={e => { setCombine(e.target.value === 'one'); setTab(0); }} style={{ maxWidth: 220 }}>
                <option value="one">All pages in one Excel tab</option>
                <option value="per">One Excel tab per page</option>
              </select>
            </label>
            <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={skipHeaders} onChange={e => setSkipHeaders(e.target.checked)} /> Skip repeated header rows
            </label>
            <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={asNumbers} onChange={e => setAsNumbers(e.target.checked)} /> Treat amounts as numbers
            </label>
          </div>

          {sheets.length > 1 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {sheets.map((s, i) => (
                <button key={s.name} className={i === tab ? 'btn-primary' : 'btn-sm'} onClick={() => setTab(i)}>{s.name}</button>
              ))}
            </div>
          )}

          {!sheet || sheet.rows.length === 0
            ? <div className="text-muted" style={{ padding: 12 }}>No table text found{scannedPages.length ? ' — the selected pages look scanned' : ''}.</div>
            : (
              <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table style={{ fontSize: 12 }}>
                  <tbody>
                    {sheet.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                      <tr key={i}>
                        {Array.from({ length: width }, (_, c) => <td key={c} style={{ whiteSpace: 'nowrap' }}>{r[c] ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sheet.rows.length > PREVIEW_ROWS && (
                  <div className="text-sm text-muted" style={{ padding: 6 }}>Showing the first {PREVIEW_ROWS} of {sheet.rows.length.toLocaleString()} rows — the download has them all.</div>
                )}
              </div>
            )}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            <label className="text-sm text-muted" htmlFor="xlsx-name">File name</label>
            <input id="xlsx-name" type="text" value={outName} onChange={e => setOutName(e.target.value)} style={{ maxWidth: 240 }} />
            <button className="btn-primary" disabled={!totalRows}
              onClick={() => downloadXlsx(sheets, outName.trim() || 'extracted.xlsx', { numbersAsNumbers: asNumbers })}>
              ⬇ Download Excel
            </button>
          </div>
          <div className="text-sm text-muted" style={{ marginTop: 6 }}>
            Tables with merged cells or text wrapped onto several lines may need a little tidying in Excel.
          </div>
        </div>
      )}

      {setupFor && (
        <MethodSetup method={setupFor} config={config} user={user}
          onClose={() => setSetupFor(null)}
          onSaved={next => { setConfig(next); setSetupFor(null); }} />
      )}
    </div>
  );
}
