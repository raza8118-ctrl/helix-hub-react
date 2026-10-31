import { useState, useRef, useEffect } from 'react';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { readImageFile, buildImagesPdf, IMAGE_EXTENSIONS } from '../../lib/imageToPdf';
import { readSheets, buildSheetsPdf, SHEET_EXTENSIONS, BIG_SHEET_ROWS } from '../../lib/excelToPdf';
import PdfSaveOptions from './PdfSaveOptions';
import { Card, Button, Check, Field, Notice, EmptyState } from '../../components/ui';

const pdfName = (name, fallback) => { const n = (name ?? '').trim() || fallback; return /\.pdf$/i.test(n) ? n : `${n}.pdf`; };

function DropZone({ icon, text, accept, multiple, busy, onFiles, children }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`ui-drop${over ? ' over' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
    >
      <div className="ui-drop-ico" aria-hidden="true">{icon}</div>
      <div>{text}</div>
      <label className="ui-btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Reading…' : multiple ? '+ Choose files' : '+ Choose a file'}
        <input type="file" accept={accept} multiple={multiple} style={{ display: 'none' }} disabled={busy}
          onChange={e => { const l = e.target.files; onFiles(l); e.target.value = ''; }} />
      </label>
      {children}
    </div>
  );
}

// ── Images → PDF ──────────────────────────────────────────────────────────────

const tileBtn = { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: 'var(--text)' };

function ImageTile({ item, position, onRemove, onRotate }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  return (
    <div
      ref={setNodeRef}
      className="ui-page-tile"
      title={item.label}
      style={{
        transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 2 : undefined,
        width: 110, height: 'auto', padding: 6, justifyContent: 'flex-start', alignItems: 'stretch', border: '1px solid var(--border)',
      }}
      {...attributes}
      {...listeners}
    >
      <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface-2)', borderRadius: 8 }}>
        <img src={item.url} alt="" draggable={false}
          style={{ maxWidth: '100%', maxHeight: '100%', transform: `rotate(${item.rotation}deg)`, transition: 'transform 0.15s' }} />
      </div>
      <div className="ui-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <span className="ui-small bold">{position}</span>
        <span>
          <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => onRotate(item.key)} aria-label={`Rotate image ${position}`}
            style={tileBtn}>↻</button>
          <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => onRemove(item.key)} aria-label={`Remove image ${position}`}
            style={{ ...tileBtn, color: 'var(--ui-bad)' }}>✕</button>
        </span>
      </div>
      <div className="ui-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
    </div>
  );
}

/** Images → PDF (roadmap 2.3): JPG, PNG, WEBP, BMP, GIF, TIFF (multi-page) — one image per page. */
export function ImagesToPdf({ user }) {
  const [items, setItems]   = useState([]);   // [{ key, label, kind, bytes, aspect, rotation, url }]
  const [busy, setBusy]     = useState(false);
  const [problems, setProblems] = useState([]);
  const [pageSize, setPageSize] = useState('fit');
  const [margin, setMargin] = useState('none');
  const [outName, setOutName] = useState('images.pdf');
  const nextId = useRef(1);
  const itemsRef = useRef([]);

  // Free the preview images when leaving the page
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => itemsRef.current.forEach(i => URL.revokeObjectURL(i.url)), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  async function addFiles(list) {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setBusy(true);
    const added = [];
    const bad = [];
    for (const file of picked) {
      try {
        const pages = await readImageFile(file);
        pages.forEach((p, i) => added.push({
          ...p, key: `img-${nextId.current++}`, rotation: 0,
          label: pages.length > 1 ? `${file.name} · p${i + 1}` : file.name,
          url: URL.createObjectURL(new Blob([p.bytes], { type: p.kind === 'jpg' ? 'image/jpeg' : 'image/png' })),
        }));
      } catch (err) {
        bad.push(`${file.name}: ${err.message === 'heic' ? 'iPhone HEIC photos aren’t supported — save the photo as JPG and try again'
          : err.message === 'unsupported' ? 'not a supported image (JPG, PNG, WEBP, BMP, GIF, TIFF)'
          : 'damaged or unreadable image'}`);
      }
    }
    setItems(prev => [...prev, ...added]);
    setProblems(bad);
    setBusy(false);
  }

  function remove(key) {
    setItems(prev => {
      const gone = prev.find(i => i.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter(i => i.key !== key);
    });
  }
  const rotate = key => setItems(prev => prev.map(i => (i.key === key ? { ...i, rotation: (i.rotation + 90) % 360 } : i)));
  function startOver() {
    items.forEach(i => URL.revokeObjectURL(i.url));
    setItems([]); setProblems([]); setOutName('images.pdf');
  }
  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setItems(prev => {
      const from = prev.findIndex(i => i.key === active.id);
      const to   = prev.findIndex(i => i.key === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }

  const name = pdfName(outName, 'images.pdf');
  const outputs = items.length
    ? [{ name, build: () => buildImagesPdf(items, { pageSize, margin }) }]
    : [];

  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      <DropZone icon="🖼️" text="Drag images here (JPG, PNG, WEBP, BMP, GIF, TIFF — multi-page fax TIFFs too), or"
        accept={IMAGE_EXTENSIONS.map(x => `.${x}`).join(',')} multiple busy={busy} onFiles={addFiles}>
        {problems.length > 0 && (
          <Notice tone="bad" style={{ alignSelf: 'stretch', textAlign: 'left' }}>
            {problems.map(p => <div key={p}>⚠ {p}</div>)}
          </Notice>
        )}
      </DropZone>

      {items.length > 0 && (
        <>
          <Card title={`Pages (${items.length})`} actions={<Button size="sm" variant="ghost" onClick={startOver}>Start over</Button>}>
            <div className="ui-muted" style={{ marginBottom: 'var(--ui-s3)' }}>
              One image per page. Drag to reorder (press and hold on a phone), ↻ rotates, ✕ removes.
            </div>
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <SortableContext items={items.map(i => i.key)} strategy={rectSortingStrategy}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {items.map((it, i) => <ImageTile key={it.key} item={it} position={i + 1} onRemove={remove} onRotate={rotate} />)}
                </div>
              </SortableContext>
            </DndContext>
          </Card>

          <Card>
            <div className="ui-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <Field label="Page size" style={{ marginBottom: 0 }}>
                <select value={pageSize} onChange={e => setPageSize(e.target.value)}>
                  <option value="fit">Fit to image</option>
                  <option value="letter">Letter</option>
                  <option value="a4">A4</option>
                </select>
              </Field>
              <Field label="Margin" style={{ marginBottom: 0 }}>
                <select value={margin} onChange={e => setMargin(e.target.value)}>
                  <option value="none">None</option>
                  <option value="small">Small</option>
                </select>
              </Field>
              <Field label="File name" style={{ marginBottom: 0 }}>
                <input type="text" value={outName} onChange={e => setOutName(e.target.value)} />
              </Field>
            </div>
          </Card>
          <PdfSaveOptions
            outputs={outputs}
            resetKey={`${name}|${pageSize}|${margin}|${items.map(i => `${i.key}:${i.rotation}`).join(',')}`}
            user={user}
            auditAction="images_to_pdf"
            auditDetails={{ pages: items.length }}
          />
        </>
      )}
    </div>
  );
}

// ── Excel / CSV → PDF ─────────────────────────────────────────────────────────

/** Excel / CSV → PDF (roadmap 2.3): values and layout as a table; colours and fonts aren't copied. */
export function ExcelToPdf({ user }) {
  const [file, setFile]       = useState(null);   // { name, size }
  const [sheets, setSheets]   = useState([]);
  const [chosen, setChosen]   = useState([]);     // sheet names, in workbook order
  const [busy, setBusy]       = useState(false);
  const [problem, setProblem] = useState('');
  const [orientation, setOrientation] = useState('landscape');
  const [fitWidth, setFitWidth] = useState(true);
  const [header, setHeader]   = useState(true);
  const [outName, setOutName] = useState('');
  const [warnings, setWarnings] = useState(null);

  async function pick(list) {
    const f = list?.[0];
    if (!f) return;
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    if (!SHEET_EXTENSIONS.includes(ext)) return setProblem(`${f.name}: choose an Excel (.xlsx, .xls) or CSV file.`);
    setBusy(true); setProblem(''); setWarnings(null);
    try {
      const s = await readSheets(f);
      if (!s.length) { setProblem(`${f.name} has no data.`); setBusy(false); return; }
      setFile({ name: f.name, size: f.size });
      setSheets(s);
      setChosen(s.map(x => x.name));
      setOutName(f.name.replace(/\.(xlsx|xls|csv)$/i, '.pdf'));
    } catch {
      setProblem(`${f.name} couldn’t be read. If it’s password-protected, remove the password in Excel first.`);
    }
    setBusy(false);
  }

  function reset() { setFile(null); setSheets([]); setChosen([]); setProblem(''); setWarnings(null); }
  const toggle = n => setChosen(prev => (prev.includes(n) ? prev.filter(x => x !== n) : sheets.map(s => s.name).filter(x => x === n || prev.includes(x))));

  const selected = sheets.filter(s => chosen.includes(s.name));
  const totalRows = selected.reduce((s, x) => s + x.rows.length, 0);
  const name = pdfName(outName, 'spreadsheet.pdf');
  const outputs = selected.length
    ? [{
        name,
        build: async () => {
          const r = await buildSheetsPdf(selected, { orientation, fitWidth, header });
          setWarnings(r.warnings);
          return r.bytes;
        },
      }]
    : [];

  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      {!file ? (
        <DropZone icon="📊" text="Drag an Excel or CSV file here, or" accept=".xlsx,.xls,.csv" busy={busy} onFiles={pick}>
          {problem && <Notice tone="bad" style={{ alignSelf: 'stretch', textAlign: 'left' }}>⚠ {problem}</Notice>}
        </DropZone>
      ) : (
        <>
          <Card title={<span style={{ wordBreak: 'break-all' }}>📊 {file.name}</span>}
            actions={<Button size="sm" onClick={reset}>Choose another</Button>}>
            <div className="ui-label" style={{ marginBottom: 'var(--ui-s2)' }}>Sheets to include</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 var(--ui-s4)' }}>
              {sheets.map(s => (
                <Check key={s.name} checked={chosen.includes(s.name)} onChange={() => toggle(s.name)}>
                  {s.name} <span className="ui-text-muted">({s.rows.length.toLocaleString()} rows)</span>
                </Check>
              ))}
            </div>
            {totalRows > BIG_SHEET_ROWS && (
              <Notice tone="warn">
                {totalRows.toLocaleString()} rows — this may take a while and make a very long PDF.
              </Notice>
            )}
          </Card>

          <Card>
            <div className="ui-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <Field label="Orientation">
                <select value={orientation} onChange={e => setOrientation(e.target.value)}>
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </select>
              </Field>
              <Field label="File name">
                <input type="text" value={outName} onChange={e => setOutName(e.target.value)} />
              </Field>
            </div>
            <Check checked={fitWidth} onChange={e => setFitWidth(e.target.checked)}>Fit all columns on one page width</Check>
            <Check checked={header} onChange={e => setHeader(e.target.checked)}>First row is a header (repeat on every page)</Check>
            <div className="ui-muted">
              Values and layout are copied as Excel shows them. Colours, fonts, charts and pictures are not.
            </div>
            {warnings && (warnings.replaced > 0 || warnings.truncated > 0) && (
              <Notice tone="warn" style={{ marginTop: 'var(--ui-s2)' }}>
                {warnings.replaced > 0 && <div>⚠ {warnings.replaced} character{warnings.replaced === 1 ? '' : 's'} couldn’t be shown in the PDF font and appear as “?”.</div>}
                {warnings.truncated > 0 && <div>⚠ {warnings.truncated} cell{warnings.truncated === 1 ? ' was' : 's were'} cut short to fit (shown with “…”). Try Landscape, or turn off “Fit all columns”.</div>}
              </Notice>
            )}
          </Card>

          {selected.length > 0
            ? (
              <PdfSaveOptions
                outputs={outputs}
                resetKey={`${file.name}|${file.size}|${chosen.join(',')}|${orientation}|${fitWidth}|${header}|${name}`}
                user={user}
                auditAction="excel_to_pdf"
                auditDetails={{ sheets: selected.length, rows: totalRows }}
              />
            )
            : <EmptyState compact title="Tick at least one sheet." />}
        </>
      )}
    </div>
  );
}
