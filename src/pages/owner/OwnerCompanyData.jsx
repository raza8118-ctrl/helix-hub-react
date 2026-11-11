import { useState, useEffect, useMemo } from 'react';
import { MODULES, moduleOf, logCompanyData, ROW_CAP, EDITS } from '../../lib/companyData';
import NavIcon from '../../components/ui/NavIcon';
import CompanyDownload from '../../components/owner/CompanyDownload';
import SaveToMaster from '../../components/owner/SaveToMaster';
import CompanyRowEdit from '../../components/owner/CompanyRowEdit';

/**
 * Owner Console → Company Data (PO 2026-11-10), Stage 1: pick a company and a module, see that company's data in a
 * searchable, sortable, read-only table; Stage 2: Download Excel. Opening a company + module is logged (owner log + the company's Audit Log).
 */
const keyOf = c => c.prefix || 'home';
const PAGE = 100;

export default function OwnerCompanyData({ owner, rows: companies }) {
  const [companyKey, setCompanyKey] = useState(() => keyOf(companies[0]));
  const [moduleId, setModuleId] = useState('payers');
  const [viewId, setViewId] = useState(() => moduleOf('payers').views[0].id);
  const [data, setData] = useState(undefined);   // undefined = loading, null = not set up, { rows, capped }
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(null);   // row being saved to the Master Library
  const [editing, setEditing] = useState(null);   // row being edited

  const company = companies.find(c => keyOf(c) === companyKey) ?? companies[0];
  const mod = moduleOf(moduleId);
  const view = mod.views.find(v => v.id === viewId) ?? mod.views[0];

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(async () => {
      if (!alive) return;
      setData(undefined); setPage(0);
      const out = await view.load(company.prefix ?? '');
      if (!alive) return;
      setData(out);
      if (out) logCompanyData(owner, company, 'company_data_view', { module: mod.label, list: view.label, rows: out.rows.length, phi: !!mod.phi });
    });
    return () => { alive = false; };
    // owner / labels are stable for one view; reload re-reads
  }, [companyKey, moduleId, view.id, reload]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = (data?.rows ?? []).filter(r => !q || view.columns.some(([k]) => String(r[k] ?? '').toLowerCase().includes(q)));
    if (sort.key) {
      const num = v => (typeof v === 'number' ? v : NaN);
      out = [...out].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        const d = !Number.isNaN(num(x)) && !Number.isNaN(num(y)) ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
        return d * sort.dir;
      });
    }
    return out;
  }, [data, query, sort, view]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pick = id => { setModuleId(id); setViewId(moduleOf(id).views[0].id); setQuery(''); setSort({ key: null, dir: 1 }); };
  const sortBy = k => { setSort(s => ({ key: k, dir: s.key === k ? -s.dir : 1 })); setPage(0); };

  return (
    <div className="fg-page ocd">
      <div className="fg-bar">
        <div className="fg-filters">
          <label className="fg-f"><span>Company</span>
            <select value={companyKey} onChange={e => { setCompanyKey(e.target.value); setQuery(''); }} aria-label="Company">
              {companies.map(c => <option key={keyOf(c)} value={keyOf(c)}>{c.name}{c.isHome ? ' (home)' : ''}</option>)}
            </select>
          </label>
          <span className="fg-date">Read-only unless you click Edit (with a confirm step). Opening, downloading, saving to master and edits are recorded in your owner log and the company’s Audit Log.</span>
        </div>
        <div className="fg-actions">
          <button type="button" className="btn-sm" onClick={() => setDownloading(true)}>⬇ Download Excel</button>
          <button type="button" className="btn-sm" onClick={() => setReload(n => n + 1)}>Refresh</button>
        </div>
      </div>

      <div className="ocd-mods" role="group" aria-label="Module">
        {MODULES.map(m => (
          <button key={m.id} type="button" className={`ocd-mod${m.id === moduleId ? ' on' : ''}`} aria-pressed={m.id === moduleId} onClick={() => pick(m.id)}>
            <NavIcon icon={m.icon} size={15} /> {m.label}{m.phi && <span className="ocd-phi" title="May contain patient information"> PHI</span>}
          </button>
        ))}
      </div>

      {mod.phi && (
        <div className="ocd-warn" role="note">
          ⚠ <strong>{mod.label}</strong> may contain patient information (claim numbers, dates of service, notes). View only what you need,
          never copy it into email or chat, and never paste it into an AI tool.
        </div>
      )}

      <div className="card fg-card">
        <div className="card-header ocd-head">
          {mod.views.length > 1 && (
            <div className="ocd-views">
              {mod.views.map(v => (
                <button key={v.id} type="button" className={`btn-sm${v.id === view.id ? ' btn-primary' : ''}`} aria-pressed={v.id === view.id}
                  onClick={() => { setViewId(v.id); setQuery(''); setSort({ key: null, dir: 1 }); }}>{v.label}</button>
              ))}
            </div>
          )}
          <input type="text" className="fg-search" placeholder={`Search ${view.label.toLowerCase()}…`} aria-label="Search"
            value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
          <span className="text-sm text-muted">
            {data ? `${shown.length.toLocaleString()} of ${data.rows.length.toLocaleString()} · ${company.name}` : ''}
          </span>
        </div>

        {data === undefined && <div className="loading-row"><div className="spinner" /> Loading {company.name}’s {view.label.toLowerCase()}…</div>}
        {data === null && <div className="fg-empty">{company.name} doesn’t have this list set up (its database update hasn’t been run).</div>}
        {data?.capped && <div className="ocd-warn">Only the first {ROW_CAP.toLocaleString()} rows are shown. Search works on these rows.</div>}
        {data && (
          shown.length === 0
            ? <div className="fg-empty">{data.rows.length ? 'Nothing matches your search.' : `${company.name} has no ${view.label.toLowerCase()} yet.`}</div>
            : (
              <div className="table-wrap">
                <table className="ocd-table">
                  <thead>
                    <tr>{view.columns.map(([k, label]) => (
                      <th key={k} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="ocd-sort" onClick={() => sortBy(k)}>{label}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
                      </th>
                    ))}{(mod.master || EDITS[view.id]) && <th>Actions</th>}</tr>
                  </thead>
                  <tbody>
                    {shown.slice(page * PAGE, page * PAGE + PAGE).map(r => (
                      <tr key={r.id}>
                        {view.columns.map(([k]) => <td key={k}>{String(r[k] ?? '')}</td>)}
                        {(mod.master || EDITS[view.id]) && (
                          <td className="ocd-act">
                            {EDITS[view.id] && <button type="button" className="btn-sm" onClick={() => setEditing(r)}>Edit</button>}{' '}
                            {!mod.master ? null : mod.id === 'sops' && r._raw?.client_id != null
                              ? <span className="text-sm text-muted" title="Client SOPs stay with the company">Client SOP</span>
                              : <button type="button" className="btn-sm" onClick={() => setSaving(r)} title="Add this to the shared Master Library (nothing here is moved or deleted)">⤴ Save to Master</button>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
        {data && pages > 1 && (
          <div className="ocd-pager">
            <button type="button" className="btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Previous</button>
            <span className="text-sm text-muted">Page {page + 1} of {pages}</span>
            <button type="button" className="btn-sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
          </div>
        )}
      </div>
      {editing && <CompanyRowEdit owner={owner} company={company} mod={mod} view={view} row={editing} onClose={() => setEditing(null)} onSaved={() => setReload(n => n + 1)} />}
      {saving && <SaveToMaster owner={owner} company={company} mod={mod} row={saving} onClose={() => setSaving(null)} />}
      {downloading && <CompanyDownload owner={owner} mod={mod} company={company} companies={companies} onClose={() => setDownloading(false)} />}
    </div>
  );
}
