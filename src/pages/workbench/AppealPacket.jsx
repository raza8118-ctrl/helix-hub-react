import { useState, useEffect, useRef } from 'react';
import { S, kv } from '../../lib/supabase';
import { hasAccess } from '../../lib/access';
import { logAudit } from '../../lib/audit';
import { payerFormLink } from '../../lib/payerForms';
import { peekPacketHandoff, clearPacketHandoff } from '../../lib/packetHandoff';
import { IMAGE_EXTENSIONS } from '../../lib/imageToPdf';
import {
  PACKET_SECTIONS, PACKET_TYPES, NAMING_TOKENS, DEFAULT_NAMING, fileToPdf, applyNaming, assemblePacket,
} from '../../lib/packet';
import PayerSearch from '../../components/shared/PayerSearch';
import PdfSaveOptions from './PdfSaveOptions';
import { Modal, Card, Item, Button, Check, Field, FormActions, Notice, Toolbar, EmptyState } from '../../components/ui';

const NAMING_KEY = 'packet_naming';
const ACCEPT = ['.pdf', ...IMAGE_EXTENSIONS.map(x => `.${x}`)].join(',');

const problemText = (name, err) => `${name}: ${
  err.message === 'password' ? 'password-protected — remove the password and try again'
  : err.message === 'heic' ? 'iPhone HEIC photos aren’t supported — save it as JPG'
  : err.message === 'unsupported' ? 'not a PDF or supported image'
  : 'damaged or unreadable'}`;

const payerShort = p => {
  if (!p) return '';
  const alias = (p.aliases ?? []).find(a => a && !/\s/.test(a));   // e.g. "BCBSTX"
  return alias ?? p.name;
};

/** Admin-style pop-up to set the company's packet file naming convention (needs “Appeal Packet settings”). */
function NamingSettings({ current, user, onClose, onSaved }) {
  const [template, setTemplate] = useState(current);
  const [saving, setSaving] = useState(false);
  const sample = applyNaming(template, {
    claimNo: 'A123456', payer: 'BCBSTX', client: 'SRHH', type: 'Appeal', dos: '01-05-2026', patientLast: 'Smith',
  });

  async function save() {
    setSaving(true);
    const ok = await kv.set(NAMING_KEY, template.trim() || DEFAULT_NAMING);
    setSaving(false);
    if (!ok) return;
    logAudit({ actor: user, action: 'packet_naming_change', entityType: 'setting', entityId: NAMING_KEY, details: { template: template.trim() || DEFAULT_NAMING } });
    onSaved(template.trim() || DEFAULT_NAMING);
  }

  return (
    <Modal title="Appeal Packet file names" onClose={onClose}>
      <div className="ui-stack">
        <Field label="Naming convention for this company" style={{ marginBottom: 0 }}>
          <input type="text" value={template} onChange={e => setTemplate(e.target.value)} />
        </Field>
        <div className="ui-row" style={{ gap: 6 }}>
          {NAMING_TOKENS.map(t => (
            <Button key={t.token} size="xs" title={t.label}
              onClick={() => setTemplate(v => `${v}${v && !/[_\-. ]$/.test(v) ? '_' : ''}${t.token}`)}>
              + {t.label}
            </Button>
          ))}
        </div>
        <div className="ui-small">Example: <strong>{sample}</strong></div>
        {/\{PatientLast\}/.test(template) && (
          <Notice tone="warn">
            ⚠ Patient names in file names show up in email subjects, portal upload logs and download folders. Only use it if your clients require it.
          </Notice>
        )}
        <FormActions split>
          <Button variant="ghost" onClick={() => setTemplate(DEFAULT_NAMING)}>Reset to default</Button>
          <div className="ui-row">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </FormActions>
      </div>
    </Modal>
  );
}

/**
 * Appeal Packet builder (roadmap 2.5): cover sheet + sections in order → one PDF with page numbers,
 * named by the company convention, then the shared Original / Compress save step. All in the browser.
 */
