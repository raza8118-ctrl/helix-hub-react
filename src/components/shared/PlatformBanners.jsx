import { useState, useEffect } from 'react';
import { loadBroadcasts, HOME_CODE } from '../../lib/owner';

const TONES = {
  info:        { bg: '#1e40af', fg: '#fff', icon: 'ℹ️' },
  warning:     { bg: '#f59e0b', fg: '#1c1917', icon: '⚠️' },
  maintenance: { bg: '#7c2d12', fg: '#fff', icon: '🛠️' },
};
const DISMISSED_KEY = 'hh_banners_dismissed';
const readDismissed = () => { try { return JSON.parse(sessionStorage.getItem(DISMISSED_KEY)) ?? []; } catch { return []; } };

/**
 * Owner Console 2.0: the Helix Hub owner's messages at the top of the app — this company's banner (set in Manage →
 * Profile) and any live broadcast meant for this company. Thin, like the other banners; ✕ hides one for this session.
 */
export default function PlatformBanners({ code, banner }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  const me = code || HOME_CODE;

  useEffect(() => {
    let alive = true;
    const load = () => loadBroadcasts().then(rows => { if (alive && rows) setBroadcasts(rows); });
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const now = new Date().toISOString();
  const live = broadcasts.filter(b => b.active && b.starts_at <= now && (!b.ends_at || b.ends_at > now)
    && (!b.companies?.length || b.companies.includes(me)));
  const items = [
    ...(banner?.text ? [{ key: `co-${banner.text}`, kind: banner.kind ?? 'info', title: banner.text }] : []),
    ...live.map(b => ({ key: `b-${b.id}-${b.updated_at}`, kind: b.kind, title: b.title, body: b.body })),
  ].filter(i => !dismissed.includes(i.key));

  const hide = key => {
    const next = [...dismissed, key];
    setDismissed(next);
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  return items.map(i => {
    const t = TONES[i.kind] ?? TONES.info;
    return (
      <div key={i.key} role="status" style={{
        background: t.bg, color: t.fg, padding: '5px 16px', fontSize: 12.5, fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <span>{t.icon} {i.title}{i.body ? <span style={{ fontWeight: 400 }}> — {i.body}</span> : null}</span>
        <button onClick={() => hide(i.key)} aria-label="Hide this message" style={{
          background: 'transparent', color: t.fg, border: `1px solid ${t.fg}`, borderRadius: 6,
          padding: '2px 8px', fontSize: 12, cursor: 'pointer', opacity: 0.75, flexShrink: 0,
        }}>✕</button>
      </div>
    );
  });
}
