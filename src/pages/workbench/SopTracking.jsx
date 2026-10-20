import { useState } from 'react';
import { loadSopTracking } from '../../lib/sopVersions';
import { loadQuizSummary } from '../../lib/sopQuiz';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const quizText = q => !q ? '' : `${q.best}%${q.passedAt ? ` ✓ ${fmtDate(q.passedAt)}` : ''} (${q.attempts}×)`;

/**
 * Who has opened / acknowledged the current version of an SOP (roadmap 3.4), with quiz results (3.6).
 * Loaded only when opened. Shown to holders of "See SOP read tracking".
 */
export default function SopTracking({ sop, version }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(undefined);   // undefined = not loaded, null = failed
  const [quiz, setQuiz] = useState(null);        // { [emp_id]: { best, attempts, passedAt } }, null = no quiz data
  const [onlyPending, setOnlyPending] = useState(true);
  const [team, setTeam] = useState('ALL');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const [tracking, summary] = await Promise.all([loadSopTracking(version), loadQuizSummary(sop.id)]);
    setRows(tracking);
    setQuiz(summary && Object.keys(summary).length ? summary : null);
  }

  const expected = (rows ?? []).filter(r => r.expected);
  const done = expected.filter(r => r.acknowledged).length;
  const teams = [...new Set((rows ?? []).map(r => r.team).filter(Boolean))].sort();
  const shown = (rows ?? [])
    .filter(r => !onlyPending || (r.expected && !r.acknowledged))
    .filter(r => team === 'ALL' || r.team === team);

  async function download() {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet((rows ?? []).map(r => ({
      Name: r.name, 'Emp ID': r.emp_id, Team: r.team,
      'Must acknowledge': r.expected ? 'Yes' : 'No',
      'First opened': fmtDate(r.opened), 'Last opened': fmtDate(r.lastOpened), 'Times opened': r.views,
      Acknowledged: fmtDate(r.acknowledged),
      ...(quiz ? {
        'Quiz best %': quiz[r.emp_id]?.best ?? '', 'Quiz attempts': quiz[r.emp_id]?.attempts ?? 0,
        'Quiz passed': fmtDate(quiz[r.emp_id]?.passedAt),
      } : {}),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, `v${version.version_no}`);
    const safe = sop.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().slice(0, 60) || 'SOP';
    XLSX.writeFile(wb, `${safe} v${version.version_no} - read tracking.xlsx`);
  }

  return (
    <div className="card mb-16">
      <div className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }} onClick={toggle} role="button" aria-expanded={open}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="card-title">👥 Read &amp; acknowledged — v{version.version_no}</span>
        {rows && version.requires_ack && <span className="text-sm text-muted">{done} of {expected.length} acknowledged</span>}
      </div>
      {open && rows === undefined && <div className="text-sm text-muted" style={{ marginTop: 8 }}>Loading…</div>}
      {open && rows === null && <div className="text-sm text-muted" style={{ marginTop: 8 }}>Couldn’t load the tracking. Please try again.</div>}
      {open && rows && (
        <div style={{ marginTop: 8 }}>
          {!version.requires_ack && <div className="text-sm text-muted" style={{ marginBottom: 6 }}>This version doesn’t ask for acknowledgement — only opens are tracked.</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} />
              Only people who still need to acknowledge
            </label>
            <select value={team} onChange={e => setTeam(e.target.value)} style={{ maxWidth: 180 }}>
              <option value="ALL">All teams</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={download} disabled={!rows.length}>⬇ Download Excel</button>
          </div>
          {shown.length === 0
            ? <div className="text-sm text-muted">{onlyPending ? 'Everyone has acknowledged. 🎉' : 'Nobody has opened this version yet.'}</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table className="text-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      {['Name', 'Team', 'First opened', 'Times', 'Acknowledged', ...(quiz ? ['Quiz'] : [])].map(h => (
                        <th key={h} style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(r => (
                      <tr key={r.emp_id}>
                        <td style={{ padding: '4px 6px' }}>{r.name}</td>
                        <td style={{ padding: '4px 6px' }}>{r.team || '—'}</td>
                        <td style={{ padding: '4px 6px' }}>{r.opened ? fmtDate(r.opened) : <span className="text-muted">Not opened</span>}</td>
                        <td style={{ padding: '4px 6px' }}>{r.views || ''}</td>
                        <td style={{ padding: '4px 6px' }}>
                          {r.acknowledged ? `✓ ${fmtDate(r.acknowledged)}` : r.expected ? <span className="badge badge-orange">Pending</span> : '—'}
                        </td>
                        {quiz && <td style={{ padding: '4px 6px' }}>{quizText(quiz[r.emp_id]) || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
