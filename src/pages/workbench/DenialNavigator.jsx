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
import { peekRecord, clearRecord } from '../../lib/navigate';
import { PageHeader, Card, Button, Badge, Tabs, Check, Toolbar, EmptyState } from '../../components/ui';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const PAGE = 60;

// One code: type, code + copy, badges, plain reason first, official wording below; editor buttons when allowed;
// "What to do ▾" shows the layered steps (4.2) passed as children
function CodeCard({ row, group, canEdit, onVerify, onEdit, onToggle, stepsReady, stepsOpen, onToggleSteps, onStartAppeal, children }) {
  const t = typeOf(row.code_type);
  return (
    <Card dim={row.active === false} variant={stepsOpen ? 'accent' : 'default'}>
      <div className="ui-row">
        <Badge tone="info" title={t.long}>{t.label}</Badge>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--ui-fs-lg)', fontWeight: 800 }}>{group ? `${group}-` : ''}{row.code}</span>
        <CopyButton value={row.code} label="Copy" />
        {row.category && <Badge>{row.category}</Badge>}
        {isRetired(row) && <Badge tone="warn" title={`No longer used after ${fmtDay(row.stopped_on)}`}>Retired {fmtDay(row.stopped_on)}</Badge>}
        {!row.verified_at && row.source === 'starter' && <Badge tone="warn">Starter – please verify</Badge>}
        {row.active === false && <Badge>Inactive</Badge>}
        {canEdit && (
          <span className="ui-row" style={{ gap: 4, marginLeft: 'auto' }}>
            {!row.verified_at && <Button size="xs" variant="success" onClick={() => onVerify(row)}>✓ Verified</Button>}
            <Button size="xs" title="Edit" aria-label="Edit" onClick={() => onEdit(row)}>✎</Button>
            <Button size="xs" title={row.active === false ? 'Reactivate' : 'Make inactive'} aria-label={row.active === false ? 'Reactivate' : 'Make inactive'} onClick={() => onToggle(row)}>
              {row.active === false ? '↺' : '⊘'}
            </Button>
          </span>
        )}
      </div>
      <div className="ui-kv-v" style={{ marginTop: 'var(--ui-s2)', lineHeight: 1.5 }}>
        {row.plain_reason || <span className="ui-text-muted">No plain-English reason yet.</span>}
      </div>
      {row.official_text && (
        <div className="ui-muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>Official: {row.official_text}</div>
      )}
      {row.notes && <div className="ui-small" style={{ marginTop: 4 }}>📝 {row.notes}</div>}
      {row.verified_at && <div className="ui-small ui-text-good" style={{ marginTop: 4 }}>Verified {fmtDate(row.verified_at)}</div>}
      <div className="ui-row" style={{ marginTop: 'var(--ui-s3)' }}>
        {stepsReady && (
          <Button size="sm" variant={stepsOpen ? 'primary' : 'secondary'} aria-expanded={stepsOpen}
            onClick={() => onToggleSteps(row.id)}>
            {stepsOpen ? 'What to do ▴' : 'What to do ▾'}
          </Button>
        )}
        {row.active !== false && <Button size="sm" variant="ghost" onClick={() => onStartAppeal(row, group)}>✉️ Start an appeal</Button>}
      </div>
      {stepsOpen && children}
    </Card>
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
  const [query, setQuery] = useState(() => peekRecord('wb_denials')?.query ?? '');   // 10.1: from global search
  useEffect(() => { clearRecord('wb_denials'); }, []);
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
      <div className="ui-page" style={{ maxWidth: 960 }}>
        {!sopCtx && <Card><EmptyState compact title="Loading SOP…" /></Card>}
        {sopCtx && !readable && (
          <Card>
            <Button size="sm" variant="ghost" onClick={back}>← Back to Denial Navigator</Button>
            <EmptyState icon="📚" title="This SOP isn’t published yet." />
          </Card>
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
      <div className="ui-page" style={{ maxWidth: 960 }}>
        <div><Button size="sm" variant="ghost" onClick={() => setPayerCard(null)}>← Back to Denial Navigator</Button></div>
        <PayerCard key={payerCard.id} payer={payerCard} user={user} onClose={() => setPayerCard(null)} />
      </div>
    );
  }

  // 🔎 Look up · 🛠 Manage steps (4.3, editors only, once the steps table exists)
  const canManage = canEdit && codes && Array.isArray(steps);
  const tabBar = canManage && (
    <div>
      <Tabs value={tab} onChange={setTab} label="Denial Navigator views"
        options={[{ value: 'lookup', label: '🔎 Look up' }, { value: 'manage', label: '🛠 Manage steps' }]} />
    </div>
  );
  if (canManage && tab === 'manage') {
    return (
      <div className="ui-page" style={{ maxWidth: 1100 }}>
        <PageHeader icon="🧩" kicker="Workbench" title="Denial Navigator"
          subtitle="Manage the steps: which codes have common, client and payer steps, and what needs checking." />
        {tabBar}
        <DenialAdmin codes={codes} steps={steps} ctx={ctx} user={user} onChanged={reloadSteps} />
      </div>
    );
  }

  return (
    <div className="ui-page" style={{ maxWidth: 960 }}>
      <PageHeader icon="🧩" kicker="Workbench" title="Denial Navigator"
        subtitle="Look up a denial or remark code — or paste the codes from an ERA / EOB line."
        actions={canEdit && codes && (
          <>
            {starterCount > 0 && <Button size="sm" onClick={() => setModal({ kind: 'starter' })}>Add starter codes ({starterCount})</Button>}
            <Button size="sm" onClick={() => setModal({ kind: 'import' })}>⬆ Import official list</Button>
            <Button size="sm" variant="primary" onClick={() => setModal({ kind: 'code' })}>+ Add code</Button>
          </>
        )} />
      {tabBar}

      {codes === undefined && <Card><EmptyState compact title="Loading…" /></Card>}
      {codes === null && (
        <Card>
          <EmptyState icon="🛠️" title="The Denial library isn’t set up yet.">
            An admin needs to run the denial codes database update
            (<code>20261021d_denial_codes.sql</code>) in Supabase.
          </EmptyState>
        </Card>
      )}

      {codes && Array.isArray(steps) && (
        <Card>
          <Toolbar>
            <span className="ui-label">Working on:</span>
            <select value={clientId} onChange={e => pickClient(e.target.value)} aria-label="Client">
              <option value="">Any client</option>
              {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
            {payer ? (
              <span className="ui-row" style={{ gap: 4 }}>
                <Badge tone="info">Payer: {payer.name}</Badge>
                <Button size="xs" variant="ghost" title="Clear payer" aria-label="Clear payer" onClick={() => pickPayer('')}>✕</Button>
              </span>
            ) : (
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <PayerSearch payers={ctx.payers} onSelect={p => pickPayer(String(p.id))} placeholder="Payer (optional) — name or alias" />
              </div>
            )}
          </Toolbar>
          <div className="ui-muted" style={{ marginTop: 'var(--ui-s2)' }}>
            Open “What to do” on a code to see the client’s steps first, then the payer’s rule, then the common steps.
          </div>
        </Card>
      )}

      {codes && <DeadlineHelper payer={payer} client={client} open={deadlineOpen} onToggle={() => setDeadlineOpen(o => !o)} />}

      {codes && (
        <>
          <Card>
            <input type="search" className="ui-input" value={query} autoFocus onChange={e => { setQuery(e.target.value); setLimit(PAGE); }}
              placeholder="e.g. CO-16 N290  ·  197  ·  “prior auth”  ·  timely filing"
              style={{ fontSize: 'var(--ui-fs-md)', minHeight: 44 }} aria-label="Code or words" />
            {!parsed && (
              <Toolbar style={{ marginTop: 'var(--ui-s3)' }}>
                <select value={type} onChange={e => setType(e.target.value)} aria-label="Code type">
                  <option value="ALL">All types</option>
                  {CODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
                  <option value="ALL">All categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <Check inline checked={showRetired} onChange={e => setShowRetired(e.target.checked)}>Show retired</Check>
                {canEdit && (
                  <>
                    <Check inline checked={onlyUnverified} onChange={e => setOnlyUnverified(e.target.checked)}>Not verified only</Check>
                    <Check inline checked={showInactive} onChange={e => setShowInactive(e.target.checked)}>Show inactive</Check>
                  </>
                )}
              </Toolbar>
            )}
            <div className="ui-muted" style={{ marginTop: 'var(--ui-s2)' }}>🔒 What you type here is never saved. Paste codes only — no patient details.</div>
          </Card>

          {codes.length === 0 && (
            <Card>
              <EmptyState icon="🧩" title="The library is empty.">
                {canEdit ? 'Use “Add starter codes” or “Import official list” to fill it.' : null}
              </EmptyState>
            </Card>
          )}

          {parsed && (
            <>
              <div className="ui-count">{parsed.length} code{parsed.length > 1 ? 's' : ''} found in what you typed:</div>
              {parsed.map((p, i) => {
                if (p.type === 'group') {
                  const row = findCode(codes, p);
                  return row ? <CodeCard key={i} row={row} {...cardProps} stepsOpen={openSteps.has(row.id)}>{layers(row)}</CodeCard> : (
                    <Card key={i}><div className="ui-row"><Badge tone="info">Group</Badge> <b>{p.code}</b> — {GROUP_CODES[p.code]}</div></Card>
                  );
                }
                const row = findCode(codes, p);
                return (
                  <div key={i} className="ui-stack" style={{ gap: 6 }}>
                    {p.group && (
                      <div className="ui-small" style={{ paddingLeft: 4 }}>
                        <b>{p.group}</b> = {GROUP_CODES[p.group]}
                      </div>
                    )}
                    {row ? <CodeCard row={row} group={p.group} {...cardProps} stepsOpen={openSteps.has(row.id)}>{layers(row)}</CodeCard> : (
                      <Card>
                        <div className="ui-row ui-text-muted">
                          <Badge>{typeOf(p.type).label}</Badge> <b style={{ color: 'var(--text)' }}>{p.code}</b> isn’t in the library yet.
                          {canEdit && <Button size="xs" onClick={() => setModal({ kind: 'code', presetCode: p })}>+ Add it</Button>}
                        </div>
                      </Card>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {!parsed && codes.length > 0 && (
            <>
              <div className="ui-count">{results.length} code{results.length === 1 ? '' : 's'}</div>
              {results.length === 0 && <Card><EmptyState icon="🔎" title="Nothing matches." /></Card>}
              {results.slice(0, limit).map(row => <CodeCard key={row.id} row={row} {...cardProps} stepsOpen={openSteps.has(row.id)}>{layers(row)}</CodeCard>)}
              {results.length > limit && (
                <div>
                  <Button size="sm" onClick={() => setLimit(l => l + PAGE)}>
                    Show more ({results.length - limit} left)
                  </Button>
                </div>
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
