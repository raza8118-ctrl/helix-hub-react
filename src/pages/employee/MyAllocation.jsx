import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { S, kv } from '../../lib/supabase';
import { fmtD } from '../../lib/helpers';

async function downloadAllocXlsx(alloc) {
  // Fetch actual rows from kv store
  const rows = await kv.get(`alloc_${alloc.id}`);
  const headers = alloc.headers ?? (rows?.length ? Object.keys(rows[0]) : []);

  const wb = XLSX.utils.book_new();

  // Build sheet rows per spec:
  // Row 1: Title with employee name
  // Row 2: Allocated by, date, total records
  // Row 3: Note (if exists)
  // Row 4: Blank
  // Row 5: Column headers
  // Remaining: Data rows
  const wsData = [
    [`Work Allocation — ${alloc.emp_name ?? alloc.emp_id}`],
    [
      `Allocated by: ${alloc.allocated_by_name ?? alloc.allocated_by ?? '—'}`,
      `Date: ${alloc.allocated_at ? new Date(alloc.allocated_at).toLocaleString() : '—'}`,
      `Total Records: ${(alloc.records_count ?? rows?.length ?? 0).toLocaleString()}`,
    ],
    alloc.note ? [`Note: ${alloc.note}`] : [''],
    [],
    headers,
    ...(rows ?? []).map(r => headers.map(h => r[h] ?? '')),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto column widths based on headers + sample data
  const colWidths = headers.map((h, ci) => {
    const maxData = (rows ?? []).slice(0, 100).reduce((mx, r) => {
      const len = String(r[h] ?? '').length;
      return len > mx ? len : mx;
    }, 0);
    return { wch: Math.min(Math.max(h.length + 2, maxData + 1, 8), 50) };
  });
  // Title and meta rows use the first column width
  if (colWidths.length > 0) {
    colWidths[0] = { wch: Math.max(colWidths[0].wch, 40) };
  }
  ws['!cols'] = colWidths;

  // Merge title and meta rows across all header columns
  if (headers.length > 1) {
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    ];
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Allocation');
  XLSX.writeFile(wb, `Allocation-${alloc.emp_name ?? alloc.emp_id}-${alloc.id ?? Date.now()}.xlsx`);
}

export default function MyAllocation({ user }) {
  const [allocs, setAllocs]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const a = await S.get('allocations', { emp_id: user.emp_id });
    setAllocs((a ?? []).sort((x, y) => (y.allocated_at ?? '') > (x.allocated_at ?? '') ? 1 : -1));
    setLoading(false);
  }

  async function handleDownload(alloc) {
    setDownloading(alloc.id);
    try {
      await downloadAllocXlsx(alloc);
      if (alloc.status !== 'downloaded') {
        const now = new Date().toISOString();
        await S.update('allocations', { status: 'downloaded', downloaded_at: now }, { id: alloc.id });
        setAllocs(prev => prev.map(a => a.id === alloc.id
          ? { ...a, status: 'downloaded', downloaded_at: now }
          : a
        ));
      }
    } catch (err) {
      window.alert(`Download failed: ${err.message}`);
    }
    setDownloading(null);
  }

  const pending    = allocs.filter(a => a.status !== 'downloaded').length;
  const downloaded = allocs.filter(a => a.status === 'downloaded').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            My Allocation
            {pending > 0 && <span className="badge badge-yellow">{pending} pending</span>}
          </div>
          <div className="page-subtitle">Work batches assigned to you</div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Total Batches</div>
          <div className="stat-value">{allocs.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className={`stat-value ${pending > 0 ? 'col-yellow' : 'col-green'}`}>{pending}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Downloaded</div>
          <div className="stat-value col-green">{downloaded}</div>
        </div>
      </div>

      {loading && <div className="loading-row"><div className="spinner" /> Loading…</div>}

      {!loading && allocs.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 56 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No work allocated yet</div>
        </div>
      )}

      {/* Allocation cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {allocs.map(a => (
          <div key={a.id} className="card fade-in" style={{
            borderLeft: `3px solid ${a.status === 'downloaded' ? 'var(--col-green)' : 'var(--warning)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                  {a.file_name ?? 'Allocation Batch'}
                </div>
                <span className={`badge ${a.status === 'downloaded' ? 'badge-green' : 'badge-yellow'}`}>
                  {a.status === 'downloaded' ? 'Downloaded' : 'Pending'}
                </span>
              </div>
              <button
                className="btn-primary"
                onClick={() => handleDownload(a)}
                disabled={downloading === a.id}
                style={{ gap: 6 }}
              >
                {downloading === a.id ? '⏳ Preparing…' : '⬇ Download Excel'}
              </button>
            </div>

            {/* Metadata grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 10 }}>
              {[
                ['Records', (a.records_count ?? 0).toLocaleString()],
                ['Allocated By', a.allocated_by_name ?? a.allocated_by ?? '—'],
                ['Date', a.allocated_at ? fmtD(a.allocated_at.slice(0, 10)) : '—'],
                ['Time', a.allocated_at ? new Date(a.allocated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>

            {a.note && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                📝 {a.note}
              </div>
            )}

            {a.status === 'downloaded' && a.downloaded_at && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-subtle)' }}>
                Downloaded: {new Date(a.downloaded_at).toLocaleString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
