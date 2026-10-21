import { useState, useMemo } from 'react';
import { categoryLabel, bulletinLink, setBulletinActive } from '../../lib/payerUpdates';
import { TEAMS } from '../../lib/constants';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDate = d => (d ? new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', verticalAlign: 'top' };

/**
 * 📋 Recent updates (roadmap 8.1): saved bulletins with their changes, newest first; filter by payer and team;
 * Open PDF (60-second private link). The full searchable list, Excel and notifications come in 8.2.
 */
export default function BulletinList({ bulletins, ctx, user, canEdit, onChanged, onSuggest, suggesting }) {
  const [payer, setPayer] = useState('ALL');          // 'ALL' | payer id | 'name:<text>'
  const [team, setTeam] = useState('ALL');
  const [showOff, setShowOff] = useState(false);
  const payerName = u => ctx.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name ?? '—';

  const payerOptions = useMemo(() => {
    const seen = new Map();
    for (const b of bulletins) for (const u of b.updates) {
      const key = u.payer_id ? String(u.payer_id) : u.payer_name ? `name:${u.payer_name}` : null;
      if (key && !seen.has(key)) seen.set(key, u.payer_id ? ctx.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name : `${u.payer_name} (not in directory)`);
    }
    return [...seen.entries()].sort((a, b) => (a[1] ?? '').localeCompare(b[1] ?? ''));
  }, [bulletins, ctx.payers]);

  const matches = u => (payer === 'ALL' || (payer.startsWith('name:') ? !u.payer_id && u.payer_name === payer.slice(5) : String(u.payer_id) === payer))
    && (team === 'ALL' || (u.teams ?? []).includes(team));
  const shown = bulletins
    .filter(b => showOff || b.active !== false)
    .map(b => ({ ...b, rows: b.updates.filter(matches).sort((x, y) => (x.effective_date ?? '9999').localeCompare(y.effective_date ?? '9999')) }))
    .filter(b => b.rows.length || (payer === 'ALL' && team === 'ALL'));

  async function openPdf(b) {
    const w = window.open('', '_blank');   // opened before the await so the browser doesn't block it
    const url = await bulletinLink(b.file_path);
    if (url && w) w.location.href = url; else w?.close();
  }
  async function toggle(b) {
    if (b.active !== false && !await confirmDialog({ title: 'Turn this bulletin off?', message: 'It and its changes disappear from the feed. You can show it again with “Show turned-off”.', tone: 'warning', confirmText: 'Turn off' })) return;
    if (await setBulletinActive(b, b.active === false, user)) onChanged();
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={payer} onChange={e => setPayer(e.target.value)} aria-label="Payer">
            <option value="ALL">All payers</option>
            {payerOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Team">
            <option value="ALL">All teams</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {canEdit && (
            <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> Show turned-off
            </label>
          )}
        </div>
      </div>

      {shown.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>No payer updates yet.</div>}

      {shown.map(b => (
        <div key={b.id} className="card mb-16" style={b.active === false ? { opacity: 0.55 } : undefined}>
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title">
              📰 {b.title}
              <span className="text-sm text-muted"> · {b.issuer || 'Issuer not set'} · published {fmtDate(b.published_on)} · added {fmtDate(b.uploaded_at)}</span>
              {b.extracted_by_ai && <span className="badge badge-purple" style={{ marginLeft: 6 }}>✨ AI</span>}
              {b.active === false && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Turned off</span>}
            </div>
            <span className="row" style={{ gap: 4 }}>
              {b.file_path && <button className="btn-sm" onClick={() => openPdf(b)}>Open PDF ↗</button>}
              {canEdit && onSuggest && b.file_path && b.active !== false && (
                <button className="btn-sm" disabled={!!suggesting} onClick={() => onSuggest(b)} title="Find Payer Directory changes in this bulletin (8.3)">
                  {suggesting === b.id ? 'Reading…' : '💡 Suggest directory changes'}
                </button>
              )}
              {canEdit && <button className="btn-sm" onClick={() => toggle(b)}>{b.active === false ? 'Turn on' : 'Turn off'}</button>}
            </span>
          </div>
          {b.rows.length === 0 ? <div className="text-sm text-muted">No changes listed.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Payer', 'Effective', 'What changed', 'Teams', 'Action needed'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
                <tbody>
                  {b.rows.map(u => (
                    <tr key={u.id}>
                      <td style={cell}>{payerName(u)}{!u.payer_id && u.payer_name && <div className="text-sm text-muted">not in directory</div>}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{fmtDate(u.effective_date)}</td>
                      <td style={cell}>
                        <span className="badge badge-gray" style={{ marginRight: 6 }}>{categoryLabel(u.category)}</span>{u.change_text}
                        {u.source_page && <span className="text-sm text-muted"> (p. {u.source_page})</span>}
                      </td>
                      <td style={cell}>{(u.teams ?? []).join(', ') || '—'}</td>
                      <td style={cell}>{u.action_needed || <span className="text-muted">Information only</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
