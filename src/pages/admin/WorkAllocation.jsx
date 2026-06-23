import { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { S, kv } from '../../lib/supabase';

async function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        // Find row with most non-empty cells in first 15 rows
        const scan = all.slice(0, 15);
        let headerIdx = 0, maxCells = 0;
        scan.forEach((row, i) => {
          const cnt = row.filter(v => v !== '' && v !== null && v !== undefined).length;
          if (cnt > maxCells) { maxCells = cnt; headerIdx = i; }
        });
        const headers = all[headerIdx].map(h => String(h ?? '').trim()).filter(Boolean);
        const rows = all.slice(headerIdx + 1)
          .filter(r => r.some(v => v !== '' && v !== null && v !== undefined))
          .map(r => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
            return obj;
          });
        resolve({ headers, rows });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

export default function WorkAllocation({ user }) {
  const [file, setFile]         = useState(null);
  const [parsed, setParsed]     = useState(null); // { headers, rows }
  const [filters, setFilters]   = useState({});   // { col: value }
  const [empId, setEmpId]       = useState('');
  const [note, setNote]         = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [allocating, setAllocating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const fileInput               = useRef(null);

  useEffect(() => { S.get('users', { active: true }).then(u => setAllUsers(u ?? [])); }, []);

  async function handleFile(f) {
    if (!f) return;
    setFile(f);
    setError('');
    setSuccess('');
    setParsed(null);
    setFilters({});
    setParsing(true);
    try {
      const result = await parseExcel(f);
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

  function setFilter(col, val) {
    setFilters(prev => ({ ...prev, [col]: val }));
  }

  function clearFilter(col) {
    setFilters(prev => { const n = { ...prev }; delete n[col]; return n; });
  }

  // Distinct values per column, for the header "select to filter" dropdowns.
  const columnValues = useMemo(() => {
    if (!parsed) return {};
    return Object.fromEntries(parsed.headers.map(h => {
      const vals = [...new Set(parsed.rows.map(r => String(r[h] ?? '').trim()).filter(Boolean))];
      vals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return [h, vals];
    }));
  }, [parsed]);

  const filteredRows = parsed?.rows.filter(row =>
    Object.entries(filters).every(([col, val]) =>
      !val || String(row[col] ?? '').trim() === val
    )
  ) ?? [];

  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  async function allocate() {
    if (!empId || !parsed || filteredRows.length === 0) return;
    setAllocating(true);
    setError('');
    setSuccess('');
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
      setFile(null); setParsed(null); setFilters({}); setEmpId(''); setNote('');
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
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
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
              </div>
              <button className="btn-sm" onClick={() => { setFile(null); setParsed(null); setFilters({}); setError(''); setSuccess(''); }}>
                ✕ Clear File
              </button>
            </div>

            {/* Active filter pills */}
            {activeFilters.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {activeFilters.map(([col, val]) => (
                  <span key={col} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  }}>
                    {col}: {val}
                    <button onClick={() => clearFilter(col)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 12, lineHeight: 1 }}>✕</button>
                  </span>
                ))}
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
                onClick={allocate}
                disabled={allocating || !empId || filteredRows.length === 0}
                style={{ height: 36 }}
              >
                {allocating ? 'Allocating…' : `Allocate ${filteredRows.length.toLocaleString()} Records`}
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
                    {parsed.headers.map(h => (
                      <th key={h} style={{ minWidth: 140 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{h}</div>
                        <select
                          value={filters[h] ?? ''}
                          onChange={e => setFilter(h, e.target.value)}
                          style={{
                            width: '100%', padding: '3px 5px', fontSize: 11,
                            border: '1px solid var(--border)', borderRadius: 4,
                            background: 'var(--surface)', color: 'var(--text)',
                            fontWeight: 400, letterSpacing: 'normal',
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="">All ({(columnValues[h] ?? []).length})</option>
                          {(columnValues[h] ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </th>
                    ))}
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
    </div>
  );
}
