import { useState, useMemo } from 'react';
import { CODE_TYPES, CATEGORIES, typeOf, normCode } from '../../lib/denials';
import { scopeOf, layerEntry, stepsNeedRecheck, verifySteps, setStepsActive } from '../../lib/denialSteps';
import { exportSteps } from '../../lib/denialStepsImport';
import { CodeStepsModal, CopyStepsModal, StepsImportModal } from './DenialAdminTools';
import PayerSearch from '../../components/shared/PayerSearch';
import { confirmDialog, alertDialog } from '../../components/shared/Dialog';
import { Card, Button, LinkButton, Badge, Tabs, Check, Table, Toolbar, ToolbarSpacer, EmptyState } from '../../components/ui';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const PAGE = 100;

/**
 * 🛠 Manage steps (roadmap 4.3, editors only): coverage of common / client / payer steps per code, copy to a client,
 * Excel import / export, review queue (never verified or > 180 days) and inactive entries.
 */
export default function DenialAdmin({ codes, steps, ctx, user, onChanged }) {
  const [view, setView] = useState('coverage');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [missingCommon, setMissingCommon] = useState(false);
  const [clientId, setClientId] = useState('');
  const [payer, setPayer] = useState(null);
  const [onlyMissingTarget, setOnlyMissingTarget] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  const [modal, setModal] = useState(null);      // { kind: 'code' | 'copy' | 'import', code? }
  const [reviewLayer, setReviewLayer] = useState('ALL');

  const live = useMemo(() => steps.filter(s => s.active !== false), [steps]);
  const clientName = id => ctx.clients.find(c => c.id === id)?.name ?? `Client #${id}`;
  const payerName = id => ctx.payers.find(p => p.id === id)?.name ?? `Payer #${id}`;
  const client = ctx.clients.find(c => String(c.id) === clientId) ?? null;

  // One row per active code with its coverage
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return codes
      .filter(c => c.active !== false)
      .filter(c => type === 'ALL' || c.code_type === type)
      .filter(c => category === 'ALL' || c.category === category)
      .filter(c => !q || normCode(c.code) === normCode(q) || [c.code, c.plain_reason, c.official_text].some(v => (v ?? '').toLowerCase().includes(q)))
      .map(c => {
        const mine = live.filter(s => s.code_id === c.id);
        return {
          code: c,
          common: mine.find(s => s.scope === 'common') ?? null,
          clients: mine.filter(s => s.scope === 'client'),
          payers: mine.filter(s => s.scope === 'payer'),
          recheck: mine.filter(stepsNeedRecheck).length,
          clientEntry: client ? layerEntry(live, c.id, 'client', client.id) : null,
          payerEntry: payer ? layerEntry(live, c.id, 'payer', payer.id) : null,
        };
      })
      .filter(r => !missingCommon || !r.common)
      .filter(r => !onlyMissingTarget || (client && !r.clientEntry) || (payer && !r.payerEntry))
      .sort((a, b) => (a.code.code_type > b.code.code_type ? 1 : a.code.code_type < b.code.code_type ? -1 : 0)
        || normCode(a.code.code).localeCompare(normCode(b.code.code), undefined, { numeric: true }));
  }, [codes, live, query, type, category, missingCommon, client, payer, onlyMissingTarget]);

  const review = useMemo(() => live
    .filter(stepsNeedRecheck)
    .filter(s => reviewLayer === 'ALL' || s.scope === reviewLayer)
    .sort((a, b) => (a.verified_at ?? '').localeCompare(b.verified_at ?? '') || a.created_at.localeCompare(b.created_at)),
  [live, reviewLayer]);
  const inactive = steps.filter(s => s.active === false);

  const codeOf = id => codes.find(c => c.id === id);
  const label = s => {
    const c = codeOf(s.code_id);
    return `${c ? `${typeOf(c.code_type).label} ${c.code}` : '?'} · ${scopeOf(s.scope).icon} ${s.scope === 'common' ? 'Common'
      : s.scope === 'client' ? clientName(s.client_id) : payerName(s.payer_id)}`;
  };
  const togglePick = id => setPicked(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allShownPicked = rows.length > 0 && rows.slice(0, limit).every(r => picked.has(r.code.id));
  const done = () => { setModal(null); onChanged(); };

  async function verify(s) { if (await verifySteps(s, user)) onChanged(); }
  async function reactivate(s) {
    if (live.some(x => x.code_id === s.code_id && x.scope === s.scope && x.client_id === s.client_id && x.payer_id === s.payer_id)) {
      return alertDialog({ title: 'Already has active steps', message: 'Open the code and make the current steps inactive first.', tone: 'warning' });
    }
    if (await confirmDialog({ title: 'Reactivate these steps?', message: label(s), confirmText: 'Reactivate' })
      && await setStepsActive(s, true, user)) onChanged();
  }

  const tabs = [
    { id: 'coverage', label: '📊 Coverage' },
    { id: 'review', label: `🕘 Review queue (${live.filter(stepsNeedRecheck).length})` },
    { id: 'inactive', label: `⊘ Inactive (${inactive.length})` },
  ];

  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      <Toolbar>
        <Tabs value={view} onChange={setView} label="Manage steps views" options={tabs.map(t => ({ value: t.id, label: t.label }))} />
        <ToolbarSpacer />
        <Button size="sm" onClick={() => setModal({ kind: 'import' })}>⬆ Import from Excel</Button>
        <Button size="sm" onClick={() => exportSteps({ codes, steps, ...ctx })} disabled={!live.length}>⬇ Export all steps</Button>
      </Toolbar>

      {view === 'coverage' && (
        <>
          <Card>
            <Toolbar>
              <input type="search" className="ui-input" value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Code or words"
                style={{ flex: '1 1 180px', width: 'auto', minWidth: 0 }} aria-label="Code or words" />
              <select value={type} onChange={e => setType(e.target.value)} aria-label="Code type">
                <option value="ALL">All types</option>
                {CODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
                <option value="ALL">All categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Check inline checked={missingCommon} onChange={e => setMissingCommon(e.target.checked)}>Missing common steps</Check>
            </Toolbar>
            <Toolbar style={{ marginTop: 'var(--ui-s3)' }}>
              <span className="ui-label">Check coverage for:</span>
              <select value={clientId} onChange={e => setClientId(e.target.value)} aria-label="Client">
                <option value="">— client —</option>
                {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
              {payer
                ? <span className="ui-row" style={{ gap: 4 }}><Badge tone="info">Payer: {payer.name}</Badge><Button size="xs" variant="ghost" aria-label="Clear payer" onClick={() => setPayer(null)}>✕</Button></span>
                : <div style={{ flex: '1 1 200px', minWidth: 0 }}><PayerSearch payers={ctx.payers} onSelect={setPayer} placeholder="— payer —" /></div>}
              {(client || payer) && (
                <Check inline checked={onlyMissingTarget} onChange={e => setOnlyMissingTarget(e.target.checked)}>Only missing</Check>
              )}
            </Toolbar>
          </Card>

          <Toolbar>
            <span className="ui-count">{rows.length} codes · {picked.size} ticked</span>
            <Button size="sm" disabled={!picked.size || !ctx.clients.length} onClick={() => setModal({ kind: 'copy' })}>📋 Copy steps to a client…</Button>
            {picked.size > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear ticks</Button>}
          </Toolbar>

          {codes.length === 0 && <Card><EmptyState icon="🧩" title="Add codes in 🔎 Look up first (starter codes or import)." /></Card>}
          {rows.length > 0 && (
            <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
              <Table dense>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input type="checkbox" className="ui-tick" aria-label="Tick all shown" checked={allShownPicked}
                        onChange={() => setPicked(p => {
                          const n = new Set(p);
                          rows.slice(0, limit).forEach(r => { if (allShownPicked) n.delete(r.code.id); else n.add(r.code.id); });
                          return n;
                        })} />
                    </th>
                    <th>Code</th><th>Common</th><th className="num">Clients</th><th className="num">Payers</th>
                    <th>Re-check</th>
                    {client && <th>{client.name}</th>}
                    {payer && <th>{payer.name}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map(r => (
                    <tr key={r.code.id}>
                      <td><input type="checkbox" className="ui-tick" checked={picked.has(r.code.id)} onChange={() => togglePick(r.code.id)} aria-label={`Tick ${r.code.code}`} /></td>
                      <td title={r.code.plain_reason ?? ''}>
                        <span className="ui-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <Badge>{typeOf(r.code.code_type).label}</Badge>
                          <LinkButton onClick={() => setModal({ kind: 'code', code: r.code })} style={{ fontSize: 'var(--ui-fs-base)' }}>{r.code.code} ›</LinkButton>
                        </span>
                      </td>
                      <td>{r.common ? <span className="ui-text-good">✓</span> : <span className="ui-text-muted">—</span>}</td>
                      <td className="num" title={r.clients.map(s => clientName(s.client_id)).join(', ')}>{r.clients.length || ''}</td>
                      <td className="num" title={r.payers.map(s => payerName(s.payer_id)).join(', ')}>{r.payers.length || ''}</td>
                      <td>{r.recheck ? <Badge tone="warn">{r.recheck}</Badge> : ''}</td>
                      {client && <td>{r.clientEntry ? <span className="ui-text-good">✓</span> : <Badge tone="warn">missing</Badge>}</td>}
                      {payer && <td>{r.payerEntry ? <span className="ui-text-good">✓</span> : <Badge tone="warn">missing</Badge>}</td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {rows.length > limit && (
                <div><Button size="sm" onClick={() => setLimit(l => l + PAGE)}>Show more ({rows.length - limit} left)</Button></div>
              )}
            </div>
          )}
        </>
      )}

      {view === 'review' && (
        <>
          <Toolbar>
            <select value={reviewLayer} onChange={e => setReviewLayer(e.target.value)} aria-label="Layer">
              <option value="ALL">All layers</option>
              <option value="common">Common</option>
              <option value="client">Client</option>
              <option value="payer">Payer</option>
            </select>
            <span className="ui-muted">Never verified first, then the oldest checks.</span>
          </Toolbar>
          {review.length === 0 && <Card><EmptyState icon="✅" title="Nothing to review. 🎉" /></Card>}
          {review.map(s => (
            <Card key={s.id}>
              <div className="ui-row">
                <span className="bold">{label(s)}</span>
                <Badge tone="warn">{s.verified_at ? `Last verified ${fmtDate(s.verified_at)}` : 'Never verified'}</Badge>
                <span className="ui-row" style={{ gap: 4, marginLeft: 'auto' }}>
                  <Button size="xs" variant="success" onClick={() => verify(s)}>✓ Verified</Button>
                  {codeOf(s.code_id) && <Button size="xs" onClick={() => setModal({ kind: 'code', code: codeOf(s.code_id) })}>Open</Button>}
                </span>
              </div>
              <div className="ui-muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>{s.steps}</div>
            </Card>
          ))}
        </>
      )}

      {view === 'inactive' && (
        <>
          {inactive.length === 0 && <Card><EmptyState icon="⊘" title="No inactive steps." /></Card>}
          {inactive.map(s => (
            <Card key={s.id} dim>
              <div className="ui-row">
                <span className="bold">{label(s)}</span>
                <span className="ui-muted">changed {fmtDate(s.updated_at)}</span>
                <Button size="xs" variant="success" style={{ marginLeft: 'auto' }} onClick={() => reactivate(s)}>↺ Reactivate</Button>
              </div>
              <div className="ui-muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{s.steps}</div>
            </Card>
          ))}
        </>
      )}

      {modal?.kind === 'code' && (
        <CodeStepsModal code={modal.code} steps={steps} ctx={ctx} user={user} onClose={() => setModal(null)} onChanged={onChanged} />
      )}
      {modal?.kind === 'copy' && (
        <CopyStepsModal codeIds={[...picked]} steps={steps} ctx={ctx} user={user} onClose={() => setModal(null)}
          onSaved={() => { setPicked(new Set()); done(); }} />
      )}
      {modal?.kind === 'import' && (
        <StepsImportModal codes={codes} steps={steps} ctx={ctx} user={user} onClose={() => setModal(null)} onSaved={done} />
      )}
    </div>
  );
}
