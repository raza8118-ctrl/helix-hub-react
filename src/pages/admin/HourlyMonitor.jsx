import { useState, useEffect, useMemo } from 'react';
import { S } from '../../lib/supabase';
import { today, fmtD, procIncludes, scopeToSupervisor } from '../../lib/helpers';
import { ACCESSES, HOURLY_SLOTS } from '../../lib/constants';
import EmpDetail from '../../components/shared/EmpDetail';

const SLOT_KEYS = HOURLY_SLOTS.map((_, i) => `h${i}`);

export default function HourlyMonitor({ user }) {
  const [date, setDate]           = useState(today());
  const [filterProc, setProc]     = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch]       = useState('');
  const [hourlyData, setHourlyData] = useState([]);
  const [allUsers, setAllUsers]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [empDetail, setEmpDetail] = useState(null);

  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [customProcs, setCustomProcs] = useState([]);

  useEffect(() => { load(); }, [date]);

  // Auto-refresh every 60 seconds so admin sees live hourly updates
  useEffect(() => {
    const interval = setInterval(() => {
      refreshSilent();
    }, 60000);
    return () => clearInterval(interval);
  }, [date]);

  async function load() {
    setLoading(true);
    const [u, h, cp] = await Promise.all([
      S.get('users'),
      S.get('hourly_logs', { date }),
      S.get('processes'),
    ]);
    setAllUsers(u ?? []);
    setHourlyData(h ?? []);
    setCustomProcs(cp ?? []);
    setLastRefresh(new Date());
    setLoading(false);
  }

  async function refreshSilent() {
    const [u, h] = await Promise.all([
      S.get('users'),
      S.get('hourly_logs', { date }),
    ]);
    setAllUsers(u ?? []);
    setHourlyData(h ?? []);
    setLastRefresh(new Date());
  }

  const { tableRows, slotTotals, grandTotal, filed, pending } = useMemo(() => {
    const filteredUsers = scopeToSupervisor(allUsers, user, customProcs).filter(u => {
      if (u.role !== 'employee') return false;
      const procOk   = filterProc === 'ALL' || procIncludes(u, filterProc);
      const searchOk = !search.trim() || (u.name ?? u.emp_id).toLowerCase().includes(search.toLowerCase());
      const statusOk = statusFilter === 'all' ||
        (statusFilter === 'active' ? u.active !== false : u.active === false);
      return procOk && searchOk && statusOk;
    });

    const tableRows = filteredUsers.map(u => {
      const row   = hourlyData.find(h => h.emp_id === u.emp_id) ?? null;
      const slots = SLOT_KEYS.map(k => row?.[k] ?? null);
      const total = row ? slots.reduce((s, v) => s + (v ?? 0), 0) : null;
      return { ...u, row, slots, total };
    });

    const slotTotals = SLOT_KEYS.map((_, si) =>
      tableRows.reduce((s, r) => s + (r.slots[si] ?? 0), 0)
    );
    const grandTotal = slotTotals.reduce((s, v) => s + v, 0);

    const filed   = tableRows.filter(r => r.row).length;
    const pending = tableRows.filter(r => !r.row).length;

    return { tableRows, slotTotals, grandTotal, filed, pending };
  }, [allUsers, hourlyData, user, customProcs, filterProc, search, statusFilter]);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Hourly Monitor</div>
          <div className="page-subtitle">
            {fmtD(date)} · {filed} filed · {pending} pending
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Last refresh: {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <input
            type="text"
            placeholder="Search employee…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 180 }}
          />
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 160 }} />
          <select value={filterProc} onChange={e => setProc(e.target.value)} style={{ maxWidth: 130 }}>
            {ACCESSES.map(a => <option key={a}>{a}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 120 }}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="all">All</option>
          </select>
          <button className="btn-sm" onClick={load}>↺ Refresh</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid-4 mb-16">
        <div className="stat-card">
          <div className="stat-label">Total Employees</div>
          <div className="stat-value">{tableRows.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Filed</div>
          <div className="stat-value col-green">{filed}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value col-red">{pending}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Grand Total</div>
          <div className="stat-value">{grandTotal.toLocaleString()}</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Hourly Counts — {HOURLY_SLOTS[0]} to {HOURLY_SLOTS.at(-1)}</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--surface-2)', zIndex: 2, minWidth: 140 }}>Employee</th>
                <th style={{ minWidth: 70 }}>Process</th>
                {HOURLY_SLOTS.map(s => (
                  <th key={s} className="center" style={{ minWidth: 64, fontSize: 10 }}>{s}</th>
                ))}
                <th className="right" style={{ minWidth: 60 }}>Total</th>
                <th className="center" style={{ minWidth: 80 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={HOURLY_SLOTS.length + 4} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                    No employees found
                  </td>
                </tr>
              )}
              {tableRows.map(row => (
                <tr key={row.emp_id}>
                  <td
                    className="bold"
                    style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1, cursor: 'pointer', color: 'var(--accent)' }}
                    onClick={() => setEmpDetail(row)}
                  >
                    {row.name ?? row.emp_id}
                  </td>
                  <td className="text-sm text-muted">{row.access}</td>
                  {row.slots.map((v, si) => (
                    <td key={si} className="center" style={{ color: v != null ? 'var(--text)' : 'var(--text-muted)', fontSize: 12 }}>
                      {v ?? '—'}
                    </td>
                  ))}
                  <td className="right bold">{row.total != null ? row.total : '—'}</td>
                  <td className="center">
                    {row.row
                      ? <span className="badge badge-green">Filed</span>
                      : <span className="badge badge-red">Pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {tableRows.some(r => r.row) && (
              <tfoot>
                <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  <td colSpan={2} style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
                    Team Total
                  </td>
                  {slotTotals.map((t, si) => (
                    <td key={si} className="center" style={{ padding: '10px 14px', fontSize: 12 }}>{t || '—'}</td>
                  ))}
                  <td className="right bold" style={{ padding: '10px 14px' }}>{grandTotal}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {empDetail && (
        <EmpDetail emp={empDetail} onClose={() => setEmpDetail(null)} currentUser={user} />
      )}
    </div>
  );
}
