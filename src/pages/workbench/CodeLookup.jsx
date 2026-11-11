import { useState, useEffect, useMemo } from 'react';
import { hasAccess } from '../../lib/access';
import {
  setOf, displayRef, detectCode, decodeHipps, refCodesReady, searchRefCodes, verifyRefCode, setRefActive,
  missingStarterRevenue, addStarterRevenue,
} from '../../lib/refCodes';
import { loadDenialCodes, parseCodeLine, findCode, searchCodes, typeOf } from '../../lib/denials';
import { RefCodeModal } from './RefCodeEditors';
import SmartImport from '../../components/shared/SmartImport';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';
import { supabase } from '../../lib/supabase';
import { masterGet, mergeCodes, mergeRefCodes, inMasterWorkspace, isMasterRow, MASTER_PREFIX } from '../../lib/masterLibrary';
import LibraryBadge from '../../components/shared/LibraryBadge';
import IcdCard from '../../components/shared/IcdCard';
import { searchIcdIndex, icdChanges, icdLatestYear, icdDot } from '../../lib/icd10';

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
  const [tab, setTab] = useState('search');            // search · changes (ICD-10-CM FY changes)
  const [fy, setFy] = useState(null);                  // newest ICD-10-CM fiscal year in the Master Library
  const [index, setIndex] = useState({ key: '', rows: [] });
  const [changes, setChanges] = useState(undefined);
  const [changeKind, setChangeKind] = useState('ALL');

  useEffect(() => {
    let alive = true;
    refCodesReady().then(ok => {
      if (!alive) return;
      setReady(ok);
      if (ok && canEdit) missingStarterRevenue().then(m => { if (alive) setStarterCount(m.length); });
    });
    // CARC / RARC: the company's codes + the Master Library's (PO 2026-11-10)
    Promise.all([loadDenialCodes(), inMasterWorkspace() ? null : masterGet('denial_codes')])
      .then(([c, m]) => { if (alive) setDenialCodes(c && m ? mergeCodes(c, m) : (c ?? [])); });
    return () => { alive = false; };
  }, [canEdit, reloadKey]);

  // ICD-10-CM (migration 55): the newest fiscal year; its changes when the tab opens
  useEffect(() => { let alive = true; icdLatestYear().then(y => alive && setFy(y)); return () => { alive = false; }; }, []);
  useEffect(() => {
    let alive = true;
    if (tab === 'changes' && fy && changes === undefined) icdChanges(fy).then(c => alive && setChanges(c));
    return () => { alive = false; };
  }, [tab, fy, changes]);

  // Database search, a moment after typing stops
  const searchKey = JSON.stringify([query.trim(), chip, limit, reloadKey]);
  useEffect(() => {
    let alive = true;
    const q = query.trim();
    const t = setTimeout(async () => {
      const want = ready && q && chip !== 'carc';
      const [rows, master] = await Promise.all([
        want ? searchRefCodes(q, { set: chip, limit: limit + 1, showInactive: canEdit }) : [],
        want && !inMasterWorkspace()
          ? searchRefCodes(q, { set: chip, limit: limit + 1, from: supabase.from(MASTER_PREFIX + 'ref_codes') }).catch(() => [])
          : null,
      ]);
      if (alive) setFound({ key: searchKey, rows: master ? mergeRefCodes(rows, master) : rows, lib: !!master });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, chip, limit, ready, canEdit, searchKey]);
  // ICD-10-CM index terms for word searches ("heart failure" → Failure > heart …)
  const indexKey = JSON.stringify([query.trim(), chip]);
  useEffect(() => {
    let alive = true;
    const q = query.trim();
    const t = setTimeout(async () => {
      const want = fy && q.length > 2 && !detectCode(q) && (chip === 'ALL' || chip === 'icd10');
      const rows = want ? await searchIcdIndex(q, 15) : [];
      if (alive) setIndex({ key: indexKey, rows });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [query, chip, fy, indexKey]);
  const indexRows = index.key === indexKey ? index.rows : [];
  const searching = found.key !== searchKey;
  const refRows = found.key === searchKey ? found.rows : [];
  const libOn = !!found.lib || denialCodes.some(isMasterRow);

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
        {fy && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 8 }} role="tablist" aria-label="Code lookup views">
            <button type="button" role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'btn-primary btn-sm' : 'btn-sm'} onClick={() => setTab('search')}>🔎 Search</button>
            <button type="button" role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'btn-primary btn-sm' : 'btn-sm'} onClick={() => setTab('changes')}>What changed in ICD-10-CM FY{fy}</button>
          </div>
        )}
      </div>

      {tab === 'changes' && <IcdChanges fy={fy} changes={changes} kind={changeKind} setKind={setChangeKind} onPick={c => { setTab('search'); setChip('ALL'); setQuery(c); setLimit(PAGE); }} />}

      {tab === 'search' && (<>

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
            {libOn && <LibraryBadge kind={isMasterRow(row) ? 'master' : row._master ? 'override' : 'company'} />}
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={openDenials}>Open in Denial Navigator ›</button>
          </div>
          <div style={{ marginTop: 4 }}>{row.plain_reason || <span className="text-muted">No plain-English reason yet.</span>}</div>
          {row.official_text && <div className="text-sm text-muted" style={{ marginTop: 2 }}>Official: {row.official_text}</div>}
        </div>
      ))}

      {refRows.slice(0, limit).map(row => {
        const icd = row.code_set === 'icd10' && (row.long_description || row.chapter ? row : row._master?.long_description ? row._master : null);
        if (icd) {
          return (
            <IcdCard key={row.id} row={icd} fy={fy} open={detected?.set === 'icd10' && detected.code === row.code && refRows.length <= 3}
              onPick={c => { setQuery(c); setLimit(PAGE); }}
              extra={libOn ? <LibraryBadge kind={isMasterRow(row) ? 'master' : row._master ? 'override' : 'company'} /> : null} />
          );
        }
        return (
        <div key={row.id} className="card mb-16" style={row.active === false ? { opacity: 0.6 } : undefined}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge badge-blue" title={setOf(row.code_set).long}>{setOf(row.code_set).label}</span>
            <span className="bold" style={{ fontSize: 17 }}>{displayRef(row.code_set, row.code)}</span>
            <CopyButton value={displayRef(row.code_set, row.code)} />
            {row.retired && <span className="badge badge-orange">Retired</span>}
            {row.list_year && <span className="text-sm text-muted">{row.list_year} list</span>}
            {row.source === 'starter' && !row.verified_at && <span className="badge badge-yellow">Starter – please verify</span>}
            {row.active === false && <span className="badge badge-gray">Inactive</span>}
            {libOn && <LibraryBadge kind={isMasterRow(row) ? 'master' : row._master ? 'override' : 'company'} />}
            {canEdit && !isMasterRow(row) && (
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
          {row._master && row._master.description && row._master.description !== row.description && (
            <div className="lib-standard-box"><LibraryBadge kind="standard" /><span>{row._master.description}</span></div>
          )}
        </div>
        );
      })}

      {indexRows.length > 0 && (
        <div className="card mb-16">
          <div className="bold" style={{ marginBottom: 6 }}>ICD-10-CM index</div>
          {indexRows.map((x, i) => (
            <div key={i} className="icd-index-row">
              <span>{x.term_path}</span>
              {x.code && <button type="button" className="btn-sm" onClick={() => { setQuery(icdDot(x.code)); setLimit(PAGE); }}>{icdDot(x.code)}</button>}
              {x.see && <span className="text-sm text-muted">see <button type="button" className="icd-from" onClick={() => setQuery(x.see)}>{x.see}</button></span>}
              {x.see_also && <span className="text-sm text-muted">see also <button type="button" className="icd-from" onClick={() => setQuery(x.see_also)}>{x.see_also}</button></span>}
            </div>
          ))}
        </div>
      )}

      {query.trim() && searching && <div className="text-sm text-muted">Searching…</div>}
      {query.trim() && !searching && !hipps && !denialRows.length && !refRows.length && !indexRows.length && (
        <div className="card text-muted" style={{ textAlign: 'center' }}>Nothing found{chip !== 'ALL' ? ' in this list' : ''}.</div>
      )}
      {refRows.length > limit && (
        <button className="btn-sm" style={{ marginBottom: 16 }} onClick={() => setLimit(l => l + PAGE)}>Show more</button>
      )}
      </>)}

      {modal?.kind === 'code' && <RefCodeModal row={modal.row ?? null} user={user} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'import' && <SmartImport typeId="ref_codes" user={user} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

/** "What changed in ICD-10-CM FY…" (migration 55): new, revised, deleted and now-a-header codes, from the yearly changes file. */
function IcdChanges({ fy, changes, kind, setKind, onPick }) {
  if (changes === undefined) return <div className="card text-sm text-muted">Loading the FY{fy} changes…</div>;
  if (!changes?.length) return <div className="card text-muted">No changes have been imported for FY{fy}.</div>;
  const kinds = [...new Set(changes.map(c => c.change))];
  const count = k => changes.filter(c => c.change === k).length;
  const shown = changes.filter(c => kind === 'ALL' || c.change === kind);
  const tone = k => (/^new/i.test(k) ? 'badge-purple' : /delet/i.test(k) ? 'badge-orange' : /header/i.test(k) ? 'badge-yellow' : 'badge-blue');
  return (
    <div className="card mb-16">
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <button type="button" className={kind === 'ALL' ? 'btn-primary btn-sm' : 'btn-sm'} onClick={() => setKind('ALL')}>All ({changes.length})</button>
        {kinds.map(k => (
          <button key={k} type="button" className={kind === k ? 'btn-primary btn-sm' : 'btn-sm'} onClick={() => setKind(k)}>{k} ({count(k)})</button>
        ))}
      </div>
      <p className="text-sm text-muted" style={{ marginTop: 0 }}>FY{fy} starts on Oct 1, {fy - 1}. Deleted codes stay searchable as Retired (valid only for earlier dates of service).</p>
      <div className="table-wrap">
        <table className="ocd-table">
          <thead><tr><th>Change</th><th>Code</th><th>Description</th></tr></thead>
          <tbody>
            {shown.map(c => (
              <tr key={`${c.change}|${c.code}`}>
                <td><span className={`badge ${tone(c.change)}`}>{c.change}</span></td>
                <td><button type="button" className="icd-from" style={{ marginLeft: 0 }} onClick={() => onPick(icdDot(c.code))}>{icdDot(c.code)}</button></td>
                <td>{c.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
