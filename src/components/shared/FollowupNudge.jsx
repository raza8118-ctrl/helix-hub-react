import { useState, useEffect, useRef } from 'react';
import { dueCounts, openFollowups, notifyEnabled } from '../../lib/followups';
import { today } from '../../lib/helpers';

const REFRESH_MS = 15 * 60 * 1000;
const NUDGE_KEY = 'hh_followup_nudged';   // shown once per day per browser tab session (convenience only)

/**
 * Follow-up reminders while Helix Hub is open (roadmap 6.5): checks this person's due follow-ups at sign-in and every
 * 15 minutes, reports the count (sidebar badge), shows a small pop-up once a day, and — if switched on for this
 * computer — a browser notification when the count goes up. Never shows claim details, only counts.
 */
export default function FollowupNudge({ user, onCount }) {
  const [counts, setCounts] = useState(null);
  const [show, setShow] = useState(false);
  const lastNotified = useRef(0);

  const empId = user.emp_id;
  useEffect(() => {
    let alive = true;
    async function check(first) {
      const c = await dueCounts(empId).catch(() => null);
      if (!alive || !c) return;
      setCounts(c);
      onCount?.(c.due);
      if (first && c.due > 0) {
        let seen = null;
        try { seen = sessionStorage.getItem(NUDGE_KEY); } catch { /* blocked */ }
        if (seen !== today()) {
          setShow(true);
          try { sessionStorage.setItem(NUDGE_KEY, today()); } catch { /* blocked */ }
        }
      }
      if (notifyEnabled() && c.due > lastNotified.current && !first) {
        try { new Notification('Helix Hub', { body: `${c.due} follow-up${c.due === 1 ? '' : 's'} due${c.overdue ? ` (${c.overdue} overdue)` : ''}` }); } catch { /* not allowed */ }
      }
      lastNotified.current = Math.max(lastNotified.current, c.due);
    }
    check(true);
    const timer = setInterval(() => check(false), REFRESH_MS);
    const onChange = () => check(false);
    window.addEventListener('helix:followups-changed', onChange);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('helix:followups-changed', onChange); };
  }, [empId, onCount]);

  if (!show || !counts?.due) return null;
  return (
    <div role="status" style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 900, maxWidth: 320, padding: '12px 14px', borderRadius: 10,
      background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)',
    }}>
      <div className="bold" style={{ marginBottom: 4 }}>⏰ Follow-ups</div>
      <div className="text-sm">
        You have <b>{counts.due - counts.overdue}</b> due today{counts.overdue ? <> and <b style={{ color: 'var(--danger)' }}>{counts.overdue} overdue</b></> : ''}.
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn-primary btn-sm" onClick={() => { setShow(false); openFollowups(); }}>Open</button>
        <button className="btn-sm" onClick={() => setShow(false)}>Later</button>
      </div>
    </div>
  );
}
