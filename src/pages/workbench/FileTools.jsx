import { useState, useRef } from 'react';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { readPdf, buildPdf, parsePageList, downloadPdf } from '../../lib/pdfTools';
import { logAudit } from '../../lib/audit';

// Colour + letter per file so its pages are easy to spot
const FILE_COLORS = ['#7c3aed', '#0284c7', '#059669', '#d97706', '#dc2626', '#db2777', '#4f46e5', '#0d9488'];
const letterOf = i => String.fromCharCode(65 + (i % 26));
const BIG_TOTAL_BYTES = 150 * 1024 * 1024;

function PageTile({ page, position, file, fileIdx, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key });
  const color = FILE_COLORS[fileIdx % FILE_COLORS.length];
  return (
    <div
      ref={setNodeRef}
      title={`${file.name} — page ${page.index + 1}`}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 2 : undefined,
        width: 92, height: 118, borderRadius: 8, position: 'relative',
        border: `2px solid ${color}`, background: 'var(--surface)', boxShadow: 'var(--shadow)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        cursor: 'grab', touchAction: 'none', userSelect: 'none',
      }}
      {...attributes}
      {...listeners}
    >
      <span style={{ position: 'absolute', top: 4, left: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{position}</span>
      <button
        type="button"
        onPointerDown={e => e.stopPropagation()}
        onClick={() => onRemove(page.key)}
        aria-label={`Remove page ${position}`}
        style={{ position: 'absolute', top: 2, right: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)', fontSize: 14 }}
      >✕</button>
      <span style={{ fontSize: 22, fontWeight: 800, color }}>{letterOf(fileIdx)}</span>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>p{page.index + 1}</span>
    </div>
  );
}

/** Merge PDFs (roadmap 2.1): combine files, reorder and delete pages, download — all in the browser. */
function MergePdfs({ user }) {
  const [files, setFiles]   = useState([]);   // [{ id, name, pageCount, bytes, size }]
  const [pages, setPages]   = useState([]);   // [{ key, fileId, index }] in output order
  const [busy, setBusy]     = useState(false);
  const [problems, setProblems] = useState([]);
  const [removeText, setRemoveText] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [outName, setOutName] = useState('merged.pdf');
  const [dragOver, setDragOver] = useState(false);
  const nextId = useRef(1);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const fileById  = new Map(files.map(f => [f.id, f]));
  const fileIndex = new Map(files.map((f, i) => [f.id, i]));
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  async function addFiles(list) {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setBusy(true);
    const added = [];
    const bad = [];
    for (const file of picked) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { bad.push(`${file.name}: not a PDF`); continue; }
      try {
        const { bytes, pageCount } = await readPdf(file);
        added.push({ id: nextId.current++, name: file.name, pageCount, bytes, size: file.size });
      } catch (err) {
        bad.push(`${file.name}: ${err.message === 'password'
          ? 'password-protected — remove the password in your PDF reader and try again'
          : 'damaged or not a real PDF'}`);
      }
    }
    setFiles(prev => [...prev, ...added]);
    setPages(prev => [...prev, ...added.flatMap(f => Array.from({ length: f.pageCount }, (_, i) => ({ key: `${f.id}-${i}`, fileId: f.id, index: i })))]);
    setProblems(bad);
    setBusy(false);
  }

  // Moving a file re-groups the pages by file order, keeping each file's page order and deletions
  function moveFile(id, dir) {
    const i = files.findIndex(f => f.id === id);
    const j = i + dir;
    if (j < 0 || j >= files.length) return;
    const order = arrayMove(files, i, j);
    setFiles(order);
    setPages(prev => order.flatMap(f => prev.filter(p => p.fileId === f.id)));
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id));
    setPages(prev => prev.filter(p => p.fileId !== id));
  }

  function removePage(key) { setPages(prev => prev.filter(p => p.key !== key)); }

  function removeListed() {
    const res = parsePageList(removeText, pages.length);
    if (res.error) return setRemoveError(res.error);
    const drop = new Set(res.pages.map(n => pages[n - 1].key));
    setPages(prev => prev.filter(p => !drop.has(p.key)));
    setRemoveText(''); setRemoveError('');
  }

  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setPages(prev => {
      const from = prev.findIndex(p => p.key === active.id);
      const to   = prev.findIndex(p => p.key === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }

  function startOver() {
    setFiles([]); setPages([]); setProblems([]); setRemoveText(''); setRemoveError(''); setOutName('merged.pdf');
  }

  async function download() {
    if (!pages.length) return;
    setBusy(true);
    try {
      const bytes = await buildPdf(pages, new Map(files.map(f => [f.id, f.bytes])));
      downloadPdf(bytes, outName.trim() || 'merged.pdf');
      // Counts only — file names can contain patient names
      logAudit({ actor: user, action: 'merge_pdf', entityType: 'file_tool', details: { files: new Set(pages.map(p => p.fileId)).size, pages: pages.length } });
    } catch {
      setProblems(['Something went wrong while building the PDF. Try removing the last file you added.']);
    }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add files */}
      <div
        className="card"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, textAlign: 'center', padding: 24 }}
      >
        <div style={{ fontSize: 28 }}>📄</div>
        <div style={{ margin: '6px 0 10px' }}>Drag PDFs here, or</div>
        <label className="btn-primary" style={{ cursor: busy ? 'wait' : 'pointer', display: 'inline-block' }}>
          {busy ? 'Working…' : '+ Choose PDFs'}
          <input type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} disabled={busy}
            onChange={e => { const l = e.target.files; addFiles(l); e.target.value = ''; }} />
        </label>
        {problems.length > 0 && (
          <div style={{ marginTop: 10, textAlign: 'left' }}>
            {problems.map(p => <div key={p} className="text-sm" style={{ color: 'var(--danger)' }}>⚠ {p}</div>)}
          </div>
        )}
        {totalBytes > BIG_TOTAL_BYTES && (
          <div className="text-sm" style={{ color: 'var(--warning)', marginTop: 8 }}>
            These files are large ({Math.round(totalBytes / 1048576)} MB). Merging may be slow on this computer.
          </div>
        )}
      </div>

      {files.length > 0 && (
        <>
          {/* Files */}
          <div className="card">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title">Files ({files.length})</div>
              <button className="btn-sm" onClick={startOver}>Start over</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f, i) => (
                <div key={f.id} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 6, color: '#fff', fontWeight: 800, flexShrink: 0,
                    background: FILE_COLORS[i % FILE_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{letterOf(i)}</span>
                  <span style={{ flex: 1, minWidth: 140, wordBreak: 'break-all' }}>{f.name}</span>
                  <span className="text-sm text-muted">
                    {pages.filter(p => p.fileId === f.id).length} of {f.pageCount} page{f.pageCount === 1 ? '' : 's'}
                  </span>
                  <button className="btn-sm" onClick={() => moveFile(f.id, -1)} disabled={i === 0} aria-label="Move file up">▲</button>
                  <button className="btn-sm" onClick={() => moveFile(f.id, 1)} disabled={i === files.length - 1} aria-label="Move file down">▼</button>
                  <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeFile(f.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          {/* Pages */}
          <div className="card">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title">Pages in the new PDF ({pages.length})</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="text" value={removeText} placeholder="Remove pages, e.g. 2, 5-7" style={{ maxWidth: 190 }}
                  onChange={e => { setRemoveText(e.target.value); setRemoveError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') removeListed(); }} />
                <button className="btn-sm" onClick={removeListed} disabled={!removeText.trim()}>Remove</button>
              </div>
            </div>
            {removeError && <div className="text-sm" style={{ color: 'var(--danger)', marginBottom: 8 }}>{removeError}</div>}
            <div className="text-sm text-muted" style={{ marginBottom: 10 }}>
              Drag pages to change the order (press and hold on a phone). ✕ removes a page. The small number is the page’s position in the new PDF.
            </div>
            {pages.length === 0
              ? <div className="text-muted" style={{ padding: 12 }}>All pages removed — add files or start over.</div>
              : (
                <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                  <SortableContext items={pages.map(p => p.key)} strategy={rectSortingStrategy}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {pages.map((p, i) => (
                        <PageTile key={p.key} page={p} position={i + 1} file={fileById.get(p.fileId)}
                          fileIdx={fileIndex.get(p.fileId)} onRemove={removePage} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
          </div>

          {/* Save */}
          <div className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="text-sm text-muted" htmlFor="merge-name">File name</label>
              <input id="merge-name" type="text" value={outName} onChange={e => setOutName(e.target.value)} style={{ maxWidth: 260 }} />
              <button className="btn-primary" onClick={download} disabled={busy || pages.length === 0}>
                {busy ? 'Building…' : `⬇ Download merged PDF (${pages.length} page${pages.length === 1 ? '' : 's'})`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** File Tools (Workbench). 2.1: Merge PDFs. Split / compress and conversions arrive in later steps. */
export default function FileTools({ user }) {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">📎 File Tools</div>
          <div className="page-subtitle">Merge, reorder and remove PDF pages.</div>
        </div>
      </div>

      <div className="card mb-16" style={{ borderLeft: '4px solid var(--success)', padding: '10px 14px' }}>
        <span className="text-sm">🔒 <strong>Files stay on this computer — nothing is uploaded.</strong> Safe for documents with patient information.</span>
      </div>

      <div className="row mb-16" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-primary">Merge PDFs</button>
        <button className="btn-sm" disabled title="Coming in the next update">Split / Compress (soon)</button>
        <button className="btn-sm" disabled title="Coming later">Convert to PDF (soon)</button>
      </div>

      <MergePdfs user={user} />
    </div>
  );
}
