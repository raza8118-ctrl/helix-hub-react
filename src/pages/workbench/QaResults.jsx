import { useState, useMemo } from 'react';
import { summarise, errorCounts, qaStatusOf } from '../../lib/qa';
import { TEAMS } from '../../lib/constants';
import { addDays, today } from '../../lib/helpers';

const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left' };
const pct = v => (v == null ? '—' : `${v}%`);
const scoreClass = v => (v == null ? '' : v >= 98 ? 'col-green' : v >= 90 ? 'col-yellow' : 'col-red');

/**
 * 📊 QA results (roadmap 7.1): per person audits / average / pass rate / critical errors, errors by category (what to
 * train), SOPs linked to errors most, audits waiting for acknowledgement and open disputes. Excel has no claim numbers.
 */
export default function QaResults({ audits, people, setup, ctx, names, mistakes = [] }) {
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const [team, setTeam] = useState('ALL');

  const teamOf = useMemo(() => Object.fromEntries(people.map(p => [p.emp_id, p.team])), [people]);
  const list = useMemo(() => audits.filter(a => a.status !== 'queued'
    && (!a.work_date || (a.work_date >= from && a.work_date <= to))
    && (team === 'ALL' || teamOf[a.agent_emp_id] === team)), [audits, from, to, team, teamOf]);
  const rows = useMemo(() => summarise(list).sort((a, b) => (names[a.emp_id] ?? '').localeCompare(names[b.emp_id] ?? '')), [list, names]);
  const byCategory = useMemo(() => errorCounts(list, 'category_id'), [list]);
  const bySop = useMemo(() => errorCounts(list, 'sop_id').filter(r => r.id != null), [list]);
  const byMistake = useMemo(() => errorCounts(list, 'mistake_id').filter(r => r.id != null), [list]);   // 7.2
  const catName = id => (id == null ? 'No category' : setup.categories.find(c => c.id === id)?.name ?? 'Removed category');
  const sopName = id => ctx.sops.find(s => s.id === id)?.title ?? 'Removed SOP';
  const totalErrors = byCategory.reduce((t, r) => t + r.count, 0);
  const open = list.filter(a => a.status === 'sent' || a.status === 'disputed');

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
      Person: names[r.emp_id] ?? r.emp_id, Team: teamOf[r.emp_id] ?? '', Audits: r.count, 'Average score %': r.average,
      'Pass rate %': r.passRate, 'Critical errors': r.fatal, 'Waiting acknowledgement': r.waiting, 'Open disputes': r.disputes,
    }))), 'By person');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byCategory.map(r => ({ 'Error category': catName(r.id), Errors: r.count }))), 'Errors by category');
    // Audit list without claim numbers
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list.map(a => ({
      'Work date': a.work_date, Agent: names[a.agent_emp_id] ?? a.agent_emp_id, Auditor: names[a.auditor_emp_id] ?? a.auditor_emp_id ?? '',
      Scorecard: setup.scorecards.find(c => c.id === a.scorecard_id)?.name ?? '', 'Score %': a.score, Passed: a.passed ? 'Yes' : a.passed === false ? 'No' : '',
      Critical: a.fatal ? 'Yes' : '', Status: qaStatusOf(a.status).label, Errors: (a.results ?? []).filter(r => r.result === 'fail' && !r.overturned).map(r => catName(r.category_id)).join('; '),
    }))), 'Audits');
    XLSX.writeFile(wb, `qa-results-${from}-to-${to}.xlsx`);
  }

  return (
    <>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 140px', marginBottom: 0 }}><label>Work date from</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 140px', marginBottom: 0 }}><label>to</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}><label>Team</label>
            <select value={team} onChange={e => setTeam(e.target.value)}>
              <option value="ALL">All</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button className="btn-sm" onClick={exportExcel} disabled={!list.length}>⬇ Excel</button>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><div className="card-title">👥 By person</div></div>
        {rows.length === 0 ? <div className="text-sm text-muted">No audits in this period.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Person', 'Audits', 'Average', 'Pass rate', 'Critical', 'Waiting', 'Disputes'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.emp_id}>
                    <td style={cell}>{names[r.emp_id] ?? r.emp_id}{teamOf[r.emp_id] ? <span className="text-sm text-muted"> · {teamOf[r.emp_id]}</span> : ''}</td>
                    <td style={cell}>{r.count}</td>
                    <td style={cell} className={scoreClass(r.average)}>{pct(r.average)}</td>
                    <td style={cell}>{pct(r.passRate)}</td>
                    <td style={cell}>{r.fatal ? <span className="badge badge-red">{r.fatal}</span> : '—'}</td>
                    <td style={cell}>{r.waiting || '—'}</td>
                    <td style={cell}>{r.disputes ? <span className="badge badge-red">{r.disputes}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="card mb-16" style={{ flex: '1 1 320px' }}>
          <div className="card-header"><div className="card-title">🧩 Errors by category <span className="text-sm text-muted">· what to train</span></div></div>
          {byCategory.length === 0 ? <div className="text-sm text-muted">No errors in this period.</div> : byCategory.map(r => (
            <div key={r.id ?? 'none'} style={{ marginBottom: 6 }}>
              <div className="row text-sm" style={{ justifyContent: 'space-between' }}><span>{catName(r.id)}</span><b>{r.count}</b></div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 3 }}>
                <div style={{ height: 6, width: `${Math.round((r.count / totalErrors) * 100)}%`, background: 'var(--danger)', borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
        <div className="card mb-16" style={{ flex: '1 1 320px' }}>
          <div className="card-header"><div className="card-title">📚 SOPs linked to errors</div></div>
          {bySop.length === 0 ? <div className="text-sm text-muted">No errors linked to an SOP in this period.</div> : bySop.slice(0, 15).map(r => (
            <div key={r.id} className="row text-sm" style={{ justifyContent: 'space-between', padding: '3px 0' }}><span>{sopName(r.id)}</span><b>{r.count}</b></div>
          ))}
        </div>
        {byMistake.length > 0 && (
          <div className="card mb-16" style={{ flex: '1 1 320px' }}>
            <div className="card-header"><div className="card-title">📖 Most common known mistakes</div></div>
            {byMistake.slice(0, 15).map(r => (
              <div key={r.id} className="row text-sm" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
                <span>{mistakes.find(m => m.id === r.id)?.title ?? 'Removed entry'}</span><b>{r.count}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {open.length > 0 && (
        <div className="card mb-16">
          <div className="card-header"><div className="card-title">⏳ Waiting for the agent / disputed <span className="text-sm text-muted">· {open.length}</span></div></div>
          {open.map(a => (
            <div key={a.id} className="row text-sm" style={{ gap: 8, flexWrap: 'wrap', padding: '3px 0', borderTop: '1px solid var(--border)' }}>
              <span>{names[a.agent_emp_id] ?? a.agent_emp_id}</span>
              <span className="text-muted">{a.work_date}</span>
              <span>{pct(a.score)}</span>
              <span className={`badge ${qaStatusOf(a.status).badge}`}>{qaStatusOf(a.status).label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
