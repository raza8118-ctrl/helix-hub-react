import { useState } from 'react';
import { ownerLogin, setOwnerSession } from '../lib/company';
import PasswordInput from './ui/PasswordInput';

function OwnerBadge() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true" className="ol-badge">
      <path d="M32 4 56 13v18c0 14.5-10 24.5-24 29C18 55.5 8 45.5 8 31V13z" fill="var(--ol-badge-bg)" stroke="var(--ol-accent)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M19 40V24l7.5 6.5L32 21l5.5 9.5L45 24v16z" fill="var(--ol-accent)" strokeLinejoin="round" />
      <rect x="19" y="42.5" width="26" height="3.5" rx="1.75" fill="var(--ol-accent)" />
    </svg>
  );
}

/** Owner entrance: the /owner address (and the small "Owner" link on the sign-in page). Has its own fixed dark look. */
export default function OwnerLogin({ onOwnerLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error: err } = await ownerLogin(username.trim(), password);
    setLoading(false);
    if (err) { setError(err); return; }
    setOwnerSession(data);
    onOwnerLogin(data);
  }

  return (
    <main className="ol-shell">
      <form className="ol-card fade-in-scale" onSubmit={submit}>
        <OwnerBadge />
        <h1 className="ol-title">Owner Command Center</h1>
        <p className="ol-sub">Helix Hub owners only.</p>

        <div className="form-group">
          <label htmlFor="owner-id">Owner username</label>
          <input id="owner-id" type="text" value={username} onChange={e => setUsername(e.target.value)} required autoFocus autoComplete="username" />
        </div>
        <div className="form-group">
          <label htmlFor="owner-pw">Password</label>
          <PasswordInput id="owner-pw" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>

        {error && <div className="ol-error" role="alert">{error}</div>}

        <button type="submit" className="ol-submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
        <a className="ol-back" href="/">← Company sign in</a>
      </form>
    </main>
  );
}
