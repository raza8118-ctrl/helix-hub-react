import { useState } from 'react';

function EyeIcon({ off }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="21" x2="21" y2="3" />}
    </svg>
  );
}

/** Password box with a real show / hide button (keyboard + screen readers). Other props go to the input. */
export default function PasswordInput({ id, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-input">
      <input id={id} type={show ? 'text' : 'password'} {...rest} />
      <button
        type="button"
        className="pw-eye"
        onClick={() => setShow(v => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        aria-controls={id}
        title={show ? 'Hide password' : 'Show password'}
      >
        <EyeIcon off={show} />
      </button>
    </div>
  );
}
