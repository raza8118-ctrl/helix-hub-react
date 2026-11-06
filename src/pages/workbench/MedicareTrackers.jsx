import { useState, useEffect, useMemo } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadPeople } from '../../lib/qa';
import { loadMedicare, clearOldMedicare, isDone } from '../../lib/medicareTrackers';
import MedicareOverview from './MedicareOverview';
import AdrTracker from './AdrTracker';
import OverpaymentTracker from './OverpaymentTracker';
import RtpMonitor from './RtpMonitor';
import { Button } from '../../components/ui';

/**
 * 🏛️ Medicare Trackers (roadmap 7.5): ADRs, overpayments / credit balances and the RTP / suspense monitor, with an
 * overview. Minimum fields only; RTP uploads drop patient columns in the browser; claim # / DCN wiped 90 days after
 * an item is closed. Everyone works their own items; “Manage Medicare trackers” uploads, assigns and changes all.
 */
export default function MedicareTrackers({ user }) {
  const [data, setData] = useState(undefined);         // undefined = loading, null = not set up
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [people, setPeople] = useState([]);
  const [tab, setTab] = useState('overview');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadPeople().then(p => { if (alive) setPeople(p); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let d = await loadMedicare();
      if (d && await clearOldMedicare(user)) d = await loadMedicare();   // claim # wiped 90 days after closing
      if (alive) setData(d);
    })();
    return () => { alive = false; };
  }, [user, reloadKey]);

  const names = useMemo(() => Object.fromEntries(people.map(p => [p.emp_id, p.name ?? p.emp_id])), [people]);
  const count = kind => (data ? data[kind].filter(i => !isDone(kind, i)).length : 0);
  const props = { ctx, people, names, user, onChanged: reload };

  return (
    <div className="fg-page wl-page">
      {/* Intro (the page title is in the top bar) */}
      <div className="fg-bar">
        <span className="fg-date">ADRs, overpayments and credit balances, and claims stuck in RTP or suspense.</span>
      </div>

      {data === undefined && <div className="card text-muted">Loading…</div>}
      {data === null && (
        <div className="card text-muted">
          Medicare Trackers aren’t set up yet. An admin needs to run the database update
          (<code>20261021q_medicare_trackers.sql</code>) in Supabase.
        </div>
      )}

      {data && (
        <>
          <div className="fg-choices wl-tabs" role="group" aria-label="Medicare trackers">
            {[
              ['overview', '📊 Overview'],
              ['adr', `📄 ADRs (${count('adr')})`],
              ['overpayment', `💸 Overpayments & credit balances (${count('overpayment')})`],
              ['rtp', `🔁 RTP / suspense (${count('rtp')})`],
            ].map(([id, label]) => (
              <Button key={id} size="sm" active={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Button>
            ))}
          </div>
          {tab === 'overview' && <MedicareOverview data={data} ctx={ctx} names={names} onOpen={setTab} />}
          {tab === 'adr' && <AdrTracker items={data.adr} {...props} />}
          {tab === 'overpayment' && <OverpaymentTracker items={data.overpayment} {...props} />}
          {tab === 'rtp' && <RtpMonitor items={data.rtp} uploads={data.uploads} {...props} />}
        </>
      )}
    </div>
  );
}