export default function AppealPacket({ user }) {
  const canEditNaming = hasAccess(user, 'packet_settings');
  // 5.5: an appeal handed over from the Appeal Builder starts the packet (in memory only; taken once, below)
  const [handoff] = useState(() => peekPacketHandoff());
  const [type, setType]         = useState(handoff?.type ?? 'Appeal');
  const [payer, setPayer]       = useState(handoff?.payer ?? null);
  const [contacts, setContacts] = useState([]);
  const [forms, setForms]       = useState([]);
  const [clients, setClients]   = useState([]);
  const [clientId, setClientId] = useState(handoff?.clientId ?? '');
  const [claimNo, setClaimNo]   = useState(handoff?.claimNo ?? '');
  const [dos, setDos]           = useState(handoff?.dos ?? '');
  const [patient, setPatient]   = useState(handoff?.patient ?? '');
  const [memberId, setMemberId] = useState(handoff?.memberId ?? '');
  const [sentBy, setSentBy]     = useState(user.name ?? user.emp_id);
  const [notes, setNotes]       = useState('');
  const [sections, setSections] = useState(() => PACKET_SECTIONS.map(s => {
    const part = s.id === 'letter' ? handoff?.letter : s.id === 'form' ? handoff?.form : null;
    return { ...s, files: part ? [{ key: `h-${s.id}`, name: part.name, bytes: part.bytes, pageCount: part.pageCount }] : [] };
  }));
  const [busySection, setBusySection] = useState(null);
  const [problems, setProblems] = useState([]);
  const [cover, setCover]       = useState(true);
  const [numbers, setNumbers]   = useState(true);
  const [prefix, setPrefix]     = useState('');
  const [naming, setNaming]     = useState(DEFAULT_NAMING);
  const [customName, setCustomName] = useState(null);   // null = follow the convention
  const [showNaming, setShowNaming] = useState(false);
  const nextId = useRef(1);

  useEffect(() => {
    kv.get(NAMING_KEY).then(v => { if (typeof v === 'string' && v.trim()) setNaming(v); }).catch(() => {});
    S.get('clients').then(rows => setClients((rows ?? []).filter(c => c.active !== false)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')))).catch(() => {});
  }, []);

  // 5.5: the hand-over is used once, then wiped; a handed-over payer loads its contacts / forms like pickPayer
  useEffect(() => {
    clearPacketHandoff();
    if (!handoff?.payer) return;
    Promise.all([S.get('payer_contacts', { payer_id: handoff.payer.id }), S.get('payer_forms', { payer_id: handoff.payer.id })])
      .then(([c, f]) => {
        setContacts((c ?? []).filter(x => x.active !== false));
        setForms((f ?? []).filter(x => x.active !== false && !x.superseded_at && x.file_path));
      }).catch(() => {});
  }, [handoff]);

  async function pickPayer(p) {
    setPayer(p);
    const [c, f] = await Promise.all([S.get('payer_contacts', { payer_id: p.id }), S.get('payer_forms', { payer_id: p.id })]);
    setContacts((c ?? []).filter(x => x.active !== false));
    setForms((f ?? []).filter(x => x.active !== false && !x.superseded_at && x.file_path));
  }
  function clearPayer() { setPayer(null); setContacts([]); setForms([]); }

  const appeals = contacts.find(c => c.department === 'appeals') ?? contacts.find(c => c.department === 'claims') ?? null;
  const client = clients.find(c => String(c.id) === clientId) ?? null;

  // ── Files ──
  async function addFiles(sectionId, list) {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setBusySection(sectionId);
    const added = [];
    const bad = [];
    for (const file of picked) {
      try {
        const { bytes, pageCount } = await fileToPdf(file);
        added.push({ key: `f${nextId.current++}`, name: file.name, bytes, pageCount });
      } catch (err) { bad.push(problemText(file.name, err)); }
    }
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, files: [...s.files, ...added] } : s)));
    setProblems(bad);
    setBusySection(null);
  }

  async function addPayerForm(f) {
    setBusySection('form');
    try {
      const url = await payerFormLink(f.file_path, f.file_name);
      if (!url) throw new Error('damaged');
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], f.file_name || `${f.title}.pdf`, { type: 'application/pdf' });
      const { bytes, pageCount } = await fileToPdf(file);
      setSections(prev => prev.map(s => (s.id === 'form'
        ? { ...s, files: [...s.files, { key: `f${nextId.current++}`, name: `${f.title} (Payer Directory)`, bytes, pageCount }] }
        : s)));
      setProblems([]);
    } catch (err) {
      setProblems([problemText(f.title, err)]);
    }
    setBusySection(null);
  }

  const moveSection = (i, dir) => setSections(prev => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const moveFile = (sectionId, i, dir) => setSections(prev => prev.map(s => {
    if (s.id !== sectionId) return s;
    const j = i + dir;
    if (j < 0 || j >= s.files.length) return s;
    const files = [...s.files];
    [files[i], files[j]] = [files[j], files[i]];
    return { ...s, files };
  }));
  const removeFile = (sectionId, key) =>
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, files: s.files.filter(f => f.key !== key) } : s)));

  // ── Output ──
  const totalFiles = sections.reduce((n, s) => n + s.files.length, 0);
  const totalPages = sections.reduce((n, s) => n + s.files.reduce((a, f) => a + f.pageCount, 0), 0) + (cover && totalFiles ? 1 : 0);
  const autoName = applyNaming(naming, {
    claimNo, payer: payerShort(payer), client: client?.code || client?.name, type, dos,
    patientLast: patient.trim().split(/\s+/).pop() ?? '',
  });
  const fileName = (() => { const n = (customName ?? autoName).trim() || autoName; return /\.pdf$/i.test(n) ? n : `${n}.pdf`; })();
  const coverInfo = {
    type, payerName: payer?.name ?? '', fax: appeals?.fax ?? '', phone: appeals?.phone ?? '',
    address: [appeals?.attention_line, appeals?.mailing_address].filter(Boolean).join('\n'),
    claimNo, patient, memberId, dos, sentBy, notes,
  };
  const outputs = totalFiles
    ? [{
        name: fileName,
        build: () => assemblePacket(sections.map(s => ({ label: s.label, files: s.files })),
          { cover: cover ? coverInfo : null, pageNumbers: numbers, prefix }),
      }]
    : [];
  const resetKey = JSON.stringify([
    fileName, cover, numbers, prefix, coverInfo,
    sections.map(s => [s.id, s.files.map(f => f.key)]),
  ]);

  return (
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      {/* Details */}
      <Card title="Packet details">
        {handoff && (
          <Notice tone="info" style={{ marginBottom: 'var(--ui-s3)' }}>
            ✉️ Started from the Appeal Builder — the cover letter and payer form are in their sections. Add the EOB, auth approval and records below.
          </Notice>
        )}
        <div className="ui-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Field label="Packet type">
            <select value={type} onChange={e => setType(e.target.value)}>
              {PACKET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Payer">
              {payer
                ? (
                  <div className="ui-row" style={{ minHeight: 36 }}>
                    <strong>{payer.name}</strong>
                    <Button size="xs" onClick={clearPayer}>Change</Button>
                  </div>
                )
                : <PayerSearch onSelect={pickPayer} placeholder="Search payer (fills fax / address on the cover sheet)…" />}
            </Field>
          </div>
          <Field label="Client">
            <select value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">— Not set —</option>
              {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Claim #">
            <input type="text" value={claimNo} onChange={e => setClaimNo(e.target.value)} />
          </Field>
          <Field label="Date(s) of service">
            <input type="text" value={dos} onChange={e => setDos(e.target.value)} placeholder="e.g. 01/05/2026–01/31/2026" />
          </Field>
          <Field label="Patient name (cover sheet only)">
            <input type="text" value={patient} onChange={e => setPatient(e.target.value)} />
          </Field>
          <Field label="Member ID (cover sheet only)">
            <input type="text" value={memberId} onChange={e => setMemberId(e.target.value)} />
          </Field>
          <Field label="Sent by">
            <input type="text" value={sentBy} onChange={e => setSentBy(e.target.value)} />
          </Field>
          <Field label="Note on cover (optional)">
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Second-level appeal" />
          </Field>
        </div>
        <div className="ui-muted">
          🔒 These details are only used to build the PDF on this computer — they aren’t saved or sent anywhere.
        </div>
        {payer && (
          appeals
            ? <div className="ui-small" style={{ marginTop: 'var(--ui-s2)' }}>Cover sheet will use the payer’s <strong>{appeals.department === 'appeals' ? 'Appeals' : 'Claims'}</strong> contact{appeals.fax ? ` · fax ${appeals.fax}` : ''}.</div>
            : <Notice tone="warn" style={{ marginTop: 'var(--ui-s2)' }}>No Appeals or Claims contact is recorded for this payer — the cover sheet won’t have a fax or address.</Notice>
        )}
      </Card>

      {/* Sections */}
      <Card title="Documents, in packet order" subtitle="PDFs and images (JPG, PNG, TIFF fax…). Empty sections are skipped. Use ▲▼ to change the order.">
        {problems.length > 0 && (
          <Notice tone="bad" style={{ marginBottom: 'var(--ui-s3)' }}>
            {problems.map(p => <div key={p}>⚠ {p}</div>)}
          </Notice>
        )}
        <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
          {sections.map((s, i) => (
            <Item key={s.id}>
              <div className="ui-row" style={{ justifyContent: 'space-between' }}>
                <div className="ui-row" style={{ gap: 6 }}>
                  <Button size="xs" onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label={`Move ${s.label} up`}>▲</Button>
                  <Button size="xs" onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1} aria-label={`Move ${s.label} down`}>▼</Button>
                  <strong>{i + 1}. {s.label}</strong>
                  <span className="ui-muted">
                    {s.files.length ? `${s.files.reduce((a, f) => a + f.pageCount, 0)} page(s)` : 'empty'}
                  </span>
                </div>
                <label className="ui-btn secondary sm" style={{ cursor: busySection ? 'wait' : 'pointer' }}>
                  {busySection === s.id ? 'Adding…' : '+ Add files'}
                  <input type="file" accept={ACCEPT} multiple style={{ display: 'none' }} disabled={!!busySection}
                    onChange={e => { const l = e.target.files; addFiles(s.id, l); e.target.value = ''; }} />
                </label>
              </div>

              {s.id === 'form' && payer && forms.length > 0 && (
                <div className="ui-row" style={{ gap: 6 }}>
                  <span className="ui-muted">From the Payer Directory:</span>
                  {forms.map(f => {
                    const isPdf = /\.pdf$/i.test(f.file_name ?? '');
                    return (
                      <Button key={f.id} size="xs" disabled={!isPdf || !!busySection} onClick={() => addPayerForm(f)}
                        title={isPdf ? 'Add this form' : 'Word/Excel form — download it from the payer card, fill it in and save as PDF first'}>
                        + {f.title}{isPdf ? '' : ' (not PDF)'}
                      </Button>
                    );
                  })}
                </div>
              )}

              {s.files.length > 0 && (
                <div className="ui-stack" style={{ gap: 4 }}>
                  {s.files.map((f, fi) => (
                    <div key={f.key} className="ui-row ui-small" style={{ gap: 6 }}>
                      <span style={{ flex: 1, minWidth: 140, wordBreak: 'break-all' }}>📄 {f.name}</span>
                      <span className="ui-text-muted">{f.pageCount} p</span>
                      <Button size="xs" onClick={() => moveFile(s.id, fi, -1)} disabled={fi === 0} aria-label="Move file up">▲</Button>
                      <Button size="xs" onClick={() => moveFile(s.id, fi, 1)} disabled={fi === s.files.length - 1} aria-label="Move file down">▼</Button>
                      <Button size="xs" variant="danger" onClick={() => removeFile(s.id, f.key)}>Remove</Button>
                    </div>
                  ))}
                </div>
              )}
            </Item>
          ))}
        </div>
      </Card>

      {/* Options */}
      <Card>
        <Check checked={cover} onChange={e => setCover(e.target.checked)}>
          Add a cover sheet with payer fax/address and a contents list with page numbers
        </Check>
        <Check checked={numbers} onChange={e => setNumbers(e.target.checked)}>
          Number every page (“Page 7 of {Math.max(totalPages, 1)}”, bottom right) — prefix
        </Check>
        <div className="ui-row" style={{ marginLeft: 24, marginBottom: 'var(--ui-s3)' }}>
          <input type="text" className="ui-input" value={prefix} disabled={!numbers} onChange={e => setPrefix(e.target.value)} placeholder="optional, e.g. claim #" style={{ maxWidth: 200 }} aria-label="Page number prefix" />
          {claimNo && numbers && <Button size="xs" onClick={() => setPrefix(claimNo)}>Use claim #</Button>}
        </div>
        <Field label="File name" style={{ marginBottom: 'var(--ui-s2)' }}>
          <Toolbar>
            <input id="packet-name" type="text" className="ui-input" value={customName ?? autoName} onChange={e => setCustomName(e.target.value)} style={{ flex: '1 1 260px', width: 'auto', maxWidth: 420 }} />
            {customName !== null && <Button size="sm" variant="ghost" onClick={() => setCustomName(null)}>Use convention</Button>}
            {canEditNaming && <Button size="sm" onClick={() => setShowNaming(true)}>⚙ Naming convention</Button>}
          </Toolbar>
        </Field>
        <div className="ui-muted">Convention: <code>{naming}</code></div>
      </Card>

      {totalFiles > 0
        ? (
          <PdfSaveOptions
            outputs={outputs}
            resetKey={resetKey}
            user={user}
            auditAction="build_appeal_packet"
            auditDetails={{
              sections: sections.filter(s => s.files.length).length, files: totalFiles, pages: totalPages,
              cover_sheet: cover, page_numbers: numbers,
            }}
          />
        )
        : <EmptyState compact title="Add at least one document to build the packet." />}

      {showNaming && (
        <NamingSettings current={naming} user={user} onClose={() => setShowNaming(false)}
          onSaved={t => { setNaming(t); setShowNaming(false); }} />
      )}
    </div>
  );
}
