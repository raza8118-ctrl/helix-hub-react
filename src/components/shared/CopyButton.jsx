import { useState, useEffect } from 'react';

/** Small "Copy" button for any value users paste elsewhere (phone, fax, payer ID…). */
export default function CopyButton({ value, label = 'Copy', title }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy(e) {
    e.stopPropagation();
    if (value == null || value === '') return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
    } catch { /* clipboard blocked — nothing to do */ }
  }

  return (
    <button type="button" className="btn-sm" onClick={copy} title={title ?? `Copy ${value ?? ''}`}
      style={{ padding: '2px 8px', fontSize: 11, color: copied ? 'var(--success)' : undefined }}>
      {copied ? '✓ Copied' : label}
    </button>
  );
}
