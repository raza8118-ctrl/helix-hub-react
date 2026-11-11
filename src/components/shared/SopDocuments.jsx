import { useState, useEffect } from 'react';
import { loadSopDocuments, uploadSopDocument, hideSopDocument, sopDocumentLink, checkDocFile } from '../../lib/sopDocuments';
import { confirmDialog } from './Dialog';

/**
 * Reference documents on an SOP page (PO 2026-11-11): "📄 Open" for everyone who can see the SOP; editors (and the owner
 * inside the Master Library) can add a PDF or hide one. library = a Master Library SOP shown in a company (read-only).
 */
const size = b => (b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export default function SopDocuments({ sop, canEdit, library = false, user }) {
  const [docs, setDocs] = useState(undefined);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const editable = canEdit && !library;

  useEffect(() => {
    let alive = true;
    loadSopDocuments(sop.id, { master: library }).then(d => alive && setDocs(d));
    return () => { alive = false; };
  }, [sop.id, library, reload]);

  if (docs === null || (docs === undefined && !editable) || (docs?.length === 0 && !editable)) return null;

  async function open(d) {
    const w = window.open('', '_blank');   // opened now (before waiting) so pop-up blockers allow it
    if (w) w.opener = null;
    const url = await sopDocumentLink(d.path);
    if (url && w) w.location.href = url;
    else if (url) window.open(url, '_blank', 'noopener');
    else { w?.close(); setErr('The document could not be opened. Please try again.'); }
  }
  async function add() {
    setErr(''); setBusy(true);
    const r = await uploadSopDocument({ sopId: sop.id, file, title, user });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setAdding(false); setFile(null); setTitle(''); setReload(n => n + 1);
  }
  async function hide(d) {
    if (!await confirmDialog({ title: 'Hide this document?', message: `${d.title} — it stays stored and can be added again; nothing is deleted.`, confirmText: 'Hide', tone: 'warning' })) return;
    if (await hideSopDocument(d, user)) setReload(n => n + 1);
  }

  return (
    <div className="card mb-16 sop-docs">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Reference documents</strong>
        {editable && !adding && <button type="button" className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>📎 Add PDF</button>}
      </div>
      {docs === undefined && <div className="text-sm text-muted">Loading…</div>}
      {docs?.length === 0 && !adding && <div className="text-sm text-muted">No documents yet.</div>}
      {docs?.map(d => (
        <div key={d.id} className="sop-doc">
          <span>📄 {d.title}</span>
          <span className="text-sm text-muted">{size(d.size)}</span>
          <button type="button" className="btn-sm" onClick={() => open(d)}>Open</button>
          {editable && <button type="button" className="btn-sm" onClick={() => hide(d)} title="Hide (nothing is deleted)">Hide</button>}
        </div>
      ))}
      {adding && (
        <div className="sop-doc-add">
          <label className="ocd-field"><span className="text-sm">PDF file (max 25 MB)</span>
            <input type="file" accept="application/pdf,.pdf" onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); setErr(f ? checkDocFile(f) ?? '' : ''); if (f && !title) setTitle(f.name.replace(/\.pdf$/i, '')); }} />
          </label>
          <label className="ocd-field"><span className="text-sm">Title</span>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. ICD-10-CM Official Guidelines FY2027" />
          </label>
          <p className="text-sm text-muted" style={{ margin: 0 }}>Reference documents only — never patient information.</p>
          <div className="si-actions">
            <button type="button" className="btn-sm" onClick={() => { setAdding(false); setFile(null); setErr(''); }} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={add} disabled={busy || !file || !!checkDocFile(file)}>{busy ? 'Uploading…' : 'Add document'}</button>
          </div>
        </div>
      )}
      {err && <p className="ot-err" role="alert">{err}</p>}
    </div>
  );
}
