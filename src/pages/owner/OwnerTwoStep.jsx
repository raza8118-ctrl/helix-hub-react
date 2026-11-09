import { useState } from 'react';
import { twoStepBegin, twoStepConfirm, twoStepDisable } from '../../lib/owner';
import CopyButton from '../../components/shared/CopyButton';
import PasswordInput from '../../components/ui/PasswordInput';

const ERRORS = {
  password: 'That password isn’t right.',
  invalid: 'That code isn’t right. Check the app and try the current code.',
  locked: 'Too many attempts. Try again in 15 minutes.',
  already_on: '2-step verification is already on.',
  not_started: 'Please start the setup again.',
};
const errOf = r => (r.error === 'NOT_SET_UP' ? 'This needs the 2-step database update (migration 45) first.' : r.error) || ERRORS[r.data?.error] || (r.data?.ok === false ? 'That didn’t work. Please try again.' : '');

/** 👑 Owners & security → My 2-step verification. The code is checked in the database; the QR is drawn here in the browser. */
export default function OwnerTwoStep({ owner, status, onChanged }) {
  const [step, setStep] = useState('idle');   // idle → password → scan → codes; on: idle ⇄ off
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null);   // { secret, qr } — memory only, gone after confirming
  const [recovery, setRecovery] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() { setStep('idle'); setPassword(''); setCode(''); setSetup(null); setErr(''); }

  async function begin(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const r = await twoStepBegin(owner, password);
    if (errOf(r)) { setErr(errOf(r)); setBusy(false); return; }
    const qrcode = (await import('qrcode-generator')).default;
    const q = qrcode(0, 'M');
    q.addData(r.data.uri);
    q.make();
    setSetup({ secret: r.data.secret, qr: q.createDataURL(5, 8) });
    setPassword('');
    setStep('scan');
    setBusy(false);
  }

  async function confirm(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const r = await twoStepConfirm(owner, code);
    setBusy(false);
    if (errOf(r)) { setErr(errOf(r)); setCode(''); return; }
    setRecovery(r.data.recovery ?? []);
    setSetup(null); setCode('');
    setStep('codes');
    onChanged();
  }

  async function turnOff(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const r = await twoStepDisable(owner, password, code);
    setBusy(false);
    if (errOf(r)) { setErr(errOf(r)); setCode(''); return; }
    reset();
    onChanged();
  }

  if (status === null) return null;

  return (
    <div className="card mb-16">
      <div className="card-header">
        <div className="card-title">My 2-step verification</div>
        {status && <span className={`badge ${status.enabled ? 'badge-green' : 'badge-red'}`}>{status.enabled ? 'On' : 'Off'}</span>}
      </div>

      {step === 'codes' ? (
        <>
          <p className="text-sm" style={{ marginTop: 0 }}>
            <strong>2-step is on.</strong> Save these recovery codes somewhere safe, away from your phone. Each one works once if you lose your phone. They won’t be shown again.
          </p>
          <div className="ot-codes">{recovery.map(c => <code key={c}>{c}</code>)}</div>
          <div className="row" style={{ gap: 8 }}>
            <CopyButton value={recovery.join('\n')} />
            <button type="button" className="btn-primary" onClick={() => { setRecovery([]); reset(); }}>I’ve saved them</button>
          </div>
        </>
      ) : !status ? (
        <div className="loading-row"><div className="spinner" /> Loading…</div>
      ) : status.enabled ? (
        step === 'off' ? (
          <form onSubmit={turnOff} className="ot-form">
            <div className="field"><label htmlFor="ot-off-pw">Password</label>
              <PasswordInput id="ot-off-pw" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></div>
            <div className="field"><label htmlFor="ot-off-code">Code from your app (or a recovery code)</label>
              <input id="ot-off-code" value={code} onChange={e => setCode(e.target.value)} required autoComplete="one-time-code" /></div>
            {err && <p className="ot-err" role="alert">{err}</p>}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn-sm" onClick={reset}>Cancel</button>
              <button type="submit" className="btn-danger" disabled={busy}>Turn off 2-step</button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm" style={{ marginTop: 0 }}>
              You’re asked for a code from your authenticator app after your password. {status.recovery_left} recovery code{status.recovery_left === 1 ? '' : 's'} left.
            </p>
            <button type="button" className="btn-sm" onClick={() => setStep('off')}>Turn off…</button>
          </>
        )
      ) : step === 'password' ? (
        <form onSubmit={begin} className="ot-form">
          <div className="field"><label htmlFor="ot-pw">Enter your password to start</label>
            <PasswordInput id="ot-pw" value={password} onChange={e => setPassword(e.target.value)} required autoFocus autoComplete="current-password" /></div>
          {err && <p className="ot-err" role="alert">{err}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn-sm" onClick={reset}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Starting…' : 'Continue'}</button>
          </div>
        </form>
      ) : step === 'scan' && setup ? (
        <form onSubmit={confirm} className="ot-scan">
          <img className="ot-qr" src={setup.qr} alt="QR code to scan with your authenticator app" />
          <div className="ot-form">
            <p className="text-sm" style={{ marginTop: 0 }}>Scan this with Google Authenticator, Microsoft Authenticator or a similar app. Can’t scan? Enter this key instead:</p>
            <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}><code className="ot-secret">{setup.secret}</code><CopyButton value={setup.secret} /></div>
            <div className="field"><label htmlFor="ot-code">Then type the 6-digit code it shows</label>
              <input id="ot-code" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={7} required autoFocus autoComplete="one-time-code" /></div>
            {err && <p className="ot-err" role="alert">{err}</p>}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn-sm" onClick={reset}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Turn on 2-step'}</button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm" style={{ marginTop: 0 }}>Right now your password alone opens the Owner Console. Add a code from an authenticator app on your phone.</p>
          <button type="button" className="btn-primary" onClick={() => setStep('password')}>Set up 2-step verification</button>
        </>
      )}
    </div>
  );
}
