import { useEffect } from 'react';
import { unreadMustRead } from '../../lib/board';

const REFRESH_MS = 15 * 60 * 1000;

/**
 * Notice Board count (roadmap 10.3): live must-read notices for this person's team not yet read — checked at sign-in,
 * every 15 minutes and whenever a notice is posted / read. Renders nothing; reports the count for the sidebar.
 */
export default function BoardBadge({ user, onCount }) {
  useEffect(() => {
    let alive = true;
    const check = () => unreadMustRead(user).then(n => { if (alive) onCount?.(n); }).catch(() => {});
    check();
    const timer = setInterval(check, REFRESH_MS);
    window.addEventListener('helix:board-changed', check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('helix:board-changed', check); };
  }, [user, onCount]);
  return null;
}
