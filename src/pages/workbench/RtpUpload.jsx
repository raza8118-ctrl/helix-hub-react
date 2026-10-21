import { useState, useMemo } from 'react';
import { RTP_FIELDS, detectRtpColumns, buildRtpRows, applyRtpUpload } from '../../lib/medicareTrackers';
import { readWorklistFile, PHI_HEADER } from '../../lib/worklist';
import Modal from '../../components/shared/Modal';

/**
 * RTP / suspense upload (roadmap 7.5): a FISS / DDE claim list for one client. Patient columns are dropped in the
 * browser and never saved; only claim # / DCN, status-location, reason code, amount and date in status are kept.
 * Claims missing from the new file are marked “Cleared from FISS”.
 */
export default function RtpUpload({ ctx, existing, user, onClose, onDone }) {
  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState(null);                // { name, headers, rows } — memory only
  const [map, setMap] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function pick(f) {
    setError(''); setFile(null);
    if (!f) return;
    const r = await readWorklistFile(f);
    if (r.error) return setError(r.error);
    setFile({ name: f.name, headers: r.headers, rows: r.rows });
    setMap(detectRtpColumns(r.headers).map);
  }

  const cid = clientId ? Number(clientId) : null;
  const preview = useMemo(() => {
    if (!file || !map.claim_number) return null;
    const { items, skipped } = buildRtpRows(file.rows, map);
    const kept = new Set(Object.values(map).filter(Boolean));
    const dropped = file.headers.filter(h => !kept.has(h));
    const known = new Set(existing.filter(i => i.client_id === cid && !i.cleared && i.claim_number).map(i => i.claim_number.toUpperCase()));
    const inFile = new Set(items.map(i => i.claim_number.toUpperCase()));
    const stillListed = existing.filter(i => i.client_id === cid && !i.cleared && i.claim_number && i.in_fiss !== false);
    return {
      items, skipped,
      added: items.filter(i => !known.has(i.claim_number.toUpperCase())).length,
      updated: items.filter(i => known.has(i.claim_number.toUpperCase())).length,
      cleared: stillListed.filter(i => !inFile.has(i.claim_number.toUpperCase())).length,
      patient: dropped.filter(h => PHI_HEADER.test(h)), other: dropped.filter(h => !PHI_HEADER.test(h)),
    };
  }, [file, map, existing, cid]);

  async function save() {
    if (!cid) return setError('Choose the client this list is for.');
    if (!preview) return setError('Choose the claim # / DCN column.');
    setSaving(true);
    const r = await applyRtpUpload(cid, preview.items, existing, file.rows.length, user);
    setSaving(false);
    if (!r) return setError('Could not save. Please try again.');
    setFile(null);   // drop the file contents from memory
    onDone(r);
  }

  return (
    <Modal title="⬆ Upload RTP / suspense list" onClose={onClose} wide>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 220px' }}><label>Client</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">— Choose —</option>
            {ctx.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 260px' }}><label>FISS / DDE list (Excel or CSV)</label>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => pick(e.target.files?.[0])} />
        </div>
      </div>

      {file && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {RTP_FIELDS.map(f => (
              <div key={f.key} className="field" style={{ flex: '1 1 180px' }}><label>{f.label}{f.required ? '' : ' (optional)'}</label>
                <select value={map[f.key] ?? ''} onChange={e => setMap(m => ({ ...m, [f.key]: e.target.value || undefined }))}>
                  <option value="">— Not in the file —</option>
                  {file.headers.filter(h => !PHI_HEADER.test(h)).map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {preview && (
            <div className="text-sm" style={{ marginBottom: 8 }}>
              <div><b>{file.rows.length}</b> rows → <b>{preview.items.length}</b> claims{preview.skipped ? ` (${preview.skipped} rows without a claim # skipped)` : ''}.</div>
              {cid && <div>New: <b>{preview.added}</b> · Updated: <b>{preview.updated}</b> · Will be marked “Cleared from FISS”: <b>{preview.cleared}</b></div>}
              {preview.patient.length > 0 && <div style={{ color: 'var(--danger)' }}>🔒 Patient columns dropped (never saved): {preview.patient.join(', ')}</div>}
              {preview.other.length > 0 && <div className="text-muted">Not used: {preview.other.join(', ')}</div>}
            </div>
          )}
        </>
      )}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="form-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving || !preview || !cid}>{saving ? 'Saving…' : 'Upload'}</button>
      </div>
    </Modal>
  );
}
