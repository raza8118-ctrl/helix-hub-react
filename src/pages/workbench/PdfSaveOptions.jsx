import { useState } from 'react';
import { downloadPdf } from '../../lib/pdfTools';
import { finalizePdf, QUALITY_LEVELS, levelLabel, fmtMb } from '../../lib/pdfCompress';
import { logAudit } from '../../lib/audit';
import { Card, Button, Tabs, Check, Notice, Item } from '../../components/ui';

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
    <Check type="radio" name={`save-mode-${auditAction}`} checked={mode === value} onChange={() => setMode(value)}>
      {label}
    </Check>
  );

  return (
    <Card title="Save">
      <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
        <div>
          {radio('original', <span><strong>Keep original size &amp; quality</strong></span>)}
          {radio('compress', <span><strong>Compress</strong> — choose a quality</span>)}
        </div>

        {mode === 'compress' && (
          <div className="ui-stack" style={{ marginLeft: 24, gap: 'var(--ui-s2)', marginBottom: 'var(--ui-s2)' }}>
            <div>
              <Tabs value={level} onChange={setLevel} label="Quality"
                options={QUALITY_LEVELS.map(l => ({ value: l.id, label: l.label, title: l.hint }))} />
            </div>
            <div className="ui-muted">{QUALITY_LEVELS.find(l => l.id === level)?.hint}. Pages with typed text are never changed — only scanned pages get smaller.</div>
            <div className="ui-row">
              <Check inline checked={limitOn} onChange={e => setLimitOn(e.target.checked)}>Must be under</Check>
              <input type="number" className="ui-input" min="1" step="0.5" value={maxMb} disabled={!limitOn}
                onChange={e => setMaxMb(e.target.value)} style={{ width: 80 }} aria-label="Size limit in MB" />
              <span className="ui-small">MB (portal upload limit)</span>
            </div>
          </div>
        )}

        <div className="ui-row">
          <Button variant="primary" onClick={prepare} disabled={busy || !outputs.length} loading={busy}>
            {busy ? 'Preparing…' : outputs.length > 1 ? `Prepare ${outputs.length} files` : 'Prepare file'}
          </Button>
          {busy && progress && <span className="ui-muted">{progress}</span>}
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>

      {results && (
        <div className="ui-stack" style={{ marginTop: 'var(--ui-s4)', gap: 'var(--ui-s2)' }}>
          {results.map(r => (
            <Item key={r.name}>
              <div className="ui-row" style={{ justifyContent: 'space-between' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{r.name}</div>
                  <div className="ui-muted">
                    {r.level === 'original'
                      ? `${fmtMb(r.finalSize)} · original quality`
                      : `${fmtMb(r.originalSize)} → ${fmtMb(r.finalSize)} · ${levelLabel(r.level)} quality`
                        + (r.compressedPages ? ` · ${r.compressedPages} scanned page${r.compressedPages === 1 ? '' : 's'} compressed` : '')}
                  </div>
                </div>
                <Button variant="primary" size="sm" onClick={() => downloadPdf(r.bytes, r.name)}>⬇ Download</Button>
              </div>
              {r.note && <Notice tone="warn">{r.note}</Notice>}
            </Item>
          ))}
          {results.length > 1 && (
            <div><Button size="sm" onClick={downloadAll}>⬇ Download all ({results.length})</Button></div>
          )}
        </div>
      )}
    </Card>
  );
}
