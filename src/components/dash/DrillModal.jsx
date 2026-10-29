import { useState, useMemo } from 'react';
import Modal from '../shared/Modal';

/**
 * Team Dashboard details pop-up: the records behind a number. spec = { title, subtitle, value, unit, note, rows,
 * columns: [{ label, get(row) → plain value (search + Excel), render?(row) }], groupBy?(row) → person name,
 * groupValue?(rows) → text }. onExport(title, flatRows) writes the Excel file (and the audit log entry).
 */
export default function DrillModal({ spec, onClose, onExport }) {
  const [q, setQ] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [busy, setBusy] = useState(false);
  const { title, subtitle, value, unit, note, rows, columns, groupBy, groupValue } = spec;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => columns.some(c => String(c.get(r) ?? '').toLowerCase().includes(s)));
  }, [rows, columns, q]);

  const groups = useMemo(() => {
    if (!groupBy) return [];
    const m = new Map();
    shown.forEach(r => { const k = groupBy(r); m.set(k, [...(m.get(k) ?? []), r]); });
    return [...m].map(([name, rs]) => ({ name, rows: rs, value: groupValue ? groupValue(rs) : rs.length }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [shown, groupBy, groupValue]);

  async function exportNow() {
    setBusy(true);
    const flat = grouped && groupBy
      ? groups.map(g => ({ Employee: g.name, Records: g.rows.length, Value: g.value }))
      : shown.map(r => Object.fromEntries(columns.map(c => [c.label, c.get(r) ?? ''])));
    await onExport(title, flat);
    setBusy(false);
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="hx-drill">
        <div className="hx-drill-top">
          <div>
            {subtitle && <div className="text-muted text-sm">{subtitle}</div>}
            {value != null && <div className="hx-drill-v">{value} <span>{unit}</span></div>}
            {note && <div className="text-sm">{note}</div>}
          </div>
          <div className="hx-drill-tools">
            <input type="search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search these records" />
            {groupBy && (
              <label className="hx-drill-g">
                <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} /> Per person
              </label>
            )}
            <button type="button" className="btn-sm" onClick={exportNow} disabled={busy || !shown.length}>⬇ Excel</button>
          </div>
        </div>
        <div className="table-wrap hx-drill-tbl">
          {grouped && groupBy ? (
            <table>
              <thead><tr><th>Employee</th><th className="right">Records</th><th className="right">Value</th></tr></thead>
              <tbody>
                {groups.map(g => <tr key={g.name}><td>{g.name}</td><td className="right">{g.rows.length}</td><td className="right">{g.value}</td></tr>)}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr>{columns.map(c => <th key={c.label} className={c.right ? 'right' : undefined}>{c.label}</th>)}</tr></thead>
              <tbody>
                {shown.slice(0, 500).map((r, i) => (
                  <tr key={i}>{columns.map(c => <td key={c.label} className={c.right ? 'right' : undefined}>{c.render ? c.render(r) : (c.get(r) ?? '—')}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
          {!shown.length && <div className="hx-empty dark">No records</div>}
          {!grouped && shown.length > 500 && <div className="text-muted text-sm" style={{ padding: 8 }}>Showing the first 500 of {shown.length} — the Excel file has them all.</div>}
        </div>
      </div>
    </Modal>
  );
}
