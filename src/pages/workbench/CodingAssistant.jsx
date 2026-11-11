import { useState, useEffect, useRef } from 'react';
import { findIdentifiers, suggestCodes, cleanCode, MAX_TEXT } from '../../lib/codingAssistant';
import { checkCodes } from '../../lib/codingRules';
import { icdDot } from '../../lib/icd10';
import { logAudit } from '../../lib/audit';
import CopyButton from '../../components/shared/CopyButton';

/**
 * 🧠 Coding Assistant – Phase A (PO 2026-11-11). Diagnosis statements in → AI suggests ICD-10-CM codes (text only, after a
 * browser check for patient identifiers) → rules check them against the Master Library (valid / needs more digits / not
 * valid / Excludes1 conflict / sequencing) → the coder edits the ordered list and copies it. The pasted text lives only in
 * this page's memory: never saved, never sent anywhere except the checked text to the AI, never logged.
 */
const BADGE = {
  valid: ['badge-green', 'Valid'], more_digits: ['badge-yellow', 'Needs more digits'], invalid: ['badge-red', 'Not valid'],
};

export default function CodingAssistant({ user }) {
  const [text, setText] = useState('');
  const [ack, setAck] = useState(false);
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [items, setItems] = useState(null);      // [{ code, role, reason, phrase, source }] in the coder's order
  const [checked, setChecked] = useState(null);  // { rows, moved }
  const [ai, setAi] = useState([]);              // the AI's codes (for the save in Stage 2)
  const [addCode, setAddCode] = useState('');
  const run = useRef(0);

  // forget everything when signing out / switching company
  useEffect(() => {
    const wipe = () => { setText(''); setItems(null); setChecked(null); setAi([]); };
    window.addEventListener('helix:signed-out', wipe);
    return () => window.removeEventListener('helix:signed-out', wipe);
  }, []);

  // rules re-run whenever the list changes
  useEffect(() => {
    if (!items) return undefined;
    const n = ++run.current;
    const t = setTimeout(async () => {
      const r = await checkCodes(items);
      if (n === run.current) setChecked(r);
    }, 200);
    return () => clearTimeout(t);
  }, [items]);

  async function suggest() {
    setErr('');
    const f = findIdentifiers(text);
    setFound(f);
    if (f.length) return;
    if (!ack) { setErr('Tick “No patient identifiers in this text” first.'); return; }
    setBusy('Asking the AI for codes…'); setItems(null); setChecked(null);
    try {
      const codes = await suggestCodes(text, user);
      if (!codes.length) { setErr('The AI found no codes in these statements — code them by hand below.'); setItems([]); setAi([]); }
      else { setAi(codes.map(c => c.code)); setItems(codes.map(c => ({ ...c, source: 'ai' }))); }
    } catch (e) { setErr(e.message); }
    setBusy('');
  }

  const rows = checked?.rows ?? [];
  const setOrder = list => setItems(list.map((r, i) => ({ code: r.code, role: i === 0 ? 'primary' : 'secondary', reason: r.reason, phrase: r.phrase, source: r.source })));
  const replace = (code, next) => setItems(items.map(i => (i.code === code ? { ...i, code: cleanCode(next), source: i.source === 'ai' ? 'ai_edited' : i.source } : i)));
  const remove = code => setOrder(rows.filter(r => r.code !== code));
  const move = (code, d) => {
    const list = [...rows];
    const i = list.findIndex(r => r.code === code);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
  };
  function add() {
    const c = cleanCode(addCode);
    if (!c || (items ?? []).some(i => i.code === c)) { setAddCode(''); return; }
    setItems([...(items ?? []), { code: c, role: (items ?? []).length ? 'secondary' : 'primary', reason: '', phrase: '', source: 'coder' }]);
    setAddCode('');
  }
  const final = rows.map(r => icdDot(r.code)).join(', ');
  const counts = rows.reduce((t, r) => { t[r.status] = (t[r.status] ?? 0) + 1; if (r.conflicts.length) t.conflict++; return t; }, { conflict: 0 });
  function clearAll() {
    if (rows.length) logAudit({ actor: user, action: 'coding_assistant_done', entityType: 'coding_assistant',
      details: { ai_codes: ai.length, final_codes: rows.length, kept: rows.filter(r => ai.includes(r.code)).length } });
    setText(''); setAck(false); setFound([]); setItems(null); setChecked(null); setAi([]); setErr('');
  }

  return (
    <div className="ca-page">
      <div className="ca-banner" role="alert">
        🔒 <strong>Diagnosis statements only.</strong> Do not paste names, DOB, MBI / member ID, MRN or addresses.
        The text is checked here first, never saved, and only the diagnosis wording is sent to the AI.
      </div>

      <div className="card mb-16">
        <label className="ocd-field" style={{ marginBottom: 6 }}>
          <span className="bold">Diagnosis statements</span>
          <textarea rows={6} value={text} maxLength={MAX_TEXT} onChange={e => { setText(e.target.value); setFound([]); }}
            placeholder={'e.g.\nAcute on chronic systolic CHF. Hypertensive heart and chronic kidney disease, CKD stage 3b.\nType 2 diabetes with hyperglycemia, on insulin. Aftercare for left hip fracture.'}
            aria-label="Diagnosis statements" autoComplete="off" spellCheck={false} />
        </label>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="omp-check" style={{ padding: 0 }}>
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            <span className="text-sm">No patient identifiers in this text</span>
          </label>
          <span className="text-sm text-muted">{text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()}</span>
          <span style={{ marginLeft: 'auto' }} className="row">
            <button type="button" className="btn-sm" onClick={clearAll} disabled={!!busy}>Clear</button>
            <button type="button" className="btn-primary" onClick={suggest} disabled={!!busy || !text.trim()}>{busy ? 'Working…' : '✨ Suggest codes'}</button>
          </span>
        </div>
        {found.length > 0 && (
          <div className="ca-found" role="alert">
            <strong>Not sent — remove these first:</strong>
            <ul>{found.map((f, i) => <li key={i}>{f.what}: <mark>{f.match}</mark></li>)}</ul>
          </div>
        )}
        {busy && <div className="loading-row"><div className="spinner" /> {busy}</div>}
        {err && <p className="ot-err" role="alert">{err}</p>}
      </div>

      {items && (
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <strong>Codes in order</strong>
            {checked && <span className="text-sm text-muted">{counts.valid ?? 0} valid · {counts.more_digits ?? 0} need more digits · {counts.invalid ?? 0} not valid · {counts.conflict} conflict{counts.conflict === 1 ? '' : 's'}</span>}
            {checked?.moved && <span className="badge badge-blue" title="Code first / Use additional code rules changed the order">Order adjusted</span>}
            <span style={{ marginLeft: 'auto' }} className="row">
              {final && <CopyButton value={final} label="Copy codes" />}
            </span>
          </div>
          {!checked && <div className="loading-row"><div className="spinner" /> Checking the codes…</div>}
          {checked && rows.length === 0 && <p className="text-sm text-muted">No codes yet — add one below.</p>}
          {rows.map((r, i) => (
            <div key={r.code} className={`ca-row ca-${r.status}${r.conflicts.length ? ' ca-conflict' : ''}`}>
              <div className="ca-row-h">
                <span className="ca-n">{i + 1}</span>
                <input className="ca-code" defaultValue={icdDot(r.code)} key={r.code} aria-label={`Code ${i + 1}`}
                  onBlur={e => { if (cleanCode(e.target.value) !== r.code) replace(r.code, e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                <span className={`badge ${BADGE[r.status][0]}`}>{r.needs7th ? 'Needs 7th character' : BADGE[r.status][1]}</span>
                {r.conflicts.length > 0 && <span className="badge badge-red">Conflict</span>}
                {r.seq.length > 0 && <span className="badge badge-blue">Sequencing note</span>}
                {i === 0 && <span className="badge badge-purple">Primary</span>}
                {r.source === 'coder' && <span className="text-sm text-muted">added by you</span>}
                <span className="ca-tools">
                  <button type="button" className="btn-sm" onClick={() => move(r.code, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button type="button" className="btn-sm" onClick={() => move(r.code, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
                  <button type="button" className="btn-sm" onClick={() => remove(r.code)} aria-label="Remove">✕</button>
                </span>
              </div>
              {r.desc && <div className="ca-desc">{r.desc}</div>}
              {r.why && <div className="text-sm">{r.why}</div>}
              {r.phrase && <div className="text-sm text-muted">From: “{r.phrase}”{r.reason ? ` — ${r.reason}` : ''}</div>}
              {r.seventh.length > 0 && (
                <div className="text-sm">7th character: {r.seventh.map(s => <span key={s.char} className="ca-7"><b>{s.char}</b> {s.meaning}</span>)}</div>
              )}
              {r.children.length > 0 && (
                <div className="ca-kids">
                  {r.children.slice(0, 30).map(k => (
                    <button key={k.code} type="button" className="icd-kid" onClick={() => replace(r.code, k.code)} title="Use this code">
                      <b>{icdDot(k.code)}</b> {k.long_description || k.description}{k.billable === false ? ' (needs more digits)' : ''}
                    </button>
                  ))}
                </div>
              )}
              {r.conflicts.map(c => (
                <div key={c.with} className="text-sm ca-bad">Excludes1 with {icdDot(c.with)} — these can’t be coded together (note on {icdDot(c.from)}: {c.note}).</div>
              ))}
              {r.seq.map((s, j) => <div key={j} className="text-sm ca-seq">{s.replace(/\b([A-TV-Z]\d[0-9A-Z]{1,5})\b/g, m => icdDot(m))}</div>)}
              {r.hints.slice(0, 2).map((h, j) => <div key={j} className="text-sm text-muted">{h}</div>)}
            </div>
          ))}
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input type="text" value={addCode} onChange={e => setAddCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="Add a code, e.g. Z79.4" aria-label="Add a code" style={{ maxWidth: 200 }} />
            <button type="button" className="btn-sm" onClick={add} disabled={!addCode.trim()}>+ Add</button>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: 0 }}>
            Suggestions only — the coder decides. Check each code against the record and the Official Guidelines (SOP Library → Coding).
          </p>
        </div>
      )}
    </div>
  );
}
