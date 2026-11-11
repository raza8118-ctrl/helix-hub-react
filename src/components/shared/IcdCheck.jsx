import { useState, useEffect } from 'react';
import { checkIcd, icdChildren, icdDot } from '../../lib/icd10';

/**
 * "Check the diagnosis code" (PO 2026-11-11) — shown for CO-146 / CO-167 in the Appeal Builder and Denial Navigator.
 * Looks the code up in the ICD-10-CM list (Master Library) and warns when it is a header (not billable), retired for the
 * date of service, or not yet valid. Only the code is looked up; the date is compared in the browser. Nothing is saved.
 */
const TONE = { ok: 'icd-ok', header: 'icd-bad', retired: 'icd-bad', not_yet: 'icd-bad', unknown: 'icd-bad', invalid: 'icd-bad' };

export default function IcdCheck({ dos: dosFromForm = '', compact = false }) {
  const [code, setCode] = useState('');
  const [ownDos, setDos] = useState('');   // empty = use the form's date of service
  const dos = ownDos || dosFromForm || '';
  const [res, setRes] = useState(null);
  const [kids, setKids] = useState([]);

  useEffect(() => {
    let alive = true;
    const c = code.trim();
    const t = setTimeout(async () => {
      if (c.length < 3) { setRes(null); setKids([]); return; }
      const r = await checkIcd(c, dos || null);
      if (!alive) return;
      setRes(r);
      setKids(r.status === 'header' ? (await icdChildren(r.row.code, 12)).filter(k => !k.retired) : []);
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [code, dos]);

  return (
    <div className={`icd-check${compact ? ' compact' : ''}`}>
      <div className="icd-check-t">Check the diagnosis code <span className="text-sm text-muted">— CO-146 / CO-167 are often a header code or a code not valid for the date of service</span></div>
      <div className="icd-check-row">
        <label className="ocd-field" style={{ margin: 0, flex: '1 1 140px' }}>
          <span className="text-sm">ICD-10-CM code</span>
          <input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. I50.9" aria-label="ICD-10-CM code to check" maxLength={10} />
        </label>
        <label className="ocd-field" style={{ margin: 0, flex: '1 1 150px' }}>
          <span className="text-sm">Date of service (optional)</span>
          <input type="date" value={dos} onChange={e => setDos(e.target.value)} aria-label="Date of service" />
        </label>
      </div>
      {res && (
        <div className={`icd-check-res ${TONE[res.status]}`} role="status">
          <strong>{res.status === 'ok' ? '✓ ' : '⚠ '}{res.message}</strong>
          {res.row && <div className="text-sm">{res.row.long_description || res.row.description}</div>}
          {kids.length > 0 && (
            <div className="text-sm" style={{ marginTop: 4 }}>
              More specific codes: {kids.map(k => (
                <button key={k.code} type="button" className="icd-from" style={{ marginLeft: 0, marginRight: 8 }} onClick={() => setCode(icdDot(k.code))}
                  title={k.long_description || k.description}>{icdDot(k.code)}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="text-sm text-muted" style={{ marginTop: 4 }}>
        Codes only — nothing is saved. Full details and coding notes: AR Tools → 🔎 Code lookup.
      </div>
    </div>
  );
}
