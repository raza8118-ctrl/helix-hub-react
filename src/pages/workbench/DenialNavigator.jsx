import { useState, useEffect, useMemo } from 'react';
import { hasAccess } from '../../lib/access';
import {
  CODE_TYPES, CATEGORIES, GROUP_CODES, typeOf, loadDenialCodes, parseCodeLine, findCode, searchCodes, isRetired,
  verifyCode, setCodeActive, missingStarterCodes,
} from '../../lib/denials';
import { DenialCodeModal, DenialImportModal, DenialStarterModal } from './DenialEditors';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const PAGE = 60;

// One code: type, code + copy, badges, plain reason first, official wording below; editor buttons when allowed
function CodeCard({ row, group, canEdit, onVerify, onEdit, onToggle }) {
  const t = typeOf(row.code_type);
  return (
    <div className="card mb-16" style={row.active === false ? { opacity: 0.6 } : undefined}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="badge badge-blue" title={t.long}>{t.label}</span>
        <span className="bold" style={{ fontSize: 18 }}>{group ? `${group}-` : ''}{row.code}</span>
        <CopyButton value={row.code} label="Copy" />
        {row.category && <span className="badge badge-gray">{row.category}</span>}
        {isRetired(row) && <span className="badge badge-orange" title={`No longer used after ${fmtDay(row.stopped_on)}`}>Retired {fmtDay(row.stopped_on)}</span>}
        {!row.verified_at && row.source === 'starter' && <span className="badge badge-yellow">Starter – please verify</span>}
        {row.active === false && <span className="badge badge-gray">Inactive</span>}
        {canEdit && (
          <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
            {!row.verified_at && <button className="btn-sm" onClick={() => onVerify(row)}>✓ Verified</button>}
            <button className="btn-sm" title="Edit" onClick={() => onEdit(row)}>✎</button>
            <button className="btn-sm" title={row.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => onToggle(row)}>
              {row.active === false ? '↺' : '⊘'}
            </button>
          </span>
        )}
      </div>
      <div style={{ marginTop: 6, lineHeight: 1.5 }}>
        {row.plain_reason || <span className="text-muted">No plain-English reason yet.</span>}
      </div>
      {row.official_text && (
        <div className="text-sm text-muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>Official: {row.official_text}</div>
      )}
      {row.notes && <div className="text-sm" style={{ marginTop: 4 }}>📝 {row.notes}</div>}
      {row.verified_at && <div className="text-sm text-muted" style={{ marginTop: 4 }}>Verified {fmtDate(row.verified_at)}</div>}
    </div>
  );
}

/**
 * 🧩 Denial Navigator (roadmap Phase 4). 4.1 = Denial library: CARC / RARC / group codes with plain-English reasons.
 * Search by code or words, or paste a line from an ERA / EOB (searched in the browser only — never saved or logged).
 */
