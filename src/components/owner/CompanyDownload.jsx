import { useState } from 'react';
import Modal from '../shared/Modal';
import { downloadCompanyData } from '../../lib/companyData';

/**
 * Owner → Company Data → "⬇ Download Excel" (PO 2026-11-10, Stage 2). One company or every company (Company column).
 * Modules that may hold patient information need a warning acknowledged and a typed reason; every download is logged
 * (owner log + each company's Audit Log) with the row count and the reason. The file is built in the browser only.
 */
const MIN_REASON = 10;

export default function CompanyDownload({ owner, mod, company, companies, onClose }) {
  const [all, setAll] = useState(false);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const ready = !mod.phi || (ack && reason.trim().length >= MIN_REASON);

  async function go() {
    setErr(''); setBusy('Preparing the file…');
    try {
      const r = await downloadCompanyData({
        owner, mod, companies: all ? companies : [company], all, reason: mod.phi ? reason.trim() : null, onProgress: setBusy,
      });
      setDone(r);
    } catch (e) {
      setErr(`The file couldn’t be made (${e.message}). Nothing was downloaded.`);
    }
    setBusy('');
  }

  return (
    <Modal title={`Download Excel — ${mod.label}`} onClose={busy ? () => {} : onClose}>
      {!done ? (
        <div className="ocd-dl">
          <fieldset className="ocd-scope">
            <legend className="text-sm text-muted">Which data?</legend>
            <label className="omp-check">
              <input type="radio" name="ocd-scope" checked={!all} onChange={() => setAll(false)} />
              <span>Only <strong>{company.name}</strong></span>
            </label>
            <label className="omp-check">
              <input type="radio" name="ocd-scope" checked={all} onChange={() => setAll(true)} />
              <span>All {companies.length} companies <span className="text-sm text-muted">— one file with a Company column</span></span>
            </label>
          </fieldset>
          <p className="text-sm text-muted" style={{ margin: '6px 0' }}>
            {mod.views.map(v => v.label).join(', ')}{mod.id === 'payers' ? ', plus sheets for payer IDs, contacts, filing limits and notes' : mod.id === 'denials' ? ', plus a sheet with the steps' : ''}.
            The file is made in your browser — nothing is sent anywhere else.
          </p>

          {mod.phi && (
            <div className="ocd-warn" role="alert">
              <p style={{ margin: '0 0 6px' }}>
                ⚠ <strong>This file may contain patient information</strong> (claim numbers, dates of service, amounts, notes).
                Keep it on a company computer, never email it outside 3Gen, never upload it to an AI tool or a website, and delete it when you’re done.
              </p>
              <label className="omp-check">
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                <span>I understand and need this file for work.</span>
              </label>
              <label className="ocd-reason">
                <span className="text-sm">Reason (recorded in your owner log and the company’s Audit Log)</span>
                <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
                  placeholder="e.g. Monthly ADR review with the client manager" aria-label="Reason for the download" />
                {reason.trim().length > 0 && reason.trim().length < MIN_REASON && <span className="text-sm text-muted">A few more words, please.</span>}
              </label>
            </div>
          )}

          {busy && <div className="loading-row"><div className="spinner" /> {busy}</div>}
          {err && <p className="ot-err" role="alert">{err}</p>}
          <div className="si-actions">
            <button type="button" className="btn-sm" onClick={onClose} disabled={!!busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={go} disabled={!!busy || !ready}>⬇ Download</button>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ marginTop: 0 }}>✓ Downloaded <strong>{done.file}</strong> — {done.rows.toLocaleString()} rows from {done.companies} compan{done.companies === 1 ? 'y' : 'ies'}.</p>
          <p className="text-sm text-muted">Recorded in your owner log and {done.companies === 1 ? 'the company’s' : 'each company’s'} Audit Log{mod.phi ? ', with your reason' : ''}.</p>
          <div className="si-actions"><button type="button" className="btn-primary" onClick={onClose}>Close</button></div>
        </div>
      )}
    </Modal>
  );
}
