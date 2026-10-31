import { useState, useRef } from 'react';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { readPdf, buildPdf, parsePageList, parseRangeGroups } from '../../lib/pdfTools';
import PdfSaveOptions from './PdfSaveOptions';
import { ImagesToPdf, ExcelToPdf } from './ConvertTools';
import PdfToExcel from './PdfToExcel';
import AppealPacket from './AppealPacket';
import { peekPacketHandoff } from '../../lib/packetHandoff';
import { PageHeader, Card, Button, Tabs, Field, Notice, Toolbar, EmptyState } from '../../components/ui';

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
      className="ui-page-tile"
      title={`${file.name} — page ${page.index + 1}`}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 2 : undefined,
        border: `2px solid ${color}`,
      }}
      {...attributes}
      {...listeners}
    >
      <span className="ui-page-tile-n">{position}</span>
      <button
        type="button"
        className="ui-page-tile-x"
        onPointerDown={e => e.stopPropagation()}
        onClick={() => onRemove(page.key)}
        aria-label={`Remove page ${position}`}
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

  const pdfName = (() => { const n = outName.trim() || 'merged.pdf'; return /\.pdf$/i.test(n) ? n : `${n}.pdf`; })();
  const outputs = pages.length
    ? [{ name: pdfName, build: () => buildPdf(pages, new Map(files.map(f => [f.id, f.bytes]))) }]
    : [];

  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      {/* Add files */}
      <div
        className={`ui-drop${dragOver ? ' over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
      >
        <div className="ui-drop-ico" aria-hidden="true">📄</div>
        <div>Drag PDFs here, or</div>
        <label className="ui-btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Working…' : '+ Choose PDFs'}
          <input type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} disabled={busy}
            onChange={e => { const l = e.target.files; addFiles(l); e.target.value = ''; }} />
        </label>
        {problems.length > 0 && (
          <Notice tone="bad" style={{ alignSelf: 'stretch', textAlign: 'left' }}>
            {problems.map(p => <div key={p}>⚠ {p}</div>)}
          </Notice>
        )}
        {totalBytes > BIG_TOTAL_BYTES && (
          <Notice tone="warn" style={{ alignSelf: 'stretch', textAlign: 'left' }}>
            These files are large ({Math.round(totalBytes / 1048576)} MB). Merging may be slow on this computer.
          </Notice>
        )}
      </div>

      {files.length > 0 && (
        <>
          {/* Files */}
          <Card title={`Files (${files.length})`} actions={<Button size="sm" variant="ghost" onClick={startOver}>Start over</Button>}>
            <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
              {files.map((f, i) => (
                <div key={f.id} className="ui-row">
                  <span className="ui-file-letter" style={{ background: FILE_COLORS[i % FILE_COLORS.length] }}>{letterOf(i)}</span>
                  <span style={{ flex: 1, minWidth: 140, wordBreak: 'break-all' }}>{f.name}</span>
                  <span className="ui-muted">
                    {pages.filter(p => p.fileId === f.id).length} of {f.pageCount} page{f.pageCount === 1 ? '' : 's'}
                  </span>
                  <Button size="xs" onClick={() => moveFile(f.id, -1)} disabled={i === 0} aria-label="Move file up">▲</Button>
                  <Button size="xs" onClick={() => moveFile(f.id, 1)} disabled={i === files.length - 1} aria-label="Move file down">▼</Button>
                  <Button size="xs" variant="danger" onClick={() => removeFile(f.id)}>Remove</Button>
                </div>
              ))}
            </div>
          </Card>

          {/* Pages */}
          <Card title={`Pages in the new PDF (${pages.length})`}
            actions={
              <Toolbar>
                <input type="text" value={removeText} placeholder="Remove pages, e.g. 2, 5-7" aria-label="Pages to remove"
                  onChange={e => { setRemoveText(e.target.value); setRemoveError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') removeListed(); }} style={{ maxWidth: 200 }} />
                <Button size="sm" onClick={removeListed} disabled={!removeText.trim()}>Remove</Button>
              </Toolbar>
            }>
            {removeError && <Notice tone="bad" style={{ marginBottom: 'var(--ui-s2)' }}>{removeError}</Notice>}
            <div className="ui-muted" style={{ marginBottom: 'var(--ui-s3)' }}>
              Drag pages to change the order (press and hold on a phone). ✕ removes a page. The small number is the page’s position in the new PDF.
            </div>
            {pages.length === 0
              ? <EmptyState compact title="All pages removed — add files or start over." />
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
          </Card>

          {/* Save */}
          <Card>
            <Field label="File name" style={{ marginBottom: 0, maxWidth: 360 }}>
              <input id="merge-name" type="text" value={outName} onChange={e => setOutName(e.target.value)} />
            </Field>
          </Card>
          <PdfSaveOptions
            outputs={outputs}
            resetKey={`${pdfName}|${pages.map(p => p.key).join(',')}`}
            user={user}
            auditAction="merge_pdf"
            auditDetails={{ files: new Set(pages.map(p => p.fileId)).size, pages: pages.length }}
          />
        </>
      )}
    </div>
  );
}

const SPLIT_MODES = [
  { id: 'ranges', label: 'By page ranges' },
  { id: 'every',  label: 'Every N pages' },
  { id: 'each',   label: 'One file per page' },
];
const MAX_PARTS = 200;

/** Split a PDF (roadmap 2.2): by ranges, every N pages, or one file per page — in the browser. */
function SplitPdf({ user }) {
  const [file, setFile]     = useState(null);   // { name, pageCount, bytes, size }
  const [busy, setBusy]     = useState(false);
  const [problem, setProblem] = useState('');
  const [mode, setMode]     = useState('ranges');
  const [ranges, setRanges] = useState('');
  const [every, setEvery]   = useState('10');
  const [dragOver, setDragOver] = useState(false);

  async function pick(list) {
    const f = list?.[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return setProblem(`${f.name}: not a PDF`);
    setBusy(true); setProblem('');
    try {
      const { bytes, pageCount } = await readPdf(f);
      setFile({ name: f.name, pageCount, bytes, size: f.size });
      setRanges(pageCount > 1 ? `1-${Math.ceil(pageCount / 2)}, ${Math.ceil(pageCount / 2) + 1}-${pageCount}` : '1');
    } catch (err) {
      setProblem(err.message === 'password'
        ? `${f.name} is password-protected — remove the password in your PDF reader and try again.`
        : `${f.name} is damaged or not a real PDF.`);
    }
    setBusy(false);
  }

  // Work out the parts (0-based page indexes per part)
  let groups = [];
  let splitError = '';
  if (file) {
    if (mode === 'each') groups = Array.from({ length: file.pageCount }, (_, i) => [i]);
    else if (mode === 'every') {
      const n = parseInt(every, 10);
      if (!(n > 0)) splitError = 'Enter how many pages each file should have.';
      else for (let s = 0; s < file.pageCount; s += n) groups.push(Array.from({ length: Math.min(n, file.pageCount - s) }, (_, i) => s + i));
    } else {
      const res = parseRangeGroups(ranges, file.pageCount);
      if (res.error) splitError = res.error; else groups = res.groups;
    }
    if (groups.length > MAX_PARTS) { splitError = `That would make ${groups.length} files — the limit is ${MAX_PARTS}.`; groups = []; }
  }

  const base = (file?.name ?? 'document.pdf').replace(/\.pdf$/i, '');
  const rangeText = g => (g.length === 1 ? `page ${g[0] + 1}` : `pages ${g[0] + 1}–${g[g.length - 1] + 1}`);
  const outputs = groups.map((g, i) => ({
    name: `${base}-part${i + 1}.pdf`,
    build: () => buildPdf(g.map(index => ({ fileId: 1, index })), new Map([[1, file.bytes]])),
  }));

  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
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
            <Button size="sm" onClick={() => { setFile(null); setProblem(''); }}>Choose another</Button>
          </div>
        ) : (
          <>
            <div className="ui-drop-ico" aria-hidden="true">✂️</div>
            <div>Drag one PDF here, or</div>
            <label className="ui-btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Reading…' : '+ Choose a PDF'}
              <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} disabled={busy}
                onChange={e => { const l = e.target.files; pick(l); e.target.value = ''; }} />
            </label>
          </>
        )}
        {problem && <Notice tone="bad" style={{ alignSelf: 'stretch', textAlign: 'left' }}>⚠ {problem}</Notice>}
      </div>

      {file && (
        <>
          <Card title="How to split">
            <div style={{ marginBottom: 'var(--ui-s3)' }}>
              <Tabs value={mode} onChange={setMode} label="How to split" options={SPLIT_MODES.map(m => ({ value: m.id, label: m.label }))} />
            </div>
            {mode === 'ranges' && (
              <Field label="Page ranges — each comma makes a new file">
                <input type="text" value={ranges} onChange={e => setRanges(e.target.value)} placeholder="e.g. 1-3, 4-10, 11" />
              </Field>
            )}
            {mode === 'every' && (
              <div className="ui-row" style={{ marginBottom: 'var(--ui-s3)' }}>
                <span className="ui-small">A new file every</span>
                <input type="number" className="ui-input" min="1" value={every} onChange={e => setEvery(e.target.value)} style={{ width: 80 }} aria-label="Pages per file" />
                <span className="ui-small">pages</span>
              </div>
            )}
            {splitError
              ? <Notice tone="bad">{splitError}</Notice>
              : (
                <div className="ui-muted">
                  {groups.length} file{groups.length === 1 ? '' : 's'}:{' '}
                  {groups.slice(0, 12).map((g, i) => `Part ${i + 1} (${rangeText(g)})`).join(' · ')}
                  {groups.length > 12 ? ` · …and ${groups.length - 12} more` : ''}
                </div>
              )}
          </Card>

          {groups.length > 0 && (
            <PdfSaveOptions
              outputs={outputs}
              resetKey={`${file.name}|${file.size}|${groups.map(g => g.join('.')).join(',')}`}
              user={user}
              auditAction="split_pdf"
              auditDetails={{ pages: file.pageCount, parts: groups.length, split: mode }}
            />
          )}
        </>
      )}
    </div>
  );
}

const TOOLS = [
  { id: 'merge', label: 'Merge PDFs' },
  { id: 'split', label: 'Split PDF' },
  { id: 'images', label: 'Images → PDF' },
  { id: 'excel', label: 'Excel / CSV → PDF' },
  { id: 'pdfexcel', label: 'PDF → Excel' },
  { id: 'packet', label: 'Appeal Packet' },
];

/** File Tools (Workbench). 2.1 Merge, 2.2 Split + Original/Compress save step. Conversions come later. */
export default function FileTools({ user }) {
  // 5.5: open straight on the Appeal Packet when the Appeal Builder has handed an appeal over
  const [tool, setTool] = useState(() => (peekPacketHandoff() ? 'packet' : 'merge'));
  return (
    <div className="ui-page" style={{ maxWidth: 1000 }}>
      <PageHeader icon="📎" kicker="Workbench" title="File Tools" subtitle="Merge, split, reorder and compress PDFs." />

      <Notice tone="good" icon="🔒">
        <span style={{ color: 'var(--text)' }}>
          <strong>Files stay on this computer — nothing is uploaded.</strong> Safe for documents with patient information.
          {' '}<span className="ui-text-muted">(Only exception: PDF → Excel, if you pick a server method your admin has set up under a BAA — it says so on screen.)</span>
        </span>
      </Notice>

      <div>
        <Tabs value={tool} onChange={setTool} label="File tools" options={TOOLS.map(t => ({ value: t.id, label: t.label }))} />
      </div>

      {/* All tools stay mounted so switching between them doesn't lose work in progress */}
      <div style={{ display: tool === 'merge' ? 'block' : 'none' }}><MergePdfs user={user} /></div>
      <div style={{ display: tool === 'split' ? 'block' : 'none' }}><SplitPdf user={user} /></div>
      <div style={{ display: tool === 'images' ? 'block' : 'none' }}><ImagesToPdf user={user} /></div>
      <div style={{ display: tool === 'excel' ? 'block' : 'none' }}><ExcelToPdf user={user} /></div>
      <div style={{ display: tool === 'pdfexcel' ? 'block' : 'none' }}><PdfToExcel user={user} /></div>
      <div style={{ display: tool === 'packet' ? 'block' : 'none' }}><AppealPacket user={user} /></div>
    </div>
  );
}
