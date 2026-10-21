import { useState, useEffect } from 'react';
import { hasAccess } from '../../lib/access';
import { loadStepContext } from '../../lib/denialSteps';
import { loadDenialCodes } from '../../lib/denials';
import { loadFormats } from '../../lib/claimNotes';
import ClaimNoteGenerator from './ClaimNoteGenerator';
import NoteFormats from './NoteFormats';
import DeadlineTool from './DeadlineTool';
import HomeHealthCalc from './HomeHealthCalc';
import HospiceCalc from './HospiceCalc';
import PaymentCalc from './PaymentCalc';
import CodeLookup from './CodeLookup';
import PortalLaunchpad from './PortalLaunchpad';

/**
 * 🧮 AR Tools (roadmap Phase 6): everyday helpers for AR callers. 6.1 = Claim Note Generator
 * (+ 📚 Note formats for holders of “Manage claim note formats”); 6.2 = calculators (filing / appeal deadlines,
 * home health, hospice, expected payment); 6.3 = code lookup (CARC/RARC, revenue, HIPPS, ICD-10); 6.6 = portal launchpad.
 */
export default function ARTools({ user }) {
  const canManageFormats = hasAccess(user, 'note_formats');
  const [tool, setTool] = useState('notes');
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [codes, setCodes] = useState([]);
  const [formats, setFormats] = useState(undefined);   // undefined = loading, null = not set up

  const reloadFormats = () => loadFormats().then(setFormats);
  useEffect(() => {
    let alive = true;
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadDenialCodes().then(c => { if (alive) setCodes(c ?? []); });
    loadFormats().then(f => { if (alive) setFormats(f); });
    return () => { alive = false; };
  }, []);

  const tools = [
    { id: 'notes', label: '📝 Claim Note Generator' },
    // 6.2 calculators
    { id: 'deadlines', label: '⏰ Filing & appeal deadlines' },
    { id: 'homehealth', label: '🏠 Home health' },
    { id: 'hospice', label: '🕊️ Hospice' },
    { id: 'payment', label: '💲 Expected payment' },
    { id: 'codes', label: '🔎 Code lookup' },   // 6.3
    { id: 'portals', label: '🚀 Portal launchpad' },   // 6.6
    ...(canManageFormats && Array.isArray(formats) ? [{ id: 'formats', label: '📚 Note formats' }] : []),
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">🧮 AR Tools</div>
          <div className="page-subtitle">Everyday helpers to work claims faster — nothing you type here is saved.</div>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {tools.map(t => (
          <button key={t.id} className={tool === t.id ? 'btn-primary' : 'btn-sm'} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>{t.label}</button>
        ))}
      </div>
      {formats === null && tool === 'notes' && (
        <div className="card mb-16 text-sm text-muted">
          Using the built-in standard note format. Client-specific formats need the note formats database update
          (<code>20261021h_note_formats.sql</code>).
        </div>
      )}
      {tool === 'notes' && <ClaimNoteGenerator user={user} ctx={ctx} formats={Array.isArray(formats) ? formats : []} codes={codes} />}
      {tool === 'deadlines' && <DeadlineTool ctx={ctx} />}
      {tool === 'homehealth' && <HomeHealthCalc />}
      {tool === 'hospice' && <HospiceCalc />}
      {tool === 'payment' && <PaymentCalc />}
      {tool === 'codes' && <CodeLookup user={user} />}
      {tool === 'portals' && <PortalLaunchpad user={user} ctx={ctx} />}
      {tool === 'formats' && canManageFormats && Array.isArray(formats) && (
        <NoteFormats formats={formats} clients={ctx.clients} user={user} onChanged={reloadFormats} />
      )}
    </div>
  );
}
