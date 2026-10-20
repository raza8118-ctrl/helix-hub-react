import { useState, useMemo } from 'react';
import { FIELDS, readWorklistFile, detectColumns, droppedColumns, buildItems, addDeadlines, saveWorklist } from '../../lib/worklist';
import { TEAMS } from '../../lib/constants';

/**
 * Upload an aging / RTP file (roadmap 6.4). Only the minimum claim fields are kept: patient-identifying columns and
 * anything not needed are dropped here in the browser and listed in the preview. The raw file is never stored.
 */
export default function WorklistUpload({ ctx, tasks, user, isSupervisor, onDone, onCancel }) {

  const [read, setRead] = useState(null);          // { headers, rows } or { error }
  const [map, setMap] = useState({});
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [team, setTeam] = useState(isSupervisor ? (user.team ?? '') : '');
  const [countTask, setCountTask] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function pick(f) {
    setRead(null); setError('');
    if (!f) return;
    setBusy('Reading the file…');
    try {
      const r = await readWorklistFile(f);
      setRead(r);
      if (!r.error) {
        setMap(detectColumns(r.headers));
        if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
      }
    } catch {
      setRead({ error: 'This file couldn’t be read. Please use .xlsx or .csv.' });
    }
    setBusy('');
  }

  const dropped = read?.headers ? droppedColumns(read.headers, map) : null;
  const built = useMemo(() => (read?.rows ? buildItems(read.rows, map, ctx.payers, clientId) : null), [read, map, ctx.payers, clientId]);
  const unmatchedPayers = built ? [...new Set(built.items.filter(i => i.payer_name && !i.payer_id).map(i => i.payer_name))] : [];

  async function save() {
    if (!name.trim()) return setError('Please name the worklist.');
    if (!map.claim_number && !map.balance) return setError('Pick at least the Claim # or the Balance column.');
    if (!built.items.length) return setError('No claims found with these columns.');
    setError('');
    setBusy('Working out deadlines from the Payer Directory…');
    try {
      const withDeadlines = await addDeadlines(built.items, clientId ? Number(clientId) : null);
      const wl = await saveWorklist({
        name: name.trim(), client_id: clientId ? Number(clientId) : null, team: team || null, count_task: countTask || null,
        dropped_columns: dropped.patient.length + dropped.other.length,
      }, withDeadlines, user, setBusy);
      if (!wl) throw new Error('save');
      onDone(wl);
    } catch {
      setError('The worklist couldn’t be saved. Please try again.');
    }
    setBusy('');
  }

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 8 }}>⬆ Upload an aging / RTP file</div>
      <div className="text-sm" style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', marginBottom: 10 }}>
        🔒 Only claim #, payer, dates of service, amounts, aging and denial / billed dates are kept. Patient names, dates of
        birth, member IDs, MRNs and addresses are dropped here and <b>never saved</b>. Claim # and dates of service are wiped
        when the worklist is closed, or 90 days after upload.
      </div>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={e => pick(e.target.files?.[0] ?? null)} />
      {read?.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{read.error}</p>}

      {read?.headers && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <div className="field" style={{ flex: '2 1 220px' }}><label>Worklist name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. ABC Home Health – 90+ aging – Oct" />
            </div>
            <div className="field" style={{ flex: '1 1 180px' }}><label>Client</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">— Not set —</option>
                {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 150px' }}><label>Team</label>
              <select value={team} onChange={e => setTeam(e.target.value)} disabled={isSupervisor}>
                <option value="">Any team</option>
                {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}><label>Counts in the Daily Report as</label>
              <select value={countTask} onChange={e => setCountTask(e.target.value)}>
                <option value="">— Don’t link to a task —</option>
                {tasks.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="bold text-sm" style={{ margin: '6px 0' }}>Columns ({read.rows.length.toLocaleString()} rows in the file)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {FIELDS.map(f => (
              <label key={f.key} className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{f.label}
                <select value={map[f.key] ?? ''} onChange={e => setMap(m => ({ ...m, [f.key]: e.target.value || undefined }))}>
                  <option value="">— Not in the file —</option>
                  {read.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>

          {dropped && (dropped.patient.length > 0 || dropped.other.length > 0) && (
            <div className="text-sm" style={{ marginTop: 10 }}>
              {dropped.patient.length > 0 && <div>🔒 <b>Patient details — dropped, never saved:</b> {dropped.patient.join(', ')}</div>}
              {dropped.other.length > 0 && <div className="text-muted">Not needed — dropped: {dropped.other.join(', ')}</div>}
            </div>
          )}
          {built && (
            <div className="text-sm" style={{ marginTop: 8 }}>
              <span className="badge badge-green">{built.items.length.toLocaleString()} claims</span>{' '}
              {built.skipped > 0 && <span className="badge badge-gray">{built.skipped} rows skipped (no claim # or balance)</span>}{' '}
              {unmatchedPayers.length > 0 && (
                <span className="badge badge-orange" title={unmatchedPayers.slice(0, 20).join(', ')}>
                  {unmatchedPayers.length} payer name(s) not in the Payer Directory — no deadline for those
                </span>
              )}
            </div>
          )}
        </>
      )}

      {busy && <div className="text-sm text-muted" style={{ marginTop: 8 }}>⏳ {busy}</div>}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onCancel} disabled={!!busy}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={!!busy || !built?.items.length}>Save worklist</button>
      </div>
    </div>
  );
}
