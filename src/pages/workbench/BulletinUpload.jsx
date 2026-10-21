import { useState } from 'react';
import {
  UPDATE_CATEGORIES, scanBulletin, extractBulletin, blankUpdate, rowWarnings, checkBulletin, saveBulletin,
} from '../../lib/payerUpdates';
import { TEAMS } from '../../lib/constants';
import PayerSearch from '../../components/shared/PayerSearch';

/**
 * ⬆ Upload bulletin (roadmap 8.1): PDF → local patient-word scan + confirmation → ✨ Extract with AI (or add rows by
 * hand) → review / edit rows → Save (PDF stored privately). Only the PDF and fixed instructions go to the AI.
 */
export default function BulletinUpload({ ctx, user, onSaved }) {
  const [file, setFile] = useState(null);
  const [scan, setScan] = useState(null);                 // { pages, hits } | { error }
  const [noPhi, setNoPhi] = useState(false);
  const [checkedHits, setCheckedHits] = useState(false);
  const [bulletin, setBulletin] = useState(null);         // { title, issuer, published_on } once extracting / by hand
  const [rows, setRows] = useState([]);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [inputKey, setInputKey] = useState(0);           // resets the file box after Cancel / Save

  async function pick(f) {
    setFile(f ?? null); setScan(null); setNoPhi(false); setCheckedHits(false); setBulletin(null); setRows([]); setError('');
    if (!f) { setInputKey(k => k + 1); return; }
    setBusy('Checking the PDF…');
    setScan(await scanBulletin(f));
    setBusy('');
  }

  const cleared = scan && !scan.error && noPhi && (!scan.hits.length || checkedHits);

  async function extract() {
    setError(''); setBusy('Reading the bulletin with AI — this can take a minute…');
    try {
      const r = await extractBulletin(file, ctx.payers, scan.pages, user);
      setBulletin({ ...r.bulletin, title: r.bulletin.title || file.name.replace(/\.pdf$/i, '') });
      setRows(r.rows.length ? r.rows : [blankUpdate()]);
      setAi(true);
      if (!r.rows.length) setError('The AI found no changes that need action. Add rows by hand if you think it missed something.');
    } catch (e) {
      setError(e.message === 'NO_KEY' ? 'No AI key is saved in Settings — an admin can add one. You can add the rows by hand.' : e.message);
    }
    setBusy('');
  }
  function byHand() {
    setBulletin({ title: file.name.replace(/\.pdf$/i, ''), issuer: '', published_on: '' });
    setRows([blankUpdate()]); setAi(false); setError('');
  }

  const setRow = (key, patch) => setRows(list => list.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const toggleTeam = (r, t) => setRow(r.key, { teams: r.teams.includes(t) ? r.teams.filter(x => x !== t) : [...r.teams, t] });
  const warnings = rowWarnings(rows);

  async function save() {
    const problem = checkBulletin(bulletin, rows);
    if (problem) return setError(problem);
    setBusy('Saving…'); setError('');
    const saved = await saveBulletin(file, bulletin, rows, { pages: scan.pages, ai }, user);
    setBusy('');
    if (!saved) return setError('Could not save. Please try again.');
    pick(null);
    onSaved(saved);
  }

  return (
    <div className="card mb-16">
      <div className="card-header"><div className="card-title">⬆ Upload a payer bulletin</div></div>
      <div className="field"><label>Bulletin PDF (payer newsletter, policy update, MAC bulletin)</label>
        <input key={inputKey} type="file" accept=".pdf,application/pdf" disabled={!!busy || !!bulletin} onChange={e => pick(e.target.files?.[0])} />
      </div>
      {busy && <p className="text-sm text-muted">{busy}</p>}
      {scan?.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{scan.error}</p>}

      {scan && !scan.error && !bulletin && (
        <>
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>{scan.pages} {scan.pages === 1 ? 'page' : 'pages'}.</p>
          {scan.hits.length > 0 && (
            <div className="card mb-16" style={{ borderLeft: '4px solid var(--danger)' }}>
              <div className="bold" style={{ color: 'var(--danger)' }}>⚠ Possible patient details found</div>
              {scan.hits.slice(0, 10).map(h => <div key={h.page} className="text-sm">Page {h.page}: {h.words.join(', ')}</div>)}
              <p className="text-sm" style={{ marginBottom: 6 }}>Bulletins sometimes use these words in instructions (e.g. “put the member ID on the claim”). If this file holds real patient information, do not upload it.</p>
              <label className="row text-sm" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={checkedHits} onChange={e => setCheckedHits(e.target.checked)} />
                I checked those pages — there are no patient details
              </label>
            </div>
          )}
          <label className="row text-sm" style={{ gap: 6, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={noPhi} onChange={e => setNoPhi(e.target.checked)} />
            This is a payer bulletin with no patient information
          </label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={!cleared || !!busy} onClick={extract}>✨ Extract with AI</button>
            <button className="btn-sm" disabled={!cleared || !!busy} onClick={byHand}>Add rows by hand</button>
          </div>
        </>
      )}

      {bulletin && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <div className="field" style={{ flex: '2 1 260px' }}><label>Bulletin title</label>
              <input type="text" value={bulletin.title} maxLength={200} onChange={e => setBulletin(b => ({ ...b, title: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: '1 1 180px' }}><label>Issued by</label>
              <input type="text" value={bulletin.issuer} maxLength={120} onChange={e => setBulletin(b => ({ ...b, issuer: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: '1 1 150px' }}><label>Published</label>
              <input type="date" value={bulletin.published_on} onChange={e => setBulletin(b => ({ ...b, published_on: e.target.value }))} />
            </div>
          </div>
          {ai && <p className="text-sm text-muted" style={{ marginTop: 0 }}>✨ Rows suggested by AI — check each one against the bulletin before saving.</p>}

          {rows.map((r, i) => {
            const payer = r.payer_id ? ctx.payers.find(p => p.id === r.payer_id) : null;
            const warn = warnings[r.key] ?? [];
            return (
              <div key={r.key} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', ...(warn.length ? { background: 'var(--warning-bg, rgba(250, 204, 21, 0.08))' } : {}) }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="bold">{i + 1}.</span>
                  {warn.includes('payer') && <span className="badge badge-yellow">No payer</span>}
                  {warn.includes('date') && <span className="badge badge-yellow">No effective date</span>}
                  {r.source_page && <span className="text-sm text-muted">page {r.source_page}</span>}
                  <button type="button" className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setRows(list => list.filter(x => x.key !== r.key))} aria-label="Delete row">✕</button>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: '1 1 240px' }}><label>Payer</label>
                    {payer
                      ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span><button type="button" className="btn-sm" onClick={() => setRow(r.key, { payer_id: null })}>✕</button></div>
                      : (
                        <>
                          <PayerSearch payers={ctx.payers} onSelect={p => setRow(r.key, { payer_id: p.id })} placeholder="Match to the Payer Directory…" />
                          <input type="text" style={{ marginTop: 4 }} value={r.payer_name} maxLength={120} placeholder="…or as written in the bulletin"
                            onChange={e => setRow(r.key, { payer_name: e.target.value })} />
                          {r.payer_name && <span className="text-sm text-muted">Not in the Payer Directory</span>}
                        </>
                      )}
                  </div>
                  <div className="field" style={{ flex: '0 1 160px' }}><label>Effective date</label>
                    <input type="date" value={r.effective_date} onChange={e => setRow(r.key, { effective_date: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: '1 1 180px' }}><label>Category</label>
                    <select value={r.category} onChange={e => setRow(r.key, { category: e.target.value })}>
                      {UPDATE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field"><label>What changed</label>
                  <textarea rows={2} maxLength={1000} value={r.change_text} onChange={e => setRow(r.key, { change_text: e.target.value })} />
                </div>
                <div className="field"><label>Action needed</label>
                  <input type="text" value={r.action_needed} maxLength={500} placeholder="e.g. Add modifier KX on all claims from the effective date" onChange={e => setRow(r.key, { action_needed: e.target.value })} />
                </div>
                <div className="row text-sm" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span className="text-muted">Teams:</span>
                  {TEAMS.map(t => (
                    <label key={t} className="row" style={{ gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={r.teams.includes(t)} onChange={() => toggleTeam(r, t)} /> {t}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <button type="button" className="btn-sm" style={{ marginTop: 6 }} onClick={() => setRows(list => [...list, blankUpdate()])}>+ Add a change</button>
          {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div className="form-actions">
            <button className="btn-sm" disabled={!!busy} onClick={() => pick(null)}>Cancel</button>
            <button className="btn-primary" disabled={!!busy} onClick={save}>{busy === 'Saving…' ? 'Saving…' : `Save bulletin (${rows.length} ${rows.length === 1 ? 'change' : 'changes'})`}</button>
          </div>
        </>
      )}
      {!bulletin && error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
