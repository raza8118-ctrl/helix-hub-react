import { useState, useRef, useEffect } from 'react';
import Modal from '../shared/Modal';
import { icdImportBatch, icdRetireMissing, icdImportDone } from '../../lib/owner';

/**
 * Owner → Master Library → Code lists → "ICD-10-CM yearly update" (PO 2026-11-11; migration 55). The four CSV files are
 * read in a background worker (the page never freezes) and saved into the MASTER in batches of 1,000 with a progress bar.
 * Codes → coding notes → index terms → changes; then codes missing from the new year are marked retired (never deleted).
 * Re-running is safe (same rows are recognised) and resumes where an interrupted file stopped. Reference data only.
 */
const ORDER = ['codes', 'notes', 'index', 'changes'];
const LABEL = { codes: 'Codes', notes: 'Coding notes', index: 'Index terms', changes: 'FY changes' };
const BATCH = 1000;
const resumeKey = (fy, f) => `helix.icd.${fy}.${f.name}.${f.size}`;
const getResume = k => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const setResume = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* private window */ } };

function readWithWorker(file) {
  const worker = new Worker(new URL('../../workers/icdCsv.worker.js', import.meta.url), { type: 'module' });
  const ask = msg => new Promise(resolve => {
    worker.onmessage = e => resolve(e.data);
    worker.postMessage(msg);
  });
  return { load: () => ask({ cmd: 'load', file }), batch: start => ask({ cmd: 'batch', start, size: BATCH }), stop: () => worker.terminate() };
}

