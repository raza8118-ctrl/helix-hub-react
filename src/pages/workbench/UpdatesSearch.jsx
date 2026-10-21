import { useState, useMemo } from 'react';
import { UPDATE_CATEGORIES, EFFECTIVE_FILTERS, categoryLabel, matchesEffective, startsIn, retireUpdate, SOON_DAYS } from '../../lib/payerUpdates';
import { TEAMS } from '../../lib/constants';
import { today } from '../../lib/helpers';
import UpdateEditor from './UpdateEditor';

const fmtDate = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', verticalAlign: 'top' };

/**
 * 🔎 All updates (roadmap 8.2): every change from every bulletin in one table — search, filters, effective-date view,
 * ⬇ Excel of exactly what is filtered; editors edit or retire changes (never deleted).
 */
export default function UpdatesSearch({ initialQuery = '', updates, reads, ctx, user, canEdit, onChanged, onOpenPdf }) {
  const [query, setQuery] = useState(initialQuery);   // 10.1: from global search
  const [payer, setPayer] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [effective, setEffective] = useState('ANY');
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const payerName = u => ctx.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name ?? '—';

  const payerOptions = useMemo(() => {
    const seen = new Map();
    for (const u of updates) {
      const key = u.payer_id ? String(u.payer_id) : u.payer_name ? `name:${u.payer_name}` : null;
      if (key && !seen.has(key)) seen.set(key, u.payer_id ? ctx.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name : `${u.payer_name} (not in directory)`);
    }
    return [...seen.entries()].sort((a, b) => (a[1] ?? '').localeCompare(b[1] ?? ''));
  }, [updates, ctx.payers]);

  const list = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const nameOf = u => ctx.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name ?? '';
    return updates.filter(u => (showRetired || u.status === 'active') && (showRetired || u.bulletin.active !== false)
      && (payer === 'ALL' || (payer.startsWith('name:') ? !u.payer_id && u.payer_name === payer.slice(5) : String(u.payer_id) === payer))
      && (team === 'ALL' || (u.teams ?? []).includes(team))
      && (category === 'ALL' || u.category === category)
      && matchesEffective(u, effective)
      && words.every(w => [nameOf(u), u.change_text, u.action_needed, u.bulletin.title].some(t => (t ?? '').toLowerCase().includes(w))))
      .sort((a, b) => (a.effective_date ?? '9999').localeCompare(b.effective_date ?? '9999') || b.id - a.id);
  }, [updates, ctx.payers, query, payer, team, category, effective, showRetired]);

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(list.map(u => ({
      Payer: payerName(u), 'In Payer Directory': u.payer_id ? 'Yes' : 'No', 'Effective date': u.effective_date ?? '',
      Category: categoryLabel(u.category), 'What changed': u.change_text, Teams: (u.teams ?? []).join(', '),
      'Action needed': u.action_needed ?? '', Bulletin: u.bulletin.title, Issuer: u.bulletin.issuer ?? '', Page: u.source_page ?? '',
      Status: u.status === 'retired' ? 'Retired' : 'Active', 'Read by': reads ? (reads[u.id] ?? []).length : '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Payer updates');
    XLSX.writeFile(wb, `payer-updates-${today()}.xlsx`);
  }
  async function retire(u) {
    setBusy(true);
    if (await retireUpdate(u, u.status === 'active', user)) onChanged();
    setBusy(false);
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="search" style={{ flex: '2 1 220px' }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search payer, change, action…" aria-label="Search" />
          <select value={payer} onChange={e => setPayer(e.target.value)} aria-label="Payer">
            <option value="ALL">All payers</option>
            {payerOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Team">
            <option value="ALL">All teams</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
            <option value="ALL">All categories</option>
            {UPDATE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={effective} onChange={e => setEffective(e.target.value)} aria-label="Effective">
            {EFFECTIVE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Show retired
          </label>
          <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>{list.length} {list.length === 1 ? 'change' : 'changes'}</span>
          <button className="btn-sm" onClick={exportExcel} disabled={!list.length}>⬇ Excel</button>
        </div>
      </div>

      {list.length === 0 ? <div className="card text-muted" style={{ textAlign: 'center' }}>No changes match.</div> : (
        <div className="card mb-16" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Payer', 'Effective', 'What changed', 'Teams', 'Action needed', 'Source', ''].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map(u => {
                const days = startsIn(u);
                return (
                  <tr key={u.id} style={u.status === 'retired' ? { opacity: 0.55 } : undefined}>
                    <td style={cell}>{payerName(u)}{!u.payer_id && u.payer_name && <div className="text-sm text-muted">not in directory</div>}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      {fmtDate(u.effective_date)}
                      {days != null && days >= 0 && days <= SOON_DAYS && <div><span className="badge badge-yellow">in {days}d</span></div>}
                    </td>
                    <td style={cell}>
                      <span className="badge badge-gray" style={{ marginRight: 6 }}>{categoryLabel(u.category)}</span>{u.change_text}
                      {u.status === 'retired' && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Retired</span>}
                    </td>
                    <td style={cell}>{(u.teams ?? []).join(', ') || 'All'}</td>
                    <td style={cell}>{u.action_needed || <span className="text-muted">Information only</span>}</td>
                    <td style={cell}>
                      {u.bulletin.file_path
                        ? <button className="btn-sm" onClick={() => onOpenPdf(u.bulletin)} title={u.bulletin.title}>PDF{u.source_page ? ` p.${u.source_page}` : ''} ↗</button>
                        : <span className="text-sm text-muted">{u.bulletin.title}</span>}
                    </td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      {canEdit && (
                        <span className="row" style={{ gap: 4 }}>
                          <button className="btn-sm" disabled={busy} onClick={() => setEditing(u)} aria-label="Edit">✏️</button>
                          <button className="btn-sm" disabled={busy} onClick={() => retire(u)}>{u.status === 'retired' ? 'Restore' : 'Retire'}</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <UpdateEditor update={editing} ctx={ctx} user={user} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </>
  );
}
