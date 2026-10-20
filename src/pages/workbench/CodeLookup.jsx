import { useState, useEffect, useMemo } from 'react';
import { hasAccess } from '../../lib/access';
import {
  setOf, displayRef, detectCode, decodeHipps, refCodesReady, searchRefCodes, verifyRefCode, setRefActive,
  missingStarterRevenue, addStarterRevenue,
} from '../../lib/refCodes';
import { loadDenialCodes, parseCodeLine, findCode, searchCodes, typeOf } from '../../lib/denials';
import { RefCodeModal, RefImportModal } from './RefCodeEditors';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';

const CHIPS = [
  { value: 'ALL', label: 'All' }, { value: 'carc', label: 'CARC / RARC' }, { value: 'revenue', label: 'Revenue' },
  { value: 'hipps', label: 'HIPPS' }, { value: 'icd10', label: 'ICD-10' },
];
const PAGE = 50;

/**
 * 🔎 Code lookup (roadmap 6.3): one search box across CARC / RARC (Denial library), revenue codes, HIPPS (with a
 * home health PDGM decoder) and ICD-10-CM. Searches run in the database and are never saved or logged.
 */
export default function CodeLookup({ user }) {
  const canEdit = hasAccess(user, 'ref_codes_edit');
  const [ready, setReady] = useState(undefined);       // undefined = checking, false = table missing
  const [denialCodes, setDenialCodes] = useState([]);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [found, setFound] = useState({ key: '', rows: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [starterCount, setStarterCount] = useState(0);
  const [modal, setModal] = useState(null);            // { kind: 'code' | 'import', row? }

  useEffect(() => {
    let alive = true;
    refCodesReady().then(ok => {
      if (!alive) return;
      setReady(ok);
      if (ok && canEdit) missingStarterRevenue().then(m => { if (alive) setStarterCount(m.length); });
    });
    loadDenialCodes().then(c => { if (alive) setDenialCodes(c ?? []); });
    return () => { alive = false; };
  }, [canEdit, reloadKey]);

  // Database search, a moment after typing stops
  const searchKey = JSON.stringify([query.trim(), chip, limit, reloadKey]);
  useEffect(() => {
    let alive = true;
    const q = query.trim();
    const t = setTimeout(async () => {
      const rows = ready && q && chip !== 'carc'
        ? await searchRefCodes(q, { set: chip, limit: limit + 1, showInactive: canEdit })
        : [];
      if (alive) setFound({ key: searchKey, rows });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, chip, limit, ready, canEdit, searchKey]);
  const searching = found.key !== searchKey;
  const refRows = found.key === searchKey ? found.rows : [];

  // CARC / RARC from the Denial library (already in the browser)
  const denialRows = useMemo(() => {
    const q = query.trim();
    if (!q || !(chip === 'ALL' || chip === 'carc')) return [];
    const parsed = parseCodeLine(q);
    if (parsed) return parsed.map(p => findCode(denialCodes, p)).filter(Boolean);
    return searchCodes(denialCodes, q).slice(0, chip === 'carc' ? 100 : 10);
  }, [query, chip, denialCodes]);

  const detected = detectCode(query);
  const hipps = (chip === 'ALL' || chip === 'hipps') && detected?.set === 'hipps' ? decodeHipps(detected.code) : null;
  const done = () => { setModal(null); setReloadKey(k => k + 1); };

  async function verify(row) {
    if (await confirmDialog({ title: 'Mark this code as verified?', message: `${displayRef(row.code_set, row.code)} — ${row.description}`, confirmText: 'Mark Verified' })
      && await verifyRefCode(row, user)) setReloadKey(k => k + 1);
  }
  async function toggle(row) {
    const off = row.active !== false;
    if (!await confirmDialog(off
      ? { title: 'Make this code inactive?', message: 'It will be hidden from searches. Nothing is deleted.', confirmText: 'Make Inactive', tone: 'warning' }
      : { title: 'Reactivate this code?', message: row.description ?? '', confirmText: 'Reactivate' })) return;
    if (await setRefActive(row, !off, user)) setReloadKey(k => k + 1);
  }
  async function addStarters() {
    const missing = await missingStarterRevenue();
    if (!missing.length) return;
    if (!await confirmDialog({ title: `Add ${missing.length} starter revenue codes?`, message: 'Common home health and hospice revenue codes in our own short wording, marked “please verify”.', confirmText: 'Add' })) return;
    if (await addStarterRevenue(missing, user)) setReloadKey(k => k + 1);
  }
  const openDenials = () => window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_denials' }));

  return (
    <div>
      {ready === false && (
        <div className="card mb-16 text-sm text-muted">
          Revenue, HIPPS and ICD-10 lists need the code lists database update (<code>20261021i_ref_codes.sql</code>).
          CARC / RARC search and the HIPPS decoder already work.
        </div>
      )}
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="search" value={query} autoFocus onChange={e => { setQuery(e.target.value); setLimit(PAGE); }}
            placeholder="e.g. 0551 · 1FC21 · I50.9 · CO-16 · heart failure · physical therapy"
            style={{ flex: '1 1 280px', minWidth: 0, fontSize: 16 }} />
          {canEdit && ready && (
            <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {starterCount > 0 && <button className="btn-sm" onClick={addStarters}>Add starter revenue codes ({starterCount})</button>}
              <button className="btn-sm" onClick={() => setModal({ kind: 'import' })}>⬆ Import list</button>
              <button className="btn-sm" onClick={() => setModal({ kind: 'code' })}>+ Add code</button>
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
          {CHIPS.map(c => (
            <button key={c.value} type="button" className={chip === c.value ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={chip === c.value}
              onClick={() => { setChip(c.value); setLimit(PAGE); }}>{c.label}</button>
          ))}
        </div>
        <div className="text-sm text-muted" style={{ marginTop: 6 }}>🔒 Searches aren’t saved. Type codes or words only — no patient details.</div>
      </div>

      {hipps && (
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className="badge badge-blue">HIPPS</span><span className="bold" style={{ fontSize: 18 }}>{detected.code}</span>
            <CopyButton value={detected.code} />
            <span className="text-sm text-muted">Home health PDGM</span>
          </div>
          {hipps.map(p => <div key={p.pos} className="text-sm"><b>{p.pos}. {p.char}</b> — {p.meaning}</div>)}
          <div className="text-sm text-muted" style={{ marginTop: 6 }}>⚠ Check current CMS rules — verify against the CMS HIPPS table for the year.</div>
        </div>
      )}

      {denialRows.map(row => (
        <div key={`d${row.id}`} className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge badge-blue">{typeOf(row.code_type).label}</span>
            <span className="bold" style={{ fontSize: 17 }}>{row.code}</span>
            <CopyButton value={row.code} />
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={openDenials}>Open in Denial Navigator ›</button>
          </div>
          <div style={{ marginTop: 4 }}>{row.plain_reason || <span className="text-muted">No plain-English reason yet.</span>}</div>
          {row.official_text && <div className="text-sm text-muted" style={{ marginTop: 2 }}>Official: {row.official_text}</div>}
        </div>
      ))}

      {refRows.slice(0, limit).map(row => (
        <div key={row.id} className="card mb-16" style={row.active === false ? { opacity: 0.6 } : undefined}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge badge-blue" title={setOf(row.code_set).long}>{setOf(row.code_set).label}</span>
            <span className="bold" style={{ fontSize: 17 }}>{displayRef(row.code_set, row.code)}</span>
            <CopyButton value={displayRef(row.code_set, row.code)} />
            {row.retired && <span className="badge badge-orange">Retired</span>}
            {row.list_year && <span className="text-sm text-muted">{row.list_year} list</span>}
            {row.source === 'starter' && !row.verified_at && <span className="badge badge-yellow">Starter – please verify</span>}
            {row.active === false && <span className="badge badge-gray">Inactive</span>}
            {canEdit && (
              <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                {!row.verified_at && <button className="btn-sm" onClick={() => verify(row)}>✓ Verified</button>}
                <button className="btn-sm" title="Edit" onClick={() => setModal({ kind: 'code', row })}>✎</button>
                <button className="btn-sm" title={row.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => toggle(row)}>{row.active === false ? '↺' : '⊘'}</button>
              </span>
            )}
          </div>
          <div style={{ marginTop: 4 }}>{row.description}</div>
          {row.code_set === 'hipps' && decodeHipps(row.code) && (
            <div className="text-sm text-muted" style={{ marginTop: 2 }}>{decodeHipps(row.code).slice(0, 4).map(p => p.meaning).join(' · ')}</div>
          )}
          {row.notes && <div className="text-sm" style={{ marginTop: 2 }}>📝 {row.notes}</div>}
        </div>
      ))}

      {query.trim() && searching && <div className="text-sm text-muted">Searching…</div>}
      {query.trim() && !searching && !hipps && !denialRows.length && !refRows.length && (
        <div className="card text-muted" style={{ textAlign: 'center' }}>Nothing found{chip !== 'ALL' ? ' in this list' : ''}.</div>
      )}
      {refRows.length > limit && (
        <button className="btn-sm" style={{ marginBottom: 16 }} onClick={() => setLimit(l => l + PAGE)}>Show more</button>
      )}

      {modal?.kind === 'code' && <RefCodeModal row={modal.row ?? null} user={user} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'import' && <RefImportModal user={user} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}