export default function DenialNavigator({ user }) {
  const canEdit = hasAccess(user, 'denials_edit');
  const [codes, setCodes] = useState(undefined);     // undefined = loading, null = not set up
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [showRetired, setShowRetired] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [onlyUnverified, setOnlyUnverified] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [modal, setModal] = useState(null);           // { kind: 'code' | 'import' | 'starter', row?, presetCode? }

  const reload = () => loadDenialCodes().then(setCodes);
  useEffect(() => {
    let alive = true;
    loadDenialCodes().then(c => { if (alive) setCodes(c); });
    return () => { alive = false; };
  }, []);

  const parsed = useMemo(() => parseCodeLine(query), [query]);
  const results = useMemo(() => codes && !parsed ? searchCodes(codes, query, {
    type, category, showRetired, showInactive: canEdit && showInactive, onlyUnverified: canEdit && onlyUnverified,
  }) : [], [codes, parsed, query, type, category, showRetired, showInactive, onlyUnverified, canEdit]);
  const starterCount = codes ? missingStarterCodes(codes).length : 0;

  const close = () => setModal(null);
  const saved = () => { setModal(null); reload(); };
  async function verify(row) {
    if (!await confirmDialog({ title: `Mark ${typeOf(row.code_type).label} ${row.code} as verified?`, message: 'Only after checking the plain-English reason is correct.', confirmText: 'Mark Verified' })) return;
    if (await verifyCode(row, user)) reload();
  }
  async function toggleActive(row) {
    const off = row.active !== false;
    if (!await confirmDialog(off
      ? { title: `Make ${row.code} inactive?`, message: 'It will be hidden from searches. Nothing is deleted.', confirmText: 'Make Inactive', tone: 'warning' }
      : { title: `Reactivate ${row.code}?`, message: row.plain_reason ?? '', confirmText: 'Reactivate' })) return;
    if (await setCodeActive(row, !off, user)) reload();
  }
  const cardProps = { canEdit, onVerify: verify, onEdit: row => setModal({ kind: 'code', row }), onToggle: toggleActive };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">🧩 Denial Navigator</div>
          <div className="page-subtitle">Look up a denial or remark code — or paste the codes from an ERA / EOB line.</div>
        </div>
        {canEdit && codes && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {starterCount > 0 && <button className="btn-sm" onClick={() => setModal({ kind: 'starter' })}>Add starter codes ({starterCount})</button>}
            <button className="btn-sm" onClick={() => setModal({ kind: 'import' })}>⬆ Import official list</button>
            <button className="btn-sm" onClick={() => setModal({ kind: 'code' })}>+ Add code</button>
          </div>
        )}
      </div>

      {codes === undefined && <div className="card text-muted">Loading…</div>}
      {codes === null && (
        <div className="card text-muted">
          The Denial library isn’t set up yet. An admin needs to run the denial codes database update
          (<code>20261021d_denial_codes.sql</code>) in Supabase.
        </div>
      )}

      {codes && (
        <>
          <div className="card mb-16">
            <input type="search" value={query} autoFocus onChange={e => { setQuery(e.target.value); setLimit(PAGE); }}
              placeholder="e.g. CO-16 N290  ·  197  ·  “prior auth”  ·  timely filing"
              style={{ width: '100%', fontSize: 16 }} />
            {!parsed && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                <select value={type} onChange={e => setType(e.target.value)} style={{ maxWidth: 160 }}>
                  <option value="ALL">All types</option>
                  {CODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <select value={category} onChange={e => setCategory(e.target.value)} style={{ maxWidth: 220 }}>
                  <option value="ALL">All categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Show retired
                </label>
                {canEdit && (
                  <>
                    <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={onlyUnverified} onChange={e => setOnlyUnverified(e.target.checked)} /> Not verified only
                    </label>
                    <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
                    </label>
                  </>
                )}
              </div>
            )}
            <div className="text-sm text-muted" style={{ marginTop: 6 }}>🔒 What you type here is never saved. Paste codes only — no patient details.</div>
          </div>

          {codes.length === 0 && (
            <div className="card text-muted" style={{ textAlign: 'center' }}>
              The library is empty.{canEdit ? ' Use “Add starter codes” or “Import official list” to fill it.' : ''}
            </div>
          )}

          {parsed && (
            <>
              <div className="text-sm text-muted mb-16">{parsed.length} code{parsed.length > 1 ? 's' : ''} found in what you typed:</div>
              {parsed.map((p, i) => {
                if (p.type === 'group') {
                  const row = findCode(codes, p);
                  return row ? <CodeCard key={i} row={row} {...cardProps} /> : (
                    <div key={i} className="card mb-16"><span className="badge badge-blue">Group</span> <b>{p.code}</b> — {GROUP_CODES[p.code]}</div>
                  );
                }
                const row = findCode(codes, p);
                return (
                  <div key={i}>
                    {p.group && (
                      <div className="text-sm" style={{ margin: '0 0 4px 4px' }}>
                        <b>{p.group}</b> = {GROUP_CODES[p.group]}
                      </div>
                    )}
                    {row ? <CodeCard row={row} group={p.group} {...cardProps} /> : (
                      <div className="card mb-16 text-muted">
                        <span className="badge badge-gray">{typeOf(p.type).label}</span> <b>{p.code}</b> isn’t in the library yet.
                        {canEdit && <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setModal({ kind: 'code', presetCode: p })}>+ Add it</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {!parsed && codes.length > 0 && (
            <>
              <div className="text-sm text-muted mb-16">{results.length} code{results.length === 1 ? '' : 's'}</div>
              {results.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>Nothing matches.</div>}
              {results.slice(0, limit).map(row => <CodeCard key={row.id} row={row} {...cardProps} />)}
              {results.length > limit && (
                <button className="btn-sm" style={{ marginBottom: 16 }} onClick={() => setLimit(l => l + PAGE)}>
                  Show more ({results.length - limit} left)
                </button>
              )}
            </>
          )}
        </>
      )}

      {modal?.kind === 'code' && (
        <DenialCodeModal codes={codes} row={modal.row ?? null} presetCode={modal.presetCode} user={user} onClose={close} onSaved={saved} />
      )}
      {modal?.kind === 'import' && <DenialImportModal codes={codes} user={user} onClose={close} onSaved={saved} />}
      {modal?.kind === 'starter' && <DenialStarterModal codes={codes} user={user} onClose={close} onSaved={saved} />}
    </div>
  );
}
