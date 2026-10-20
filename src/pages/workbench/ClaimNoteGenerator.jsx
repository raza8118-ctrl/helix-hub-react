import { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/supabase';
import {
  ACTIONS, STATUSES, STATUS_FIELDS, NEXT_STEPS, STARTER_FORMATS, statusOf, suggestFollowUp, emptyNote, noteValues,
  buildNote, pickFormat,
} from '../../lib/claimNotes';
import { parseCodeLine, findCode } from '../../lib/denials';
import PayerSearch from '../../components/shared/PayerSearch';
import CopyButton from '../../components/shared/CopyButton';

/**
 * 📝 Claim Note Generator (roadmap 6.1): dropdowns → a claim note in the client's own format.
 * Notes are built here in the browser and never saved or logged; the last 5 can be copied again while AR Tools is open.
 */
export default function ClaimNoteGenerator({ user, ctx, formats, codes }) {
  const [note, setNote] = useState(emptyNote);
  const [phones, setPhones] = useState({ payerId: null, list: [] });
  const [recent, setRecent] = useState([]);       // [{ text, at }] — memory only
  const [copied, setCopied] = useState(false);

  const client = ctx.clients.find(c => String(c.id) === String(note.client_id)) ?? null;
  const payer = ctx.payers.find(p => String(p.id) === String(note.payer_id)) ?? null;
  const set = patch => setNote(n => ({ ...n, ...patch }));

  // The payer's claims phone numbers from the Payer Directory
  const payerId = payer?.id ?? null;
  useEffect(() => {
    let alive = true;
    if (payerId != null) {
      db('payer_contacts').select('department,phone,phone_ext,active').eq('payer_id', payerId).then(({ data }) => {
        if (!alive) return;
        const list = (data ?? []).filter(c => c.active !== false && c.phone)
          .sort((a, b) => (b.department === 'claims') - (a.department === 'claims'));
        setPhones({ payerId, list });
      });
    }
    return () => { alive = false; };
  }, [payerId]);
  const payerPhones = phones.payerId === payerId ? phones.list : [];

  // Denial reason from the Denial library (first sentence of the first known code)
  const denialReason = useMemo(() => {
    const parsed = parseCodeLine(note.denial_codes) ?? [];
    const row = parsed.map(p => findCode(codes ?? [], p)).find(r => r?.plain_reason);
    return row ? row.plain_reason.split('. ')[0].replace(/\.$/, '') : '';
  }, [note.denial_codes, codes]);

  // Format: the client's best match, or the built-in standard when none is set up yet
  const saved = pickFormat(formats, { action: note.action, clientId: note.client_id });
  const builtIn = STARTER_FORMATS.find(f => f.action === note.action);
  const format = saved ?? { ...builtIn, date_style: 'mdy2', name_style: 'initials', upper_case: false, max_length: null, builtIn: true };
  const values = noteValues(note, { user, clientName: client?.name, payerName: payer?.name, denialReason, format });
  const text = buildNote(format.body, values, { upperCase: format.upper_case });
  const max = format.max_length ?? 0;
  const tooLong = max && text.length > max;

  function changeStatus(status) {
    set({ status, ...(note.followTouched ? {} : { follow_up: suggestFollowUp(status) }) });
  }
  async function copyNote() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      setRecent(r => [{ text, at: Date.now() }, ...r.filter(x => x.text !== text)].slice(0, 5));
    } catch { /* clipboard blocked */ }
  }
  function newNote() {
    setNote(n => ({ ...emptyNote(), client_id: n.client_id, payer_id: n.payer_id }));
  }

  const st = statusOf(note.status);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label>Client</label>
            <select value={note.client_id} onChange={e => set({ client_id: e.target.value })}>
              <option value="">— Choose —</option>
              {ctx.clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 220px', minWidth: 0 }}>
            <label>Payer</label>
            {payer
              ? <div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="badge badge-blue">{payer.name}</span>
                  <button className="btn-sm" title="Change payer" onClick={() => set({ payer_id: '', phone: '' })}>✕</button></div>
              : <PayerSearch payers={ctx.payers} onSelect={p => set({ payer_id: String(p.id), phone: '' })} />}
          </div>
        </div>

        <div className="field">
          <label>What I did</label>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {ACTIONS.map(a => (
              <button key={a.value} type="button" className={note.action === a.value ? 'btn-primary btn-sm' : 'btn-sm'}
                aria-pressed={note.action === a.value} onClick={() => set({ action: a.value })}>{a.icon} {a.label}</button>
            ))}
          </div>
        </div>

        {note.action === 'call' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label>Phone called</label>
              <input type="text" list="note-phones" value={note.phone} onChange={e => set({ phone: e.target.value })} placeholder="Pick or type" />
              <datalist id="note-phones">
                {payerPhones.map((p, i) => <option key={i} value={`${p.phone}${p.phone_ext ? ` x${p.phone_ext}` : ''}`}>{p.department}</option>)}
              </datalist>
              {payerPhones[0] && (
                <div className="text-sm text-muted" style={{ marginTop: 2 }}>
                  {payerPhones[0].department}: {payerPhones[0].phone} <CopyButton value={payerPhones[0].phone} />
                </div>
              )}
            </div>
            <div className="field" style={{ flex: '1 1 140px' }}><label>Rep name</label>
              <input type="text" value={note.rep} onChange={e => set({ rep: e.target.value })} />
            </div>
            <div className="field" style={{ flex: '1 1 140px' }}><label>Call reference #</label>
              <input type="text" value={note.ref} onChange={e => set({ ref: e.target.value })} />
            </div>
          </div>
        )}

        <div className="field">
          <label>Claim status</label>
          <select value={note.status} onChange={e => changeStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {st.fields.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {st.fields.map(k => {
              const f = STATUS_FIELDS[k];
              return (
                <div key={k} className="field" style={{ flex: '1 1 160px' }}>
                  <label>{f.label}</label>
                  <input type={f.type} value={note[k]} placeholder={f.placeholder} onChange={e => set({ [k]: e.target.value })} />
                  {k === 'denial_codes' && denialReason && <div className="text-sm text-muted" style={{ marginTop: 2 }}>{denialReason}</div>}
                </div>
              );
            })}
          </div>
        )}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Next step</label>
            <select value={note.next_step} onChange={e => set({ next_step: e.target.value })}>
              <option value="">— None —</option>
              {NEXT_STEPS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label>Follow-up date{!note.followTouched && st.followDays ? ' (suggested)' : ''}</label>
            <input type="date" value={note.follow_up} onChange={e => set({ follow_up: e.target.value, followTouched: true })} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Extra note</label>
          <input type="text" value={note.extra} onChange={e => set({ extra: e.target.value })} placeholder="Anything else (no patient names, DOB or IDs)" />
        </div>
      </div>

      <div>
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <span className="card-title">Note</span>
            <span className="text-sm text-muted">{format.builtIn ? 'Built-in standard format' : `Format: ${format.name}`}</span>
          </div>
          <div style={{
            padding: 10, borderRadius: 6, border: `1px solid ${tooLong ? 'var(--danger)' : 'var(--border)'}`,
            background: 'var(--surface-2)', fontFamily: 'monospace', fontSize: 13, overflowWrap: 'anywhere', minHeight: 60,
          }}>
            {text || <span className="text-muted">Pick what you did to build the note.</span>}
          </div>
          <div className="text-sm" style={{ marginTop: 4, color: tooLong ? 'var(--danger)' : 'var(--text-muted)' }}>
            {text.length}{max ? ` / ${max}` : ''} characters{tooLong ? ' — too long for this client’s system; shorten the extra note' : ''}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={copyNote} disabled={!text}>{copied ? '✓ Copied' : '📋 Copy note'}</button>
            <button className="btn-sm" onClick={newNote}>↺ New note</button>
          </div>
          <div className="text-sm text-muted" style={{ marginTop: 6 }}>🔒 Built on this computer only — not saved or logged.</div>
        </div>

        {recent.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 6 }}>Recent notes (this visit only)</div>
            {recent.map(r => (
              <div key={r.at} className="row" style={{ gap: 6, alignItems: 'flex-start', padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                <span className="text-sm" style={{ flex: 1, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{r.text}</span>
                <CopyButton value={r.text} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