export default function IcdImport({ owner, onClose }) {
  const [files, setFiles] = useState([]);       // [{ file, kind, total, fy, error, worker }]
  const [fy, setFy] = useState(2027);
  const [progress, setProgress] = useState({}); // kind → { done, total, saved, state: 'waiting' | 'running' | 'done' | 'error', msg }
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(null);
  const [err, setErr] = useState('');
  const stopRef = useRef(false);

  useEffect(() => () => files.forEach(f => f.worker?.stop()), [files]);

  async function pick(list) {
    setErr(''); setFinished(null); setProgress({});
    files.forEach(f => f.worker?.stop());
    const out = [];
    for (const file of list) {
      const w = readWithWorker(file);
      const r = await w.load();
      out.push({ file, worker: w, kind: r.kind, total: r.total, fy: r.fy, error: r.error });
    }
    const seen = new Set();
    const clean = out.filter(f => !f.kind || (seen.has(f.kind) ? (f.worker.stop(), false) : seen.add(f.kind)));
    clean.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    setFiles(clean);
    const year = clean.find(f => f.fy)?.fy;
    if (year) setFy(year);
  }

  const ready = files.filter(f => f.kind);
  const hasCodes = ready.some(f => f.kind === 'codes');

  async function run() {
    setRunning(true); setErr(''); stopRef.current = false;
    const summary = {};
    for (const f of ready) {
      const key = resumeKey(fy, f.file);
      let start = getResume(key);
      let saved = 0;
      setProgress(p => ({ ...p, [f.kind]: { done: start, total: f.total, saved: 0, state: 'running' } }));
      while (start < f.total) {
        if (stopRef.current) { setRunning(false); setProgress(p => ({ ...p, [f.kind]: { ...p[f.kind], state: 'waiting', msg: 'Paused — Import again continues here' } })); return; }
        const b = await f.worker.batch(start);
        let r = await icdImportBatch(owner, f.kind, fy, f.file.name, b.rows);
        if (r.error || r.data?.ok === false) r = await icdImportBatch(owner, f.kind, fy, f.file.name, b.rows);   // one retry (network blip)
        if (r.error || r.data?.ok === false) {
          const msg = r.error === 'NOT_SET_UP' ? 'The database update (migration 55) has not been run yet.' : (r.error ?? r.data.error);
          setProgress(p => ({ ...p, [f.kind]: { ...p[f.kind], state: 'error', msg: `Stopped at row ${start + 1}: ${msg}` } }));
          setErr('The import stopped. Fix the problem and click Import again — it continues where it stopped.');
          setRunning(false);
          return;
        }
        saved += r.data.saved ?? 0;
        start += b.rows.length;
        setResume(key, start);
        setProgress(p => ({ ...p, [f.kind]: { done: start, total: f.total, saved, state: 'running' } }));
      }
      setResume(key, null);
      summary[f.kind] = { rows: f.total, saved };
      await icdImportDone(owner, fy, f.file.name, { kind: f.kind, rows: f.total, saved });
      setProgress(p => ({ ...p, [f.kind]: { done: f.total, total: f.total, saved, state: 'done' } }));
    }
    let retired = null;
    if (hasCodes) {
      setProgress(p => ({ ...p, retire: { state: 'running' } }));
      const r = await icdRetireMissing(owner, fy);
      retired = r.data?.retired ?? null;
      setProgress(p => ({ ...p, retire: { state: r.error ? 'error' : 'done', msg: r.error } }));
    }
    setFinished({ summary, retired });
    setRunning(false);
  }

  const pct = p => (p?.total ? Math.round((p.done / p.total) * 100) : 0);
  return (
    <Modal title="ICD-10-CM yearly update — Master Library" onClose={running ? () => {} : onClose} wide>
      <p className="text-sm" style={{ marginTop: 0 }}>
        Pick the four CSV files (codes, coding notes, index terms, FY changes). They are read in your browser and saved into the
        Master Library, so every company sees them. Codes missing from the new year are marked <strong>Retired</strong> — nothing is deleted.
      </p>
      {!running && !finished && (
        <label className="si-drop">
          <input type="file" accept=".csv" multiple onChange={e => pick([...(e.target.files ?? [])])} />
          <span>⬆ Choose the CSV files (you can pick all four at once)</span>
        </label>
      )}
      {files.length > 0 && (
        <>
          <div className="si-row">
            <label className="text-sm si-hrow">Fiscal year <input type="number" min={2015} max={2100} value={fy} disabled={running}
              onChange={e => setFy(Number(e.target.value) || fy)} aria-label="Fiscal year" style={{ width: 80 }} /></label>
            <span className="text-sm text-muted">New codes are valid from Oct 1, {fy - 1}; retired codes stop on that date.</span>
          </div>
          <div className="icd-files">
            {files.map(f => {
              const p = progress[f.kind];
              return (
                <div key={f.file.name} className="icd-file">
                  <div className="si-row" style={{ margin: 0 }}>
                    <strong>{f.kind ? LABEL[f.kind] : 'Not recognised'}</strong>
                    <span className="text-sm text-muted">{f.file.name}{f.total != null ? ` · ${f.total.toLocaleString()} rows` : ''}</span>
                    {getResume(resumeKey(fy, f.file)) > 0 && !p && <span className="badge badge-yellow">continues at row {(getResume(resumeKey(fy, f.file)) + 1).toLocaleString()}</span>}
                  </div>
                  {f.error && <p className="ot-err" style={{ margin: '4px 0 0' }}>{f.error}</p>}
                  {p && (
                    <>
                      <div className="icd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(p)} aria-label={`${LABEL[f.kind]} progress`}>
                        <i style={{ width: `${pct(p)}%` }} className={p.state === 'error' ? 'bad' : p.state === 'done' ? 'ok' : ''} />
                      </div>
                      <div className="text-sm text-muted">
                        {p.done.toLocaleString()} of {p.total.toLocaleString()} ({pct(p)}%){p.state === 'done' ? ' ✓' : ''}{p.msg ? ` — ${p.msg}` : ''}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {progress.retire && (
              <div className="icd-file text-sm">
                {progress.retire.state === 'running' ? 'Marking codes that are not in the new year as retired…' : progress.retire.state === 'done' ? '✓ Codes not in the new year marked retired.' : `Retiring failed: ${progress.retire.msg}`}
              </div>
            )}
          </div>
          {!hasCodes && ready.length > 0 && <p className="text-sm text-muted">Without the codes file, no codes are marked retired.</p>}
        </>
      )}
      {err && <p className="ot-err" role="alert">{err}</p>}
      {finished && (
        <p>✓ ICD-10-CM FY{fy} saved in the Master Library{finished.retired != null ? ` — ${finished.retired.toLocaleString()} code${finished.retired === 1 ? '' : 's'} marked retired` : ''}. Logged in your owner log.</p>
      )}
      <div className="si-actions">
        {running
          ? <button type="button" className="btn-sm" onClick={() => { stopRef.current = true; }}>Pause</button>
          : <button type="button" className="btn-sm" onClick={onClose}>{finished ? 'Close' : 'Cancel'}</button>}
        {!finished && <button type="button" className="btn-primary" disabled={running || !ready.length} onClick={run}>{running ? 'Importing…' : `Import ${ready.length} file${ready.length === 1 ? '' : 's'}`}</button>}
      </div>
    </Modal>
  );
}
