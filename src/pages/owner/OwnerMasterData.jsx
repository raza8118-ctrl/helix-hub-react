import { useState, useEffect, useCallback, useMemo } from 'react';
import { companyMasters } from '../../lib/owner';

/**
 * Owner Command Center → Master Data (PO 2026-11-09, read-only): each company's clients, payers and processes side by side.
 * Editing stays inside the company ("Open in …" goes to its Clients & Payers page), so its own rules and Audit Log apply.
 */
const KINDS = [['clients', 'Clients'], ['payers', 'Payers'], ['processes', 'Processes']];
const keyOf = c => c.prefix || 'home';
const detailOf = (kind, r) => (kind === 'clients' ? [r.code, r.project]
  : kind === 'payers' ? [r.payer_type, (r.aliases ?? []).join(', ')]
    : [r.project, r.target != null ? `Target ${r.target}` : null]).filter(Boolean).join(' · ');
const MAX_ROWS = 300;

export default function OwnerMasterData({ rows, onOpen }) {
  const [data, setData] = useState(undefined);   // key → { clients, payers, processes }
  const [kind, setKind] = useState('payers');
  const [company, setCompany] = useState('all');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const out = await Promise.all(rows.map(async c => [keyOf(c), await companyMasters(c.prefix ?? '')]));
    setData(Object.fromEntries(out));
  }, [rows]);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => alive && load());
    return () => { alive = false; };
  }, [load]);

  const activeCount = list => (list == null ? '—' : list.filter(r => r.active !== false).length);

  const shown = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return rows
      .filter(c => company === 'all' || keyOf(c) === company)
      .flatMap(c => (data[keyOf(c)]?.[kind] ?? []).map(r => ({ r, c })))
      .filter(({ r }) => status === 'all' || (status === 'active' ? r.active !== false : r.active === false))
      .filter(({ r }) => !term || [r.name, r.code, r.project, r.payer_type, ...(r.aliases ?? [])].some(v => String(v ?? '').toLowerCase().includes(term)))
      .sort((a, b) => String(a.r.name ?? '').localeCompare(String(b.r.name ?? '')) || a.c.name.localeCompare(b.c.name));
  }, [data, rows, kind, company, status, q]);

  return (
    <div className="fg-page">
      <div className="grid-3">
        {rows.map(c => {
          const m = data?.[keyOf(c)];
          return (
            <div key={keyOf(c)} className="card fg-card omd-co">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="bold" style={{ fontSize: 15 }}>{c.name}</div>
                  <div className="text-sm text-muted">{c.isHome ? 'Home' : c.code}</div>
                </div>
                <button type="button" className="btn-sm" onClick={() => onOpen(c, { startTab: 'masters' })} title={`Open ${c.name}'s Clients & Payers page to edit`}>Open to edit</button>
              </div>
              <div className="oc-co-stats">
                {KINDS.map(([k, label]) => (
                  <button key={k} type="button" className={`oc-co-stat omd-stat${kind === k && (company === 'all' || company === keyOf(c)) ? ' on' : ''}`}
                    onClick={() => { setKind(k); setCompany(keyOf(c)); }} title={`Show ${c.name}'s ${label.toLowerCase()}`}>
                    <div className="oc-co-stat-l">{label} (active)</div>
                    <div className="bold">{m === undefined ? '…' : activeCount(m?.[k])}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="fg-bar">
        <div className="fg-filters">
          <div className="fg-choices" role="group" aria-label="List">
            {KINDS.map(([k, label]) => (
              <button key={k} type="button" className={`btn-sm${kind === k ? ' btn-primary' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
          <label className="fg-f"><span>Search</span>
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Name, code, alias…" aria-label="Search master data" />
          </label>
          <label className="fg-f"><span>Company</span>
            <select value={company} onChange={e => setCompany(e.target.value)}>
              <option value="all">All companies</option>
              {rows.map(c => <option key={keyOf(c)} value={keyOf(c)}>{c.name}</option>)}
            </select>
          </label>
          <label className="fg-f"><span>Status</span>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="off">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>
          <span className="fg-date">{data === undefined ? 'Loading…' : `${shown.length} shown · read-only`}</span>
        </div>
      </div>

      <div className="card fg-card fg-tracker">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Company</th><th>Details</th><th>Status</th></tr></thead>
            <tbody>
              {data === undefined && <tr><td colSpan={4}><div className="loading-row"><div className="spinner" /> Loading…</div></td></tr>}
              {data && !shown.length && <tr><td colSpan={4} className="center text-muted">Nothing matches.</td></tr>}
              {shown.slice(0, MAX_ROWS).map(({ r, c }) => (
                <tr key={`${keyOf(c)}:${r.id ?? r.name}`}>
                  <td className="bold">{r.name}</td>
                  <td>{c.name}</td>
                  <td className="text-sm text-muted">{detailOf(kind, r) || '—'}</td>
                  <td><span className={`badge ${r.active === false ? 'badge-gray' : 'badge-green'}`}>{r.active === false ? 'Inactive' : 'Active'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > MAX_ROWS && <p className="text-sm text-muted" style={{ margin: '10px 0 0' }}>Showing the first {MAX_ROWS} — search or filter to narrow it down.</p>}
      </div>
    </div>
  );
}
