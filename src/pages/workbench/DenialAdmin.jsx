import { useState, useMemo } from 'react';
import { CODE_TYPES, CATEGORIES, typeOf, normCode } from '../../lib/denials';
import { scopeOf, layerEntry, stepsNeedRecheck, verifySteps, setStepsActive } from '../../lib/denialSteps';
import { exportSteps } from '../../lib/denialStepsImport';
import { CodeStepsModal, CopyStepsModal, StepsImportModal } from './DenialAdminTools';
import PayerSearch from '../../components/shared/PayerSearch';
import { confirmDialog, alertDialog } from '../../components/shared/Dialog';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const PAGE = 100;
const cell = { padding: '5px 6px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

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
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {tabs.map(t => (
          <button key={t.id} className={view === t.id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={view === t.id} onClick={() => setView(t.id)}>{t.label}</button>
        ))}
        <span className="row" style={{ gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button className="btn-sm" onClick={() => setModal({ kind: 'import' })}>⬆ Import from Excel</button>
          <button className="btn-sm" onClick={() => exportSteps({ codes, steps, ...ctx })} disabled={!live.length}>⬇ Export all steps</button>
        </span>
      </div>

      {view === 'coverage' && (
        <>
          <div className="card mb-16">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Code or words"
                style={{ flex: '1 1 160px', minWidth: 0 }} />
              <select value={type} onChange={e => setType(e.target.value)} style={{ maxWidth: 140 }}>
                <option value="ALL">All types</option>
                {CODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="ALL">All categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={missingCommon} onChange={e => setMissingCommon(e.target.checked)} /> Missing common steps
              </label>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <span className="text-sm">Check coverage for:</span>
              <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ maxWidth: 220 }}>
                <option value="">— client —</option>
                {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
              {payer
                ? <span className="row" style={{ gap: 4 }}><span className="badge badge-blue">Payer: {payer.name}</span><button className="btn-sm" onClick={() => setPayer(null)}>✕</button></span>
                : <div style={{ flex: '1 1 200px', minWidth: 0 }}><PayerSearch payers={ctx.payers} onSelect={setPayer} placeholder="— payer —" /></div>}
              {(client || payer) && (
                <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={onlyMissingTarget} onChange={e => setOnlyMissingTarget(e.target.checked)} /> Only missing
                </label>
              )}
            </div>
          </div>

          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span className="text-sm text-muted">{rows.length} codes · {picked.size} ticked</span>
            <button className="btn-sm" disabled={!picked.size || !ctx.clients.length} onClick={() => setModal({ kind: 'copy' })}>📋 Copy steps to a client…</button>
            {picked.size > 0 && <button className="btn-sm" onClick={() => setPicked(new Set())}>Clear ticks</button>}
          </div>

          {codes.length === 0 && <div className="card text-muted">Add codes in 🔎 Look up first (starter codes or import).</div>}
          {rows.length > 0 && (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="text-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={cell}>
                      <input type="checkbox" aria-label="Tick all shown" checked={allShownPicked}
                        onChange={() => setPicked(p => {
                          const n = new Set(p);
                          rows.slice(0, limit).forEach(r => { if (allShownPicked) n.delete(r.code.id); else n.add(r.code.id); });
                          return n;
                        })} />
                    </th>
                    <th style={cell}>Code</th><th style={cell}>Common</th><th style={cell}>Clients</th><th style={cell}>Payers</th>
                    <th style={cell}>Re-check</th>
                    {client && <th style={cell}>{client.name}</th>}
                    {payer && <th style={cell}>{payer.name}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map(r => (
                    <tr key={r.code.id}>
                      <td style={cell}><input type="checkbox" checked={picked.has(r.code.id)} onChange={() => togglePick(r.code.id)} aria-label={`Tick ${r.code.code}`} /></td>
                      <td style={{ ...cell, cursor: 'pointer' }} onClick={() => setModal({ kind: 'code', code: r.code })} title={r.code.plain_reason ?? ''}>
                        <span className="badge badge-gray">{typeOf(r.code.code_type).label}</span> <b style={{ color: 'var(--accent)' }}>{r.code.code} ›</b>
                      </td>
                      <td style={cell}>{r.common ? '✓' : <span className="text-muted">—</span>}</td>
                      <td style={cell} title={r.clients.map(s => clientName(s.client_id)).join(', ')}>{r.clients.length || ''}</td>
                      <td style={cell} title={r.payers.map(s => payerName(s.payer_id)).join(', ')}>{r.payers.length || ''}</td>
                      <td style={cell}>{r.recheck ? <span className="badge badge-orange">{r.recheck}</span> : ''}</td>
                      {client && <td style={cell}>{r.clientEntry ? '✓' : <span className="badge badge-yellow">missing</span>}</td>}
                      {payer && <td style={cell}>{r.payerEntry ? '✓' : <span className="badge badge-yellow">missing</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > limit && (
                <button className="btn-sm" style={{ marginTop: 8 }} onClick={() => setLimit(l => l + PAGE)}>Show more ({rows.length - limit} left)</button>
              )}
            </div>
          )}
        </>
      )}

      {view === 'review' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select value={reviewLayer} onChange={e => setReviewLayer(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="ALL">All layers</option>
              <option value="common">Common</option>
              <option value="client">Client</option>
              <option value="payer">Payer</option>
            </select>
            <span className="text-sm text-muted">Never verified first, then the oldest checks.</span>
          </div>
          {review.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>Nothing to review. 🎉</div>}
          {review.map(s => (
            <div key={s.id} className="card mb-16">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="bold">{label(s)}</span>
                <span className="badge badge-orange">{s.verified_at ? `Last verified ${fmtDate(s.verified_at)}` : 'Never verified'}</span>
                <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  <button className="btn-sm" onClick={() => verify(s)}>✓ Verified</button>
                  {codeOf(s.code_id) && <button className="btn-sm" onClick={() => setModal({ kind: 'code', code: codeOf(s.code_id) })}>Open</button>}
                </span>
              </div>
              <div className="text-sm text-muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>{s.steps}</div>
            </div>
          ))}
        </>
      )}

      {view === 'inactive' && (
        <>
          {inactive.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>No inactive steps.</div>}
          {inactive.map(s => (
            <div key={s.id} className="card mb-16" style={{ opacity: 0.8 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="bold">{label(s)}</span>
                <span className="text-sm text-muted">changed {fmtDate(s.updated_at)}</span>
                <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => reactivate(s)}>↺ Reactivate</button>
              </div>
              <div className="text-sm text-muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{s.steps}</div>
            </div>
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
