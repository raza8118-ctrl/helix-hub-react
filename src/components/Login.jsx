import { useState, useEffect } from 'react';
import { supabase, getTablePrefix, setActiveCompany, setSessionToken } from '../lib/supabase';
import { findCompany, findPausedCompany, SIGNOUT_MSG_KEY } from '../lib/company';
import { logAudit } from '../lib/audit';
import PasswordInput from './ui/PasswordInput';

const LAST_COMPANY_KEY = 'hh_last_company';

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </svg>
  );
}

function HexLogo({ size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2" width="96" height="96" rx="26" fill="var(--sb-logo-bg)" />
      <g stroke="var(--sb-logo-text)" fill="none" strokeLinecap="round">
        <path d="M36,21 C36,38 64,38 64,50 C64,62 36,62 36,79" strokeWidth="6" />
        <path d="M64,21 C64,38 36,38 36,50 C36,62 64,62 64,79" strokeWidth="6" />
        <path d="M42,29 H58 M47,50 H53 M42,71 H58" strokeWidth="4.5" opacity="0.6" />
      </g>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

// Security stage 1: the password is checked inside the database (rcm.user_login) — the browser never receives it.
// Stage 2: also returns a 12-hour session key and locks an ID for 15 minutes after 5 wrong passwords.
// → { user } (null for a wrong ID / password, no password field) or { locked: message }.
async function checkPassword(empId, password) {
  const { data, error } = await supabase.rpc('user_login', { p_prefix: getTablePrefix(), p_emp_id: empId, p_password: password });
  if (error) {
    if (/too many attempts/i.test(error.message)) return { locked: 'Too many attempts. Try again in 15 minutes.' };
    throw error;
  }
  if (!data) return { user: null };
  const user = { ...data };
  setSessionToken(user.session);
  delete user.session;
  return { user };
}

const FEATURES = [
  { text: 'Live productivity, attendance, and quality tracking' },
  { text: 'Role-aware dashboards for employees, supervisors, and managers' },
  { text: 'Team announcements with read receipts, all in one place' },
];

export default function Login({ onLogin }) {
  // 'company' (step 1) → 'login' (step 2) ⇄ 'forgot'. Owners sign in at /owner (OwnerLogin).
  const [view, setView]         = useState('company');
  const [company, setCompany]   = useState(null);
  const [companyInput, setCompanyInput] = useState(() => {
    try { return localStorage.getItem(LAST_COMPANY_KEY) || ''; } catch { return ''; }
  });
  const [empId, setEmpId]       = useState('');
  const [password, setPassword] = useState('');
  const [forgotId, setForgotId] = useState('');
  // Owner Console: a pause or "sign everyone out" leaves a one-time message for the login screen
  const [error, setError]       = useState(() => { try { return sessionStorage.getItem(SIGNOUT_MSG_KEY) || ''; } catch { return ''; } });
  useEffect(() => { try { sessionStorage.removeItem(SIGNOUT_MSG_KEY); } catch { /* storage unavailable */ } }, []);
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotOk, setForgotOk]   = useState(false);
  const [loading, setLoading]     = useState(false);

  async function doCompany(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const c = await findCompany(companyInput);
      const paused = c ? null : await findPausedCompany(companyInput);
      if (paused) {
        setError(`${paused.name}'s access to Helix Hub is paused. ${paused.pause_message || 'Please contact your administrator.'}`);
      } else if (!c) {
        setError(`We couldn't find a workspace called "${companyInput.trim()}". Check the spelling, or ask your administrator for your company name or code.`);
      } else {
        try { localStorage.setItem(LAST_COMPANY_KEY, companyInput.trim()); } catch { /* storage unavailable */ }
        setActiveCompany(c);   // all queries from here on use this company's tables
        setCompany(c);
        setView('login');
      }
    } catch {
      setError('Connection error. Please try again.');
    }
    setLoading(false);
  }

  function toCompany() { setView('company'); setCompany(null); setActiveCompany(null); setError(''); setPassword(''); }

  async function doLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user: u, locked } = await checkPassword(empId.trim().toUpperCase(), password);
      if (locked) {
        setError(locked);
        setLoading(false);
        return;
      }
      if (!u) {
        setError('Invalid Employee ID or password.');
        setLoading(false);
        return;
      }
      if (u.active === false) {
        setError('This account is switched off. Please contact your administrator.');
        setLoading(false);
        return;
      }
      sessionStorage.setItem('hh_user', JSON.stringify(u));
      logAudit({ actor: u, action: 'sign_in' });
      onLogin(u);
    } catch {
      setError('Connection error. Please try again.');
    }
    setLoading(false);
  }

  async function doForgot(e) {
    e.preventDefault();
    setForgotMsg('');
    setForgotOk(false);
    setLoading(true);
    // Stage 3: creates a reset request for the admins / supervisors (Team page). The same message is shown whether or
    // not the ID exists, so the screen can't be used to find valid IDs.
    try {
      const { error } = await supabase.rpc('request_password_reset', { p_prefix: getTablePrefix(), p_emp_id: forgotId.trim() });
      if (error) throw error;
      setForgotMsg('Thanks. If that Employee ID exists, your administrator has been asked to reset your password. They will give you a temporary one.');
      setForgotOk(true);
    } catch {
      setForgotMsg('Connection error. Please try again.');
    }
    setLoading(false);
  }

  function toForgot() { setView('forgot'); setError(''); setForgotMsg(''); setForgotOk(false); setForgotId(''); }
  function toLogin()  { setView('login');  setForgotMsg(''); setForgotOk(false); }

  return (
    <div className="login-shell">
      {/* Brand panel — hidden on narrow screens */}
      <div className="login-brand-panel">
        <div>
          <HexLogo size={56} />
          <div className="lg-brand-name">Helix Hub</div>
          <div className="lg-brand-sub">
            {/* Company name stays hidden until step 1 is passed */}
            The RCM team portal{company ? ` for ${company.name}` : ''} — track performance, manage your team, and stay in sync.
          </div>
          {FEATURES.map(f => (
            <div key={f.text} className="login-feature">
              <span className="login-feature-icon"><CheckIcon /></span>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
        <div className="lg-credit">Created by Faizan Shah</div>
      </div>

      {/* Form panel */}
      <div className="login-form-panel">
        <div className="lg-card fade-in-scale">
          {/* Logo (shown here too — the brand panel collapses on narrow screens) */}
          <HexLogo />
          <div className="lg-title">Helix Hub</div>
          <div className="lg-sub">RCM Team Portal</div>

          {/* Selected company banner (steps 2+) */}
          {company && view !== 'company' && (
            <div className="lg-company">
              <span className="lg-company-i"><BuildingIcon /></span>
              <div className="lg-company-t">
                <div className="lg-company-l">Company</div>
                <div className="lg-company-n">{company.name}</div>
              </div>
              <button type="button" onClick={toCompany} className="btn-link lg-change">
                Change
              </button>
            </div>
          )}

        {view === 'company' ? (
          <form onSubmit={doCompany} className="lg-form">
            <p className="lg-intro">Enter your company name to continue to your workspace.</p>
            <div className="form-group">
              <label htmlFor="company-name">Company name</label>
              <input
                id="company-name"
                type="text"
                value={companyInput}
                onChange={e => setCompanyInput(e.target.value)}
                placeholder="e.g. Acme Health"
                required
                autoFocus
                autoComplete="organization"
              />
            </div>

            {error && <div className="lg-msg bad" role="alert">{error}</div>}

            <button type="submit" disabled={loading || !companyInput.trim()} className="btn btn-login btn-lg">
              {loading ? 'Checking…' : 'Continue →'}
            </button>
          </form>
        ) : view === 'login' ? (
          <form onSubmit={doLogin} className="lg-form">
            <div className="form-group">
              <label htmlFor="emp-id">Employee ID</label>
              <input
                id="emp-id"
                type="text"
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                placeholder="e.g. EMP001"
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="login-pw">Password</label>
              <PasswordInput
                id="login-pw"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && <div className="lg-msg bad" role="alert">{error}</div>}

            <button type="submit" disabled={loading} className="btn btn-login btn-lg lg-gap">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <button type="button" onClick={toForgot} className="btn-link">
              Forgot Password?
            </button>
          </form>
        ) : (
          <form onSubmit={doForgot} className="lg-form">
            <p className="lg-intro">Enter your Employee ID and your administrator will reset your password.</p>
            <div className="form-group">
              <label htmlFor="forgot-id">Employee ID</label>
              <input
                id="forgot-id"
                type="text"
                value={forgotId}
                onChange={e => setForgotId(e.target.value)}
                placeholder="e.g. EMP001"
                required
                autoFocus
              />
            </div>

            {forgotMsg && <div className={`lg-msg ${forgotOk ? 'good' : 'bad'}`} role="status">{forgotMsg}</div>}

            {!forgotOk && (
              <button type="submit" disabled={loading} className="btn btn-login btn-lg lg-gap">
                {loading ? 'Checking…' : 'Submit'}
              </button>
            )}

            <button type="button" onClick={toLogin} className="btn-link">
              ← Back to Sign In
            </button>
          </form>
        )}
        </div>
        <a className="lg-owner-link" href="/owner">Owner</a>
      </div>
    </div>
  );
}
