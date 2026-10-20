import { useState, useEffect, useMemo } from 'react';
import { hasAccess } from '../../lib/access';
import {
  CODE_TYPES, CATEGORIES, GROUP_CODES, typeOf, loadDenialCodes, parseCodeLine, findCode, searchCodes, isRetired,
  verifyCode, setCodeActive, missingStarterCodes,
} from '../../lib/denials';
import { DenialCodeModal, DenialImportModal, DenialStarterModal } from './DenialEditors';
import DenialLayers from './DenialLayers';
import DenialAdmin from './DenialAdmin';
import DeadlineHelper from './DeadlineHelper';
import { startAppeal } from '../../lib/appeals';
import SopPage from './SopPage';
import PayerCard from './PayerCard';
import PayerSearch from '../../components/shared/PayerSearch';
import { loadDenialSteps, loadStepContext } from '../../lib/denialSteps';
import { loadSopLibrary } from '../../lib/sops';
import { loadSopVersionMeta } from '../../lib/sopVersions';
import CopyButton from '../../components/shared/CopyButton';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const PAGE = 60;

// One code: type, code + copy, badges, plain reason first, official wording below; editor buttons when allowed;
// "What to do ▾" shows the layered steps (4.2) passed as children
function CodeCard({ row, group, canEdit, onVerify, onEdit, onToggle, stepsReady, stepsOpen, onToggleSteps, onStartAppeal, children }) {
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
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {stepsReady && (
          <button className={stepsOpen ? 'btn-primary btn-sm' : 'btn-sm'} aria-expanded={stepsOpen}
            onClick={() => onToggleSteps(row.id)}>
            {stepsOpen ? 'What to do ▴' : 'What to do ▾'}
          </button>
        )}
        {row.active !== false && <button className="btn-sm" onClick={() => onStartAppeal(row, group)}>✉️ Start an appeal</button>}
      </div>
      {stepsOpen && children}
    </div>
  );
}

// Remembered client / payer pickers (this computer only; storage may be blocked)
const readPick = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const writePick = (key, value) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* blocked */ } };

