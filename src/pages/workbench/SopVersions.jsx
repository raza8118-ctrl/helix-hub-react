import { useState } from 'react';
import { today } from '../../lib/helpers';
import { publishSopVersion } from '../../lib/sopVersions';
import { makeClientCopy } from './sopActions';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** "Publish new version" pop-up (roadmap 3.4): change note, effective date, must-acknowledge. */
export function PublishVersionModal({ sop, versions, user, onClose, onPublished }) {
  const nextNo = Math.max(0, ...(versions ?? []).map(v => v.version_no)) + 1;
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [requiresAck, setRequiresAck] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const future = date > today();

  async function publish() {
    if (!note.trim()) return setError('Please say what changed (e.g. “Step 4 updated for the new Waystar screen”).');
    if (!date || date < today()) return setError('The effective date can’t be in the past.');
    if (!await confirmDialog({
      title: `Publish v${nextNo}?`,
      message: future
        ? `Readers keep seeing the current version until ${fmtDay(date)}, then v${nextNo} replaces it.`
        : `Readers will see v${nextNo} straight away; the previous version is archived.`,
      confirmText: 'Publish',
    })) return;
    setSaving(true);
    const version = await publishSopVersion(sop, { changeNote: note.trim(), effectiveDate: date, requiresAck }, versions, user);
    setSaving(false);
    if (!version) return setError('Could not publish. Please try again.');
    onPublished(version);
  }

  return (
    <Modal title={`Publish new version — v${nextNo}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          Publishing freezes the current working copy (text, steps, screenshots and videos) as <b>v{nextNo}</b> of “{sop.title}”.
        </p>
        <div className="field">
          <label>What changed? *</label>
          <textarea rows={3} value={note} onChange={e => { setNote(e.target.value); setError(''); }}
            placeholder={nextNo === 1 ? 'e.g. First version' : 'e.g. Step 4 updated for the new Waystar screen'} />
        </div>
        <div className="field">
          <label>Takes effect on</label>
          <input type="date" value={date} min={today()} onChange={e => { setDate(e.target.value); setError(''); }} style={{ maxWidth: 200 }} />
          {future && <div className="text-sm text-muted" style={{ marginTop: 4 }}>Until then readers keep seeing the current version.</div>}
        </div>
        <label className="row text-sm" style={{ gap: 8, cursor: 'pointer', marginBottom: 12 }}>
          <input type="checkbox" checked={requiresAck} onChange={e => setRequiresAck(e.target.checked)} />
          Everyone who uses this SOP must acknowledge this version
        </label>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          “Everyone” = the teams ticked under “Who uses it” (or all users if none are ticked).
        </p>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={publish} disabled={saving}>{saving ? 'Publishing…' : `Publish v${nextNo}`}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Version history list for editors: every version with its state, date, who published it and the change note. */
export function VersionHistory({ versions, states, names, viewingId, onView }) {
  const label = v => v === states.current ? { text: 'Current', badge: 'badge-green' }
    : states.upcoming.includes(v) ? { text: `Takes effect ${fmtDay(v.effective_date)}`, badge: 'badge-blue' }
    : { text: 'Archived', badge: 'badge-gray' };
  return (
    <div className="card mb-16">
      <div className="card-title" style={{ marginBottom: 8 }}>🕘 Version history</div>
      {!versions.length && <div className="text-sm text-muted">Not published yet — readers can’t see this SOP until v1 is published.</div>}
      {[...versions].reverse().map(v => {
        const l = label(v);
        return (
          <div key={v.id} className="row" style={{
            gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)',
          }}>
            <span className="bold">v{v.version_no}</span>
            <span className={`badge ${l.badge}`}>{l.text}</span>
            {v.requires_ack && <span className="badge badge-orange">Acknowledge</span>}
            <span className="text-sm text-muted">
              Effective {fmtDay(v.effective_date)} · published {fmtDate(v.published_at)} by {names[v.published_by] ?? v.published_by ?? '—'}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              {viewingId === v.id
                ? <span className="text-sm text-muted">Viewing</span>
                : <button className="btn-sm" onClick={() => onView(v)}>View</button>}
            </span>
            <div className="text-sm" style={{ flexBasis: '100%', whiteSpace: 'pre-wrap' }}>{v.change_note}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Pick a client and copy a common SOP into a new client draft. */
export function ClientCopyModal({ sop, lib, user, onClose, onCopied }) {
  const clients = (lib.clients ?? []).filter(c => c.active !== false);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);

  async function copy() {
    const client = clients.find(c => String(c.id) === clientId);
    if (!client) return;
    setBusy(true);
    const row = await makeClientCopy(sop, client, lib, user);
    setBusy(false);
    if (row) onCopied(row);
  }

  return (
    <Modal title="Make a client copy" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          Copies “{sop.title}” into a new <b>draft</b> for one client. The client’s SOP is listed first under this task.
        </p>
        {clients.length === 0
          ? <p className="text-sm text-muted">No clients yet — add them under Clients &amp; Payers first.</p>
          : (
            <div className="field">
              <label>Client</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">— Choose —</option>
                {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>
          )}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={copy} disabled={!clientId || busy}>{busy ? 'Copying…' : 'Make Copy'}</button>
        </div>
      </div>
    </Modal>
  );
}
