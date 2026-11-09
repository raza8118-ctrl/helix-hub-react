import { useState } from 'react';
import { ownerLogin, ownerVerifyCode, setOwnerSession } from '../lib/company';
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
  const [pass, setPass] = useState(null);   // after the password, when 2-step is on: a short-lived pass (not a session)
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, pass: nextPass, error: err } = await ownerLogin(username.trim(), password);
    setLoading(false);
    if (err) { setError(err); return; }
    setPassword('');
    if (nextPass) { setPass(nextPass); return; }
    setOwnerSession(data);
    onOwnerLogin(data);
  }

  async function submitCode(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, expired, error: err } = await ownerVerifyCode(pass, code.trim());
    setLoading(false);
    setCode('');
    if (expired) { setPass(null); setError(err); return; }
    if (err) { setError(err); return; }
    setOwnerSession(data);
    onOwnerLogin(data);
  }

  if (pass) {
    return (
      <main className="ol-shell">
        <form className="ol-card fade-in-scale" onSubmit={submitCode}>
          <OwnerBadge />
          <h1 className="ol-title">Enter your code</h1>
          <p className="ol-sub">Open your authenticator app and type the 6-digit code. Lost your phone? Use a recovery code.</p>
          <div className="form-group">
            <label htmlFor="owner-code">Code</label>
            <input id="owner-code" className="ol-code" type="text" value={code} onChange={e => setCode(e.target.value)} required autoFocus autoComplete="one-time-code" maxLength={9} />
          </div>
          {error && <div className="ol-error" role="alert">{error}</div>}
          <button type="submit" className="ol-submit" disabled={loading || !code.trim()}>{loading ? 'Checking…' : 'Verify'}</button>
          <button type="button" className="ol-back ol-back-btn" onClick={() => { setPass(null); setCode(''); setError(''); }}>← Start again</button>
        </form>
      </main>
    );
  }

  return (
    <main className="ol-shell">
      <form className="ol-card fade-in-scale" onSubmit={submit}>
        <OwnerBadge />
        <h1 className="ol-title">Owner Command Center</h1>
        <p className="ol-sub">Helix Hub owners only. Every sign-in is logged.</p>

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
