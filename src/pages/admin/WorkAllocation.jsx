import { useState, useEffect, useRef, useMemo } from 'react';
import { S, kv } from '../../lib/supabase';
import { parseExcelFile } from '../../lib/helpers';

// ── Column filter dropdown ────────────────────────────────────────────────────
function ColFilter({ col, values, selected, onToggle, onSelectAll, onClear, sortDir, onSort, onClose }) {
  const ref = useRef(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const visible = search.trim()
    ? values.filter(v => v.toLowerCase().includes(search.trim().toLowerCase()))
    : values;

  const allVisibleSelected = visible.length > 0 && visible.every(v => selected.has(v));

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, zIndex: 100,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)',
      minWidth: 200, maxWidth: 260, padding: '10px 0',
    }}
      onClick={e => e.stopPropagation()}
    >
      {/* Sort buttons */}
      <div style={{ display: 'flex', gap: 6, padding: '0 10px 8px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
        <button
          className="btn-sm"
          style={{ flex: 1, ...(sortDir === 'asc' ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}) }}
          onClick={() => onSort('asc')}
        >↑ A → Z</button>
        <button
          className="btn-sm"
          style={{ flex: 1, ...(sortDir === 'desc' ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}) }}
          onClick={() => onSort('desc')}
        >↓ Z → A</button>
      </div>

      {/* Search within values */}
      {values.length > 8 && (
        <div style={{ padding: '0 10px 6px' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ width: '100%', padding: '4px 8px', fontSize: 12, color: 'var(--text)', background: 'var(--surface)' }}
            autoFocus
          />
        </div>
      )}

      {/* Select all / clear */}
      <div style={{ display: 'flex', gap: 8, padding: '0 10px 6px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
        <button
          className="btn-sm"
          style={{ fontSize: 11, padding: '2px 8px' }}
          onClick={() => onSelectAll(visible)}
        >
          {allVisibleSelected ? '☑ Deselect all' : '☐ Select all'}
        </button>
        {selected.size > 0 && (
          <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--danger)' }} onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {/* Checkbox list */}
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '0 6px' }}>
        {visible.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</div>
        )}
        {visible.map(v => (
          <label key={v} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px',
            cursor: 'pointer', borderRadius: 4, fontSize: 12,
            background: selected.has(v) ? 'var(--accent-dim)' : 'transparent',
            color: selected.has(v) ? 'var(--accent)' : 'var(--text)',
          }}>
            <input
              type="checkbox"
              checked={selected.has(v)}
              onChange={() => onToggle(v)}
              style={{ width: 'auto', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WorkAllocation({ user }) {
  const [file, setFile]         = useState(null);
  const [parsed, setParsed]     = useState(null);
  // filters: { col: Set<string> }  — multi-select per column
  const [filters, setFilters]   = useState({});
  // sort: { col, dir: 'asc'|'desc' } or null
  const [sort, setSort]         = useState(null);
  const [openCol, setOpenCol]   = useState(null); // which column's dropdown is open
  const [empId, setEmpId]       = useState('');
  const [note, setNote]         = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [allocating, setAllocating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const fileInput               = useRef(null);

  useEffect(() => { S.get('users', { active: true }).then(u => setAllUsers(u ?? [])); }, []);

  async function handleFile(f) {
    if (!f) return;
    setFile(f);
    setError(''); setSuccess('');
    setParsed(null); setFilters({}); setSort(null);
    setParsing(true);
    try {
      const result = await parseExcelFile(f);
      setParsed(result);
    } catch (err) {
      setError(`Parse error: ${err.message}`);
    }
    setParsing(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function toggleValue(col, val) {
    setFilters(prev => {
      const next = { ...prev };
      const set = new Set(next[col] ?? []);
      if (set.has(val)) set.delete(val); else set.add(val);
      if (set.size === 0) delete next[col]; else next[col] = set;
      return next;
    });
  }

  function selectAll(col, vals) {
    setFilters(prev => {
      const next = { ...prev };
      const existing = new Set(next[col] ?? []);
      const allSelected = vals.every(v => existing.has(v));
      if (allSelected) {
        // deselect all visible
        const updated = new Set([...existing].filter(v => !vals.includes(v)));
        if (updated.size === 0) delete next[col]; else next[col] = updated;
      } else {
        next[col] = new Set([...existing, ...vals]);
      }
      return next;
    });
  }

  function clearFilter(col) {
    setFilters(prev => { const n = { ...prev }; delete n[col]; return n; });
  }

  function setColSort(col, dir) {
    setSort(prev => (prev?.col === col && prev?.dir === dir) ? null : { col, dir });
  }

  const columnValues = useMemo(() => {
    if (!parsed) return {};
    return Object.fromEntries(parsed.headers.map(h => {
      const vals = [...new Set(parsed.rows.map(r => String(r[h] ?? '').trim()).filter(Boolean))];
      vals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return [h, vals];
    }));
  }, [parsed]);

  const filteredRows = useMemo(() => {
    if (!parsed) return [];
    let rows = parsed.rows.filter(row =>
      Object.entries(filters).every(([col, set]) =>
        set.size === 0 || set.has(String(row[col] ?? '').trim())
      )
    );
    if (sort) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[sort.col] ?? '').trim();
        const bv = String(b[sort.col] ?? '').trim();
        const cmp = av.localeCompare(bv, undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [parsed, filters, sort]);

  const activeFilters = Object.entries(filters).filter(([, s]) => s.size > 0);

  async function allocate() {
    if (!empId || !parsed || filteredRows.length === 0) return;
    setAllocating(true); setError(''); setSuccess('');
    try {
      const emp = allUsers.find(u => u.emp_id === empId);
      const payload = {
        emp_id: empId,
        emp_name: emp?.name ?? empId,
        allocated_by: user.emp_id,
        allocated_by_name: user.name ?? user.emp_id,
        allocated_at: new Date().toISOString(),
        file_name: file.name,
        records_count: filteredRows.length,
        headers: parsed.headers,
        note: note.trim() || null,
        status: 'pending',
      };
      const result = await S.set('allocations', payload);
      if (result?.[0]?.id) {
        await kv.set(`alloc_${result[0].id}`, filteredRows);
      }
      setSuccess(`✓ Allocated ${filteredRows.length.toLocaleString()} records to ${emp?.name ?? empId}`);
      setFile(null); setParsed(null); setFilters({}); setSort(null); setEmpId(''); setNote('');
    } catch (err) {
      setError(`Allocation failed: ${err.message}. Please try again.`);
    }
    setAllocating(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Work Allocation</div>
          <div className="page-subtitle">Upload an Excel or CSV file and allocate records to employees</div>
        </div>
      </div>

      {/* File drop zone */}
      {!parsed && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-lg)',
            background: dragOver ? 'var(--accent-dim)' : 'var(--surface)',
            padding: '52px 32px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            {parsing ? 'Parsing file…' : 'Drop Excel / CSV here'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {parsing ? 'Please wait…' : 'or click to browse — .xlsx, .xls, .csv supported'}
          </div>
          {parsing && <div className="spinner" style={{ margin: '16px auto 0' }} />}
          <input
            ref={fileInput} type="file" accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={e => e.target.files[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error} <button onClick={() => { setError(''); setFile(null); setParsed(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8, color: '#dc2626', fontWeight: 700 }}>Retry</button>
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', color: '#15803d', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
          {success}
        </div>
      )}

      {parsed && (
        <>
          {/* Allocation controls */}
          <div className="card mb-16">
            <div className="card-header">
              <div className="card-title">
                {file?.name} — {filteredRows.length.toLocaleString()} / {parsed.rows.length.toLocaleString()} rows
                {sort && <span className="badge badge-gray" style={{ marginLeft: 8, fontSize: 11 }}>Sorted by {sort.col} {sort.dir === 'asc' ? '↑' : '↓'}</span>}
              </div>
              <button className="btn-sm" onClick={() => { setFile(null); setParsed(null); setFilters({}); setSort(null); setError(''); setSuccess(''); }}>
                ✕ Clear File
              </button>
            </div>

            {/* Active filter pills */}
            {(activeFilters.length > 0 || sort) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {activeFilters.map(([col, set]) => (
                  <span key={col} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  }}>
                    {col}: {set.size === 1 ? [...set][0] : `${set.size} selected`}
                    <button onClick={() => clearFilter(col)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 12, lineHeight: 1 }}>✕</button>
                  </span>
                ))}
                {(activeFilters.length > 1 || (activeFilters.length > 0 && sort)) && (
                  <button className="btn-sm" style={{ fontSize: 11, color: 'var(--danger)' }}
                    onClick={() => { setFilters({}); setSort(null); }}>
                    Clear all
                  </button>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Allocate To</label>
                <select value={empId} onChange={e => setEmpId(e.target.value)} required>
                  <option value="">— Select Employee —</option>
                  {allUsers.map(u => <option key={u.emp_id} value={u.emp_id}>{u.name ?? u.emp_id} ({u.access})</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Note (optional)</label>
                <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Priority batch, June claims…" />
              </div>
              <button
                className="btn-primary"
                onClick={() => setShowPreview(true)}
                disabled={!empId || filteredRows.length === 0}
                style={{ height: 36 }}
              >
                Preview &amp; Allocate →
              </button>
            </div>
          </div>

          {/* Preview table with column filters */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Preview</div>
              <span className="badge badge-blue">{parsed.headers.length} columns</span>
            </div>
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 420 }}>
              <table>
                <thead>
                  <tr>
                    {parsed.headers.map(h => {
                      const selected = filters[h] ?? new Set();
                      const isFiltered = selected.size > 0;
                      const isSorted = sort?.col === h;
                      return (
                        <th key={h} style={{ minWidth: 160, position: 'relative', verticalAlign: 'top' }}>
                          {/* Column name + filter toggle */}
                          <button
                            onClick={() => setOpenCol(openCol === h ? null : h)}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                              display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                              color: (isFiltered || isSorted) ? 'var(--accent)' : 'var(--text)',
                              fontWeight: 600, fontSize: 12, marginBottom: 4,
                            }}
                          >
                            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h}</span>
                            {isSorted && <span style={{ fontSize: 10 }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                            {isFiltered && (
                              <span style={{
                                background: 'var(--accent)', color: '#fff',
                                borderRadius: 10, fontSize: 9, padding: '1px 5px', fontWeight: 700,
                              }}>{selected.size}</span>
                            )}
                            <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
                          </button>

                          {/* Dropdown */}
                          {openCol === h && (
                            <ColFilter
                              col={h}
                              values={columnValues[h] ?? []}
                              selected={selected}
                              onToggle={val => toggleValue(h, val)}
                              onSelectAll={vals => selectAll(h, vals)}
                              onClear={() => clearFilter(h)}
                              sortDir={sort?.col === h ? sort.dir : null}
                              onSort={dir => { setColSort(h, dir); setOpenCol(null); }}
                              onClose={() => setOpenCol(null)}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr><td colSpan={parsed.headers.length} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No rows match filters</td></tr>
                  )}
                  {filteredRows.slice(0, 200).map((row, i) => (
                    <tr key={i}>
                      {parsed.headers.map(h => (
                        <td key={h} className="text-sm" style={{ whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {String(row[h] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filteredRows.length > 200 && (
                    <tr>
                      <td colSpan={parsed.headers.length} style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                        Showing first 200 of {filteredRows.length.toLocaleString()} rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Allocation Preview Modal ── */}
      {showPreview && parsed && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 1000, display: 'flex', alignItems: 'flex-start',
            justifyContent: 'center', padding: '24px 16px', overflowY: 'auto',
            backdropFilter: 'blur(2px)',
          }}
          onClick={() => !allocating && setShowPreview(false)}
        >
          <div
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
              width: '100%', maxWidth: 900, animation: 'fadeInScale 0.18s ease',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 24px', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                Allocation Preview
              </div>
              <button className="btn-icon" onClick={() => setShowPreview(false)} disabled={allocating}>✕</button>
            </div>

            <div style={{ padding: '20px 24px' }}>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
                {[
                  { label: 'Employee', value: allUsers.find(u => u.emp_id === empId)?.name ?? empId },
                  { label: 'File', value: file?.name },
                  { label: 'Records to Allocate', value: filteredRows.length.toLocaleString(), highlight: true },
                  { label: 'Total in File', value: parsed.rows.length.toLocaleString() },
                  ...(note.trim() ? [{ label: 'Note', value: note.trim() }] : []),
                ].map(({ label, value, highlight }) => (
                  <div key={label} style={{
                    background: highlight ? 'var(--accent-dim)' : 'var(--surface-2)',
                    border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', padding: '10px 14px',
                  }}>
                    <div style={{ fontSize: 11, color: highlight ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600, marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: highlight ? 'var(--accent)' : 'var(--text)', wordBreak: 'break-word' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Active filters summary */}
              {(activeFilters.length > 0 || sort) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>FILTERS APPLIED</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {activeFilters.map(([col, set]) => (
                      <span key={col} style={{
                        background: 'var(--accent-dim)', color: 'var(--accent)',
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      }}>
                        {col}: {set.size === 1 ? [...set][0] : `${[...set].join(', ')}`}
                      </span>
                    ))}
                    {sort && (
                      <span style={{
                        background: 'var(--surface-3)', color: 'var(--text-muted)',
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      }}>
                        Sorted by {sort.col} {sort.dir === 'asc' ? '↑ A→Z' : '↓ Z→A'}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Data preview table */}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                DATA PREVIEW — showing {Math.min(filteredRows.length, 50).toLocaleString()} of {filteredRows.length.toLocaleString()} records
              </div>
              <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 340, border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 20 }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 40, color: 'var(--text-muted)', fontWeight: 600 }}>#</th>
                      {parsed.headers.map(h => (
                        <th key={h} style={{ minWidth: 120, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                        {parsed.headers.map(h => (
                          <td key={h} style={{ whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn-sm" onClick={() => setShowPreview(false)} disabled={allocating}>
                  ← Go Back
                </button>
                <button
                  className="btn-primary"
                  onClick={async () => { await allocate(); setShowPreview(false); }}
                  disabled={allocating}
                  style={{ minWidth: 180 }}
                >
                  {allocating ? 'Allocating…' : `✓ Confirm — Allocate ${filteredRows.length.toLocaleString()} Records`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
