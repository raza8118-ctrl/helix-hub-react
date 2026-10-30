import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { S, db } from '../../lib/supabase';
import { needsRecheck, PAYER_DETAIL_TABLES } from '../../lib/payers';
import { hasAccess } from '../../lib/access';

// Loaded only when an editor opens it (brings in the Excel library)
const PayerImport = lazy(() => import('./PayerImport'));
import PayerSearch from '../../components/shared/PayerSearch';
import PayerCard from './PayerCard';
import { peekRecord, clearRecord } from '../../lib/navigate';
import { PageHeader, Card, Button, Chip, Toolbar, EmptyState } from '../../components/ui';

// Payer ids with an entry needing re-check (1.6), and open report counts per payer
async function loadAccuracySummary() {
  const stale = new Set();
  const results = await Promise.all(PAYER_DETAIL_TABLES.map(t =>
    db(t).select(t === 'payer_forms' ? 'payer_id,verified_at,active,superseded_at' : 'payer_id,verified_at,active')));
  for (const { data } of results) {
    for (const r of data ?? []) {
      if (r.active !== false && !r.superseded_at && needsRecheck(r.verified_at)) stale.add(r.payer_id);
    }
  }
  const { data: open } = await db('payer_reports').select('payer_id').eq('status', 'open');
  const reports = {};
  for (const r of open ?? []) reports[r.payer_id] = (reports[r.payer_id] ?? 0) + 1;
  return { stale, reports };
}

/**
 * Payer Directory: find a payer by name or alias (1.2) or browse A–Z, then open its
 * full card (1.3). Open to every signed-in user; editing needs "Edit Payer Directory".
 */
export default function PayerDirectory({ user }) {
  const [payers, setPayers]     = useState(null);   // null = loading / table missing
  const [error, setError]       = useState(false);
  const [selected, setSelected] = useState(null);
  const [wanted, setWanted] = useState(() => peekRecord('wb_payers')?.payerId ?? null);   // 10.1: opened from global search
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [reviewFilter, setReviewFilter] = useState('ALL');   // ALL | STALE | REPORTED
  const [summary, setSummary]   = useState({ stale: new Set(), reports: {} });
  const [showImport, setShowImport] = useState(false);
  const canEdit = hasAccess(user, 'payers_edit');

  function loadPayers() {
    S.get('payers').then(rows => {
      setError(rows == null);
      setPayers(rows ?? []);
    });
    loadAccuracySummary().then(setSummary).catch(() => {});
  }

  useEffect(() => { loadPayers(); clearRecord('wb_payers'); }, []);

  // Refresh the warning marks after the card is closed (it may have verified or resolved things)
  function closeCard() {
    setSelected(null);
    setWanted(null);
    loadAccuracySummary().then(setSummary).catch(() => {});
  }

  const active = useMemo(() => (payers ?? []).filter(p => p.active !== false), [payers]);
  const cardPayer = selected ?? (wanted != null ? active.find(p => p.id === wanted) ?? null : null);
  const types  = useMemo(() => [...new Set(active.map(p => p.payer_type).filter(Boolean))].sort(), [active]);
  const browse = useMemo(() => active
    .filter(p => typeFilter === 'ALL' || p.payer_type === typeFilter)
    .filter(p => reviewFilter === 'ALL'
      || (reviewFilter === 'STALE' && summary.stale.has(p.id))
      || (reviewFilter === 'REPORTED' && summary.reports[p.id] > 0))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [active, typeFilter, reviewFilter, summary]);

  const byLetter = useMemo(() => {
    const groups = {};
    for (const p of browse) {
      const ch = (p.name ?? '').trim().charAt(0).toUpperCase();
      (groups[/[A-Z]/.test(ch) ? ch : '#'] ??= []).push(p);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [browse]);

  return (
    <div className="ui-page" style={{ maxWidth: 900 }}>
      <PageHeader icon="📇" kicker="Workbench" title="Payer Directory"
        subtitle="Find any payer by its name or a short name like “BCBSTX”."
        actions={canEdit && !error && payers != null && (
          <Button size="sm" onClick={() => setShowImport(true)}>⬆ Import from Excel</Button>
        )} />

      {showImport && (
        <Suspense fallback={null}>
          <PayerImport user={user} onClose={() => setShowImport(false)} onImported={loadPayers} />
        </Suspense>
      )}

      <Card>
        {payers == null && <EmptyState compact title="Loading payers…" />}
        {error && (
          <EmptyState icon="🛠️" title="The payer list isn’t set up yet.">
            An admin needs to run the Clients &amp; Payers database update.
          </EmptyState>
        )}
        {payers != null && !error && (
          <PayerSearch payers={payers} onSelect={setSelected} autoFocus />
        )}
      </Card>

      {cardPayer && <PayerCard key={cardPayer.id} payer={cardPayer} user={user} onClose={closeCard} />}

      {payers != null && !error && (
        <Card title={`All payers (${browse.length})`}
          actions={
            <Toolbar>
              {types.length > 0 && (
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Payer type">
                  <option value="ALL">All types</option>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <select value={reviewFilter} onChange={e => setReviewFilter(e.target.value)} aria-label="Review status">
                <option value="ALL">All payers</option>
                <option value="STALE">⚠ Needs re-check ({active.filter(p => summary.stale.has(p.id)).length})</option>
                <option value="REPORTED">🚩 Has open reports ({active.filter(p => summary.reports[p.id] > 0).length})</option>
              </select>
            </Toolbar>
          }>
          {browse.length === 0 && (
            <EmptyState icon="📇" title={active.length ? 'No payers match these filters.' : 'No payers yet.'}>
              {active.length ? null : 'Admins and managers can add them in Clients & Payers.'}
            </EmptyState>
          )}
          {byLetter.map(([letter, list]) => (
            <div key={letter}>
              <div className="ui-letter">{letter}</div>
              <div className="ui-chips">
                {list.map(p => (
                  <Chip key={p.id} on={selected?.id === p.id} onClick={() => setSelected(p)}
                    title={[(p.aliases ?? []).join(', '),
                      summary.stale.has(p.id) && 'Some details need re-checking',
                      summary.reports[p.id] > 0 && `${summary.reports[p.id]} open report(s)`].filter(Boolean).join(' · ')}>
                    {p.name}
                    {summary.stale.has(p.id) && <span aria-label="needs re-check">⚠</span>}
                    {summary.reports[p.id] > 0 && <span aria-label="open reports">🚩</span>}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
