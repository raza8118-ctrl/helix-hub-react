import { useState, useEffect, useMemo } from 'react';
import { hasAccess } from '../../lib/access';
import {
  getAppealDraft, saveAppealDraft, clearAppealDraft, peekPrefill, clearPrefill, emptyAppeal, hasIdentifiers, typeForCategory,
} from '../../lib/appeals';
import { loadDenialCodes, parseCodeLine, findCode } from '../../lib/denials';
import { loadDenialSteps, loadStepContext } from '../../lib/denialSteps';
import { loadSopLibrary } from '../../lib/sops';
import { loadSopVersionMeta } from '../../lib/sopVersions';
import AppealForm from './AppealForm';
import AppealSidePanel from './AppealSidePanel';
import AppealLetter from './AppealLetter';
import AppealTemplates from './AppealTemplates';
import { loadTemplates } from '../../lib/appealTemplates';
import SopPage from './SopPage';
import PayerCard from './PayerCard';
import { confirmDialog } from '../../components/shared/Dialog';

/**
 * ✉️ Appeal Builder (roadmap Phase 5). 5.1 = the appeal form + side panel (deadline, where to send, steps, facts);
 * 5.2 = the letter built from templates (filled locally) + 📚 Templates tab for "Manage appeal letter templates".
 * Nothing is saved to the database, logged or kept in browser storage — the form is in memory only.
 */
export default function AppealBuilder({ user }) {
  const empId = user.emp_id;
  const [form, setForm] = useState(() => {
    const base = getAppealDraft(empId);
    const p = peekPrefill();
    return p ? { ...base, codes: p.codes || base.codes, client_id: p.client_id || base.client_id, payer_id: p.payer_id || base.payer_id, typeTouched: false } : base;
  });
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [codes, setCodes] = useState([]);
  const [steps, setSteps] = useState(null);
  const [sopId, setSopId] = useState(null);
  const [sopCtx, setSopCtx] = useState(null);
  const [payerCard, setPayerCard] = useState(null);
  const [templates, setTemplates] = useState(undefined);   // 5.2: undefined = loading, null = not set up
  const [tab, setTab] = useState('appeal');                // 'appeal' | 'templates'
  const canManageTemplates = hasAccess(user, 'appeal_templates');

  const reloadTemplates = () => loadTemplates().then(setTemplates);
  useEffect(() => {
    let alive = true;
    clearPrefill();   // "Start an appeal" values are now in the form
    loadStepContext().then(c => { if (alive) setCtx(c); });
    loadDenialCodes().then(c => { if (alive) setCodes(c ?? []); });
    loadDenialSteps().then(s => { if (alive) setSteps(s); });
    loadTemplates().then(t => { if (alive) setTemplates(t); });
    return () => { alive = false; };
  }, []);

  // Keep the in-memory copy up to date (survives switching sidebar tabs; never stored anywhere)
  useEffect(() => { saveAppealDraft(empId, form); }, [empId, form]);

  // SOPs linked from the steps open here, like in the Denial Navigator
  useEffect(() => {
    let alive = true;
    if (sopId != null) {
      Promise.all([loadSopLibrary(), loadSopVersionMeta({ emp_id: empId })]).then(([lib, meta]) => {
        if (alive) setSopCtx({ lib: lib ? { ...lib, versionsReady: meta != null } : null, meta });
      });
    }
    return () => { alive = false; };
  }, [sopId, empId]);

  const set = patch => setForm(f => ({ ...f, ...patch }));
  const client = ctx.clients.find(c => String(c.id) === String(form.client_id)) ?? null;
  const payer = ctx.payers.find(p => String(p.id) === String(form.payer_id)) ?? null;
  const matched = useMemo(() => (parseCodeLine(form.codes) ?? []).map(parsed => ({ parsed, row: findCode(codes, parsed) })), [form.codes, codes]);
  const firstCategory = matched.find(m => m.row?.category)?.row.category;
  const effectiveType = form.typeTouched ? form.denial_type : typeForCategory(firstCategory);
  const sensitive = hasIdentifiers({ ...form, denial_type: effectiveType });

  async function clearForm() {
    if (!await confirmDialog({
      title: 'Clear the appeal form?', message: 'Everything typed here is removed from this computer.', confirmText: 'Clear', tone: 'warning',
    })) return;
    clearAppealDraft();
    setForm(emptyAppeal());
  }

  if (sopId != null) {
    const canEditSops = hasAccess(user, 'sops_edit');
    const sop = sopCtx?.lib?.sops.find(s => s.id === sopId);
    const readable = sop && (canEditSops || (sop.active !== false && sop.status === 'published'));
    const back = () => { setSopId(null); setSopCtx(null); };
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {!sopCtx && <div className="card text-muted">Loading SOP…</div>}
        {sopCtx && !readable && (
          <div className="card"><button className="btn-sm" onClick={back}>← Back to the appeal</button><p className="text-muted">This SOP isn’t published yet.</p></div>
        )}
        {sopCtx && readable && (
          <SopPage key={sop.id} sop={sop} lib={sopCtx.lib} meta={sopCtx.meta} names={{}} user={user} canEdit={canEditSops}
            backLabel="← Back to the appeal" onBack={back} onChanged={() => {}} onOpenSop={setSopId} />
        )}
      </div>
    );
  }
  if (payerCard) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <button className="btn-sm" style={{ marginBottom: 12 }} onClick={() => setPayerCard(null)}>← Back to the appeal</button>
        <PayerCard key={payerCard.id} payer={payerCard} user={user} onClose={() => setPayerCard(null)} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">✉️ Appeal Builder</div>
          <div className="page-subtitle">Fill in the claim and denial facts — the letter below is built from them.</div>
        </div>
        {tab === 'appeal' && <button className="btn-sm" onClick={clearForm}>🗑 Clear form</button>}
      </div>

      {canManageTemplates && Array.isArray(templates) && (
        <div className="row" style={{ gap: 6, marginBottom: 12 }}>
          {[['appeal', '✉️ Appeal'], ['templates', '📚 Templates']].map(([id, label]) => (
            <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}

      {tab === 'templates' && canManageTemplates && Array.isArray(templates) && (
        <AppealTemplates templates={templates} clients={ctx.clients} user={user} onChanged={reloadTemplates} />
      )}

      {tab === 'appeal' && sensitive && (
        <div className="card mb-16" style={{ border: '2px solid var(--danger)', fontWeight: 600 }}>
          🔒 Contains patient details — they stay on this computer only (not saved anywhere). Clear the form when you’re done.
        </div>
      )}

      {tab === 'appeal' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
            <AppealForm form={form} set={set} ctx={ctx} payer={payer} matched={matched} effectiveType={effectiveType} />
            <AppealSidePanel form={form} effectiveType={effectiveType} client={client} payer={payer} matched={matched}
              steps={steps} ctx={ctx} user={user} onOpenSop={setSopId} onOpenPayer={setPayerCard} />
          </div>
          <AppealLetter form={form} set={set} effectiveType={effectiveType} client={client} payer={payer}
            matched={matched} templates={templates} user={user} />
        </>
      )}
    </div>
  );
}
