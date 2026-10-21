import { useEffect } from 'react';
import { unreadForMe } from '../../lib/payerUpdates';

const REFRESH_MS = 15 * 60 * 1000;

/**
 * Payer Updates count (roadmap 8.2): new changes for this person's team not yet marked “✓ Got it” — checked at
 * sign-in, every 15 minutes and whenever a change is read / saved. Renders nothing; reports the count for the sidebar.
 */
export default function PayerUpdatesBadge({ user, onCount }) {
  useEffect(() => {
    let alive = true;
    const check = () => unreadForMe(user).then(n => { if (alive) onCount?.(n); }).catch(() => {});
    check();
    const timer = setInterval(check, REFRESH_MS);
    window.addEventListener('helix:payer-updates-changed', check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('helix:payer-updates-changed', check); };
  }, [user, onCount]);
  return null;
}
