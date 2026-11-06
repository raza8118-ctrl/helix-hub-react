import { useState, useEffect } from 'react';
import { loadStepContext } from '../../lib/denialSteps';
import { loadDenialCodes } from '../../lib/denials';
import { canViewReports } from '../../lib/reports';
import DenialTrends from './DenialTrends';
import WeeklyClientReport from './WeeklyClientReport';
import { Button } from '../../components/ui';

/**
 * 📈 Reports (roadmap 10.2): 🧩 Denial trends and 🗓 Weekly client report. Read-only, for “View reports” holders
 * (admin / manager / supervisor by default). Exports carry counts and names only.
 */
export default function Reports({ user }) {
  const allowed = canViewReports(user);
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [codes, setCodes] = useState([]);
  const [tab, setTab] = useState('denials');

  useEffect(() => {
    let alive = true;
    if (!allowed) return undefined;
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadDenialCodes().then(c => { if (alive) setCodes(c ?? []); });
    return () => { alive = false; };
  }, [allowed]);

  return (
    <div className="fg-page wl-page">
      {/* Intro (the page title is in the top bar) */}
      <div className="fg-bar">
        <span className="fg-date">Denial trends by payer and client, and a weekly report for each client.</span>
      </div>
      {!allowed ? (
        <div className="card text-muted">Reports are available to managers and supervisors, or anyone an admin gives “View reports”.</div>
      ) : (
        <>
          <div className="fg-choices wl-tabs" role="group" aria-label="Reports">
            {[['denials', '🧩 Denial trends'], ['weekly', '🗓 Weekly client report']].map(([id, label]) => (
              <Button key={id} size="sm" active={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Button>
            ))}
          </div>
          {tab === 'denials' && <DenialTrends ctx={ctx} codes={codes} user={user} />}
          {tab === 'weekly' && <WeeklyClientReport ctx={ctx} user={user} />}
        </>
      )}
    </div>
  );
}
