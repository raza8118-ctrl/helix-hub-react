import { useState } from 'react';
import { today } from '../../lib/helpers';
import { assignPath, workingDayFrom, dueDateFor, pathItems, pathDays } from '../../lib/training';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';

/**
 * Assign a learning path to people with a start date (roadmap 3.5).
 * The path's team is listed first; people who already have the path keep their progress (only the start date changes).
 */
export default function TrainingAssign({ data, path, user, onClose, onSaved }) {
  const [start, setStart] = useState(() => workingDayFrom(today()));
  const [picked, setPicked] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const has = new Set(data.assignments.filter(a => a.path_id === path.id && a.active !== false).map(a => a.emp_id));
  const q = query.trim().toLowerCase();
  const people = data.users
    .filter(u => u.active !== false)
    .filter(u => !q || (u.name ?? '').toLowerCase().includes(q) || String(u.emp_id).toLowerCase().includes(q))
    .sort((a, b) => (b.team === path.team) - (a.team === path.team) || (a.name ?? '').localeCompare(b.name ?? ''));
  const teamPeople = path.team ? data.users.filter(u => u.active !== false && u.team === path.team) : [];
  const days = pathDays(path, pathItems(data, path.id));

  const toggle = id => setPicked(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function save() {
    if (!picked.size) return setError('Pick at least one person.');
    if (!start) return setError('Choose a start date.');
    const again = [...picked].filter(id => has.has(id)).length;
    if (!await confirmDialog({
      title: `Assign “${path.name}”?`,
      message: `${picked.size} ${picked.size === 1 ? 'person' : 'people'}, starting ${fmtDay(start)} (Day ${days} due ${fmtDay(dueDateFor(start, days))}).`
        + (again ? ` ${again} already ${again === 1 ? 'has' : 'have'} it — only the start date changes; their progress is kept.` : ''),
      confirmText: 'Assign',
    })) return;
    setSaving(true);
    const saved = await assignPath(data, path, [...picked], start, user);
    setSaving(false);
    if (saved < picked.size) return setError(`Saved ${saved} of ${picked.size}. Please try again for the rest.`);
    onSaved();
  }

  return (
    <Modal title={`Assign — ${path.name}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="field">
          <label>Start date (Day 1)</label>
          <input type="date" value={start} onChange={e => { setStart(e.target.value); setError(''); }} style={{ maxWidth: 200 }} />
          {start && (
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              Day 1 is {fmtDay(dueDateFor(start, 1))}; Day {days} is {fmtDay(dueDateFor(start, days))} (weekends skipped).
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people"
            style={{ flex: '1 1 200px', minWidth: 0 }} />
          {teamPeople.length > 0 && (
            <button type="button" className="btn-sm" onClick={() => setPicked(s => new Set([...s, ...teamPeople.map(u => u.emp_id)]))}>
              Select whole {path.team} team ({teamPeople.length})
            </button>
          )}
          {picked.size > 0 && <button type="button" className="btn-sm" onClick={() => setPicked(new Set())}>Clear</button>}
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 4 }}>
          {people.length === 0 && <div className="text-sm text-muted" style={{ padding: 6 }}>No one found.</div>}
          {people.map(u => (
            <label key={u.emp_id} className="row text-sm" style={{ gap: 8, padding: '4px 6px', cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={picked.has(u.emp_id)} onChange={() => toggle(u.emp_id)} />
              <span style={{ flex: 1 }}>{u.name ?? u.emp_id} <span className="text-muted">({u.emp_id})</span></span>
              {u.team && <span className="badge badge-gray">{u.team}</span>}
              {has.has(u.emp_id) && <span className="badge badge-blue">Already assigned</span>}
            </label>
          ))}
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Assigning…' : `Assign${picked.size ? ` (${picked.size})` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