/**
 * 🧩 Denial Navigator (roadmap Phase 4). 4.1 = Denial library: CARC / RARC / group codes with plain-English reasons.
 * Search by code or words, or paste a line from an ERA / EOB (searched in the browser only — never saved or logged).
 * 4.2: "What to do" per code in layers — client steps → payer rule (+ Payer Directory info) → common 3Gen steps.
 * 4.3: editors get a "Manage steps" tab (coverage, copy to client, Excel import / export, review queue).
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
  // 4.2 layered steps
  const [steps, setSteps] = useState(undefined);     // undefined = loading, null = not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [clientId, setClientId] = useState(() => readPick('helix_denial_client'));
  const [payerId, setPayerId] = useState(() => readPick('helix_denial_payer'));
  const [openSteps, setOpenSteps] = useState(() => new Set());
  const [sopId, setSopId] = useState(null);          // SOP opened from a layer
  const [sopCtx, setSopCtx] = useState(null);
  const [payerCard, setPayerCard] = useState(null);  // payer opened from a layer
  const [tab, setTab] = useState('lookup');           // 4.3: 'lookup' | 'manage'
  const [deadlineOpen, setDeadlineOpen] = useState(false);   // 4.4 deadline helper card

  const reload = () => loadDenialCodes().then(setCodes);
  const reloadSteps = () => loadDenialSteps().then(setSteps);
  useEffect(() => {
    let alive = true;
    loadDenialCodes().then(c => { if (alive) setCodes(c); });
    loadDenialSteps().then(s => { if (alive) setSteps(s); });
    loadStepContext().then(c => { if (alive) setCtx(c); });
    return () => { alive = false; };
  }, []);

  // SOPs linked from a layer open here (same as Training), with the SOP Library data they need
  const empId = user.emp_id;
  useEffect(() => {
    let alive = true;
    if (sopId != null) {
      Promise.all([loadSopLibrary(), loadSopVersionMeta({ emp_id: empId })]).then(([lib, meta]) => {
        if (alive) setSopCtx({ lib: lib ? { ...lib, versionsReady: meta != null } : null, meta });
      });
    }
    return () => { alive = false; };
  }, [sopId, empId]);

  const client = ctx.clients.find(c => String(c.id) === String(clientId)) ?? null;
  const payer = ctx.payers.find(p => String(p.id) === String(payerId)) ?? null;
  const pickClient = id => { setClientId(id); writePick('helix_denial_client', id); };
  const pickPayer = id => { setPayerId(id); writePick('helix_denial_payer', id); };
  const toggleSteps = id => setOpenSteps(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

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
  const cardProps = {
    canEdit, onVerify: verify, onEdit: row => setModal({ kind: 'code', row }), onToggle: toggleActive,
    stepsReady: Array.isArray(steps), onToggleSteps: toggleSteps,
    // 5.1: open the Appeal Builder with this code (or the whole pasted ERA line) and the Working-on client / payer
    onStartAppeal: (row, group) => startAppeal({ codes: parsed ? query : `${group ? `${group}-` : ''}${row.code}`, client_id: clientId, payer_id: payerId }),
  };
  // "⏰ Work out the deadline" in a payer layer opens the helper card and scrolls to it
  const openDeadline = () => {
    setDeadlineOpen(true);
    requestAnimationFrame(() => document.getElementById('deadline-helper')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  // The layered "What to do" panel for one code (children of its card)
  const layers = row => (
    <DenialLayers code={row} steps={steps} ctx={ctx} client={client} payer={payer} user={user} canEdit={canEdit}
      onChanged={reloadSteps} onOpenSop={setSopId} onOpenPayer={setPayerCard} onDeadline={openDeadline} />
  );

  if (sopId != null) {
    const canEditSops = hasAccess(user, 'sops_edit');
    const sop = sopCtx?.lib?.sops.find(s => s.id === sopId);
    const readable = sop && (canEditSops || (sop.active !== false && sop.status === 'published'));
    const back = () => { setSopId(null); setSopCtx(null); };
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {!sopCtx && <div className="card text-muted">Loading SOP…</div>}
        {sopCtx && !readable && (
          <div className="card">
            <button className="btn-sm" onClick={back}>← Back to Denial Navigator</button>
            <p className="text-muted">This SOP isn’t published yet.</p>
          </div>
        )}
        {sopCtx && readable && (
          <SopPage key={sop.id} sop={sop} lib={sopCtx.lib} meta={sopCtx.meta} names={{}} user={user} canEdit={canEditSops}
            backLabel="← Back to Denial Navigator" onBack={back}
            onChanged={() => Promise.all([loadSopLibrary(), loadSopVersionMeta({ emp_id: empId })])
              .then(([lib, meta]) => setSopCtx({ lib: lib ? { ...lib, versionsReady: meta != null } : null, meta }))}
            onOpenSop={setSopId} />
        )}
      </div>
    );
  }

  if (payerCard) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <button className="btn-sm" style={{ marginBottom: 12 }} onClick={() => setPayerCard(null)}>← Back to Denial Navigator</button>
        <PayerCard key={payerCard.id} payer={payerCard} user={user} onClose={() => setPayerCard(null)} />
      </div>
    );
  }

  // 🔎 Look up · 🛠 Manage steps (4.3, editors only, once the steps table exists)
  const canManage = canEdit && codes && Array.isArray(steps);
  const tabBar = canManage && (
    <div className="row" style={{ gap: 6, marginBottom: 12 }}>
      {[['lookup', '🔎 Look up'], ['manage', '🛠 Manage steps']].map(([id, label]) => (
        <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
      ))}
    </div>
  );
  if (canManage && tab === 'manage') {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <div className="page-title">🧩 Denial Navigator</div>
            <div className="page-subtitle">Manage the steps: which codes have common, client and payer steps, and what needs checking.</div>
          </div>
        </div>
        {tabBar}
        <DenialAdmin codes={codes} steps={steps} ctx={ctx} user={user} onChanged={reloadSteps} />
      </div>
    );
  }

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
      {tabBar}

      {codes === undefined && <div className="card text-muted">Loading…</div>}
      {codes === null && (
        <div className="card text-muted">
          The Denial library isn’t set up yet. An admin needs to run the denial codes database update
          (<code>20261021d_denial_codes.sql</code>) in Supabase.
        </div>
      )}

      {codes && Array.isArray(steps) && (
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-sm bold">Working on:</span>
            <select value={clientId} onChange={e => pickClient(e.target.value)} style={{ maxWidth: 240 }} aria-label="Client">
              <option value="">Any client</option>
              {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
            {payer ? (
              <span className="row" style={{ gap: 4, alignItems: 'center' }}>
                <span className="badge badge-blue">Payer: {payer.name}</span>
                <button className="btn-sm" title="Clear payer" onClick={() => pickPayer('')}>✕</button>
              </span>
            ) : (
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <PayerSearch payers={ctx.payers} onSelect={p => pickPayer(String(p.id))} placeholder="Payer (optional) — name or alias" />
              </div>
            )}
          </div>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>
            Open “What to do” on a code to see the client’s steps first, then the payer’s rule, then the common steps.
          </div>
        </div>
      )}

      {codes && <DeadlineHelper payer={payer} client={client} open={deadlineOpen} onToggle={() => setDeadlineOpen(o => !o)} />}

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
                  return row ? <CodeCard key={i} row={row} {...cardProps} stepsOpen={openSteps.has(row.id)}>{layers(row)}</CodeCard> : (
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
                    {row ? <CodeCard row={row} group={p.group} {...cardProps} stepsOpen={openSteps.has(row.id)}>{layers(row)}</CodeCard> : (
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
              {results.slice(0, limit).map(row => <CodeCard key={row.id} row={row} {...cardProps} stepsOpen={openSteps.has(row.id)}>{layers(row)}</CodeCard>)}
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
