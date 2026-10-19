import { useState } from 'react';
import { downloadPdf } from '../../lib/pdfTools';
import { finalizePdf, QUALITY_LEVELS, levelLabel, fmtMb } from '../../lib/pdfCompress';
import { logAudit } from '../../lib/audit';

/**
 * Save step for every File Tools result (roadmap 2.2): keep original size & quality, or
 * compress at High / Medium / Low, optionally under a size limit. Shows the size before
 * download. outputs = [{ name, build: () => Promise<Uint8Array> }]; resetKey changes
 * whenever the outputs change so old results are cleared.
 * Audit: counts and the quality choice only — never file names.
 */
export default function PdfSaveOptions({ outputs, resetKey, user, auditAction, auditDetails }) {
  const [mode, setMode]     = useState('original');
  const [level, setLevel]   = useState('medium');
  const [limitOn, setLimitOn] = useState(false);
  const [maxMb, setMaxMb]   = useState('10');
  const [busy, setBusy]     = useState(false);
  const [progress, setProgress] = useState('');
  const [prepared, setPrepared] = useState(null);   // { key, list: [{ name, bytes, level, originalSize, finalSize, compressedPages, note }] }
  const [error, setError]   = useState('');

  // Results only show while the pages, files and settings are the ones they were made from
  const currentKey = JSON.stringify([resetKey, mode, level, limitOn, maxMb]);
  const results = prepared?.key === currentKey ? prepared.list : null;

  async function prepare() {
    setBusy(true); setError(''); setPrepared(null);
    const choice = { mode, level, maxMb: mode === 'compress' && limitOn ? parseFloat(maxMb) || 0 : 0 };
    const done = [];
    try {
      for (let i = 0; i < outputs.length; i++) {
        const o = outputs[i];
        const prefix = outputs.length > 1 ? `File ${i + 1} of ${outputs.length}: ` : '';
        setProgress(`${prefix}building…`);
        const original = await o.build();
        const r = await finalizePdf(original, choice, (p, total) => setProgress(`${prefix}compressing page ${p} of ${total}…`));
        done.push({ name: o.name, ...r });
      }
      setPrepared({ key: currentKey, list: done });
      logAudit({
        actor: user, action: auditAction, entityType: 'file_tool',
        details: {
          ...auditDetails, outputs: done.length,
          quality: mode === 'compress' ? level : 'original',
          ...(choice.maxMb ? { size_limit_mb: choice.maxMb } : {}),
        },
      });
    } catch {
      setError('Something went wrong while preparing the PDF. Try Keep original, or remove the last file you added.');
    }
    setProgress('');
    setBusy(false);
  }

  async function downloadAll() {
    for (const r of results) {
      downloadPdf(r.bytes, r.name);
      await new Promise(res => setTimeout(res, 600));   // browsers block rapid-fire downloads
    }
  }

  const radio = (value, label) => (
    <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', alignItems: 'center' }}>
      <input type="radio" name={`save-mode-${auditAction}`} checked={mode === value} onChange={() => setMode(value)} />
      {label}
    </label>
  );

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 10 }}>Save</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {radio('original', <span><strong>Keep original size &amp; quality</strong></span>)}
        {radio('compress', <span><strong>Compress</strong> — choose a quality</span>)}

        {mode === 'compress' && (
          <div style={{ marginLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {QUALITY_LEVELS.map(l => (
                <button key={l.id} type="button" onClick={() => setLevel(l.id)}
                  className={level === l.id ? 'btn-primary' : 'btn-sm'} title={l.hint}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="text-sm text-muted">{QUALITY_LEVELS.find(l => l.id === level)?.hint}. Pages with typed text are never changed — only scanned pages get smaller.</div>
            <label className="row text-sm" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="checkbox" checked={limitOn} onChange={e => setLimitOn(e.target.checked)} />
              Must be under
              <input type="number" min="1" step="0.5" value={maxMb} disabled={!limitOn}
                onChange={e => setMaxMb(e.target.value)} style={{ width: 70 }} />
              MB (portal upload limit)
            </label>
          </div>
        )}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-primary" onClick={prepare} disabled={busy || !outputs.length}>
            {busy ? 'Preparing…' : outputs.length > 1 ? `Prepare ${outputs.length} files` : 'Prepare file'}
          </button>
          {busy && progress && <span className="text-sm text-muted">{progress}</span>}
        </div>
        {error && <div className="text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>

      {results && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map(r => (
            <div key={r.name} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}>
              <div className="row" style={{ gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{r.name}</div>
                  <div className="text-sm text-muted">
                    {r.level === 'original'
                      ? `${fmtMb(r.finalSize)} · original quality`
                      : `${fmtMb(r.originalSize)} → ${fmtMb(r.finalSize)} · ${levelLabel(r.level)} quality`
                        + (r.compressedPages ? ` · ${r.compressedPages} scanned page${r.compressedPages === 1 ? '' : 's'} compressed` : '')}
                  </div>
                </div>
                <button className="btn-primary" onClick={() => downloadPdf(r.bytes, r.name)}>⬇ Download</button>
              </div>
              {r.note && <div className="text-sm" style={{ color: 'var(--warning)', marginTop: 6 }}>{r.note}</div>}
            </div>
          ))}
          {results.length > 1 && (
            <button className="btn-sm" style={{ alignSelf: 'flex-start' }} onClick={downloadAll}>⬇ Download all ({results.length})</button>
          )}
        </div>
      )}
    </div>
  );
}
