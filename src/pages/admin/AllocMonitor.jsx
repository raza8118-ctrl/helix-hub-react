import { useState, useEffect } from 'react';
import { S, kv } from '../../lib/supabase';
import { dlCSV } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';

function ttpLabel(allocAt, downloadAt) {
  if (!downloadAt || !allocAt) return null;
  const mins = Math.round((new Date(downloadAt) - new Date(allocAt)) / 60000);
  if (mins < 30)  return { label: `${mins}m`,            cls: 'col-green'  };
  if (mins < 60)  return { label: `${mins}m`,            cls: 'col-yellow' };
  const hrs = (mins / 60).toFixed(1);
  return { label: `${hrs}h`, cls: 'col-red' };
}

export default function AllocMonitor({ user }) {
  const [allocs, setAllocs]       = useState([]);
  const [allUsers, setAllUsers]   = useState([]);
  const [empFilter, setEmpFilter] = useState('ALL');
  const [loading, setLoading]     = useState(false);
  const [viewItem, setViewItem]   = useState(null);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [a, u] = await Promise.all([
      S.get('allocations'),
      S.get('users', { active: true }),
    ]);
    setAllocs((a ?? []).sort((x, y) => (y.allocated_at ?? '') > (x.allocated_at ?? '') ? 1 : -1));
    setAllUsers(u ?? []);
    setLoading(false);
  }

  async function deleteAlloc(id) {
    if (!window.confirm('Delete this allocation?')) return;
    await S.del('allocations', { id });
    setAllocs(prev => prev.filter(a => a.id !== id));
  }

  async function downloadAlloc(a) {
    setDownloading(a.id);
    try {
      const rows = await kv.get(`alloc_${a.id}`);
      if (!rows?.length) {
        window.alert('No data found for this allocation.');
        setDownloading(null);
        return;
      }
      const filename = (a.file_name || 'allocation').replace(/\.[^.]+$/, '.csv');
      dlCSV(a.headers || Object.keys(rows[0]), rows, filename);
      await S.update('allocations', { status: 'downloaded', downloaded_at: new Date().toISOString() }, { id: a.id });
      setAllocs(prev => prev.map(x => x.id === a.id ? { ...x, status: 'downloaded', downloaded_at: new Date().toISOString() } : x));
    } catch (err) {
      window.alert(`Download failed: ${err.message}`);
    }
    setDownloading(null);
  }

  const displayed = empFilter === 'ALL' ? allocs : allocs.filter(a => a.emp_id === empFilter);
  const total      = allocs.length;
  const pending    = allocs.filter(a => a.status !== 'downloaded').length;
  const downloaded = allocs.filter(a => a.status === 'downloaded').length;
  const employees  = new Set(allocs.map(a => a.emp_id)).size;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Allocation Monitor</div>
          <div className="page-subtitle">{total} allocations across {employees} employees</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select value={empFilter} onChange={e => setEmpFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="ALL">All Employees</option>
            {allUsers.map(u => <option key={u.emp_id} value={u.emp_id}>{u.name ?? u.emp_id}</option>)}
          </select>
          <button className="btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid-4 mb-16">
        <div className="stat-card">
          <div className="stat-label">Total Allocations</div>
          <div className="stat-value">{total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value col-yellow">{pending}</div>
          <div className="stat-sub">not yet downloaded</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Downloaded</div>
          <div className="stat-value col-green">{downloaded}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Employees</div>
          <div className="stat-value">{employees}</div>
          <div className="stat-sub">with allocations</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Allocation Records</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Process</th>
                <th className="right">Records</th>
                <th>File</th>
                <th>Note</th>
                <th>Allocated By</th>
                <th>Allocated At</th>
                <th className="center">Status</th>
                <th>Downloaded At</th>
                <th className="center">Time to Open</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                  No allocations found
                </td></tr>
              )}
              {displayed.map(a => {
                const ttp = ttpLabel(a.allocated_at, a.downloaded_at);
                const emp = allUsers.find(u => u.emp_id === a.emp_id);
                return (
                  <tr key={a.id}>
                    <td className="bold">{a.emp_name ?? a.emp_id}</td>
                    <td className="text-sm text-muted">{emp?.access ?? '—'}</td>
                    <td className="right">{(a.records_count ?? 0).toLocaleString()}</td>
                    <td className="text-sm truncate" style={{ maxWidth: 140 }}>{a.file_name}</td>
                    <td className="text-sm text-muted truncate" style={{ maxWidth: 130 }}>{a.note || '—'}</td>
                    <td className="text-sm">{a.allocated_by_name ?? a.allocated_by}</td>
                    <td className="text-sm text-muted">
                      {a.allocated_at ? new Date(a.allocated_at).toLocaleString() : '—'}
                    </td>
                    <td className="center">
                      <span className={`badge ${a.status === 'downloaded' ? 'badge-green' : 'badge-yellow'}`}>
                        {a.status === 'downloaded' ? 'Downloaded' : 'Pending'}
                      </span>
                    </td>
                    <td className="text-sm text-muted">
                      {a.downloaded_at ? new Date(a.downloaded_at).toLocaleString() : '—'}
                    </td>
                    <td className={`center bold ${ttp?.cls ?? 'col-neutral'}`}>
                      {ttp?.label ?? '—'}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn-sm" onClick={() => downloadAlloc(a)} disabled={downloading === a.id}>
                          {downloading === a.id ? '…' : '⬇ View'}
                        </button>
                        <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteAlloc(a.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {viewItem && (
        <Modal title={`Allocation — ${viewItem.emp_name ?? viewItem.emp_id}`} onClose={() => setViewItem(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            {[
              ['Employee', viewItem.emp_name ?? viewItem.emp_id],
              ['File', viewItem.file_name],
              ['Records', (viewItem.records_count ?? 0).toLocaleString()],
              ['Note', viewItem.note || '—'],
              ['Allocated By', viewItem.allocated_by_name ?? viewItem.allocated_by],
              ['Allocated At', viewItem.allocated_at ? new Date(viewItem.allocated_at).toLocaleString() : '—'],
              ['Status', viewItem.status],
              ['Downloaded At', viewItem.downloaded_at ? new Date(viewItem.downloaded_at).toLocaleString() : 'Not yet'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">{k}</span>
                <span className="bold">{v}</span>
              </div>
            ))}
            {viewItem.headers?.length > 0 && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <div>
                  <div className="text-muted text-sm" style={{ marginBottom: 6 }}>Columns ({viewItem.headers.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {viewItem.headers.map(h => <span key={h} className="badge badge-blue">{h}</span>)}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={() => setViewItem(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
