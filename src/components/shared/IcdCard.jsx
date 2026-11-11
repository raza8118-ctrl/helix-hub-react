import { useState, useEffect } from 'react';
import CopyButton from './CopyButton';
import { icdDot, icdNotes, icdChildren } from '../../lib/icd10';

/**
 * One ICD-10-CM code (PO 2026-11-11): long description, chapter / section, Billable badge or an amber "header" warning
 * with its child codes, New / Revised / Retired badges, and the coding notes of the code and its parents grouped by type
 * (category notes — e.g. 7th characters on S72 — apply to every code below). onPick(code) searches another code.
 */
export default function IcdCard({ row, fy, open: openAtStart = false, onPick, extra }) {
  const [open, setOpen] = useState(openAtStart);
  const [notes, setNotes] = useState(undefined);       // undefined = not loaded · null = not available
  const [children, setChildren] = useState(undefined);
  const header = row.billable === false;

  useEffect(() => {
    let alive = true;
    if (open && notes === undefined) icdNotes(row.code).then(n => alive && setNotes(n));
    if (open && header && children === undefined) icdChildren(row.code).then(c => alive && setChildren(c));
    return () => { alive = false; };
  }, [open, header, row.code, notes, children]);

  const isNew = row.change_flag === 'new' && (!fy || row.fiscal_year === fy);
  const revised = row.change_flag === 'revised' && (!fy || row.fiscal_year === fy);
  const pick = c => onPick?.(icdDot(c));

  return (
    <div className="card mb-16 icd-card">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="badge badge-blue" title="ICD-10-CM diagnosis code">ICD-10</span>
        <span className="bold" style={{ fontSize: 18 }}>{icdDot(row.code)}</span>
        <CopyButton value={icdDot(row.code)} />
        {row.retired
          ? <span className="badge badge-orange" title={row.retired_on ? `Not valid for dates of service from ${row.retired_on}` : undefined}>Retired{row.retired_on ? ` ${row.retired_on}` : ''}</span>
          : header ? <span className="badge badge-yellow">Header</span> : <span className="badge badge-green">Billable</span>}
        {isNew && <span className="badge badge-purple" title={row.valid_from ? `Valid from ${row.valid_from}` : undefined}>New FY{row.fiscal_year}</span>}
        {revised && <span className="badge badge-blue">Revised FY{row.fiscal_year}</span>}
        {extra}
      </div>
      <div style={{ marginTop: 4, fontSize: 15 }}>{row.long_description || row.description}</div>
      {row.long_description && row.description && row.description !== row.long_description && (
        <div className="text-sm text-muted">Short: {row.description}</div>
      )}
      {(row.chapter || row.section) && (
        <div className="text-sm text-muted" style={{ marginTop: 2 }}>{[row.chapter, row.section].filter(Boolean).join(' · ')}</div>
      )}

      {header && !row.retired && (
        <div className="icd-warn" role="note">
          <strong>Header – not billable, pick a more specific code.</strong>
          {children === undefined && (open
            ? <div className="text-sm text-muted">Loading the codes below it…</div>
            : <div><button type="button" className="btn-sm" onClick={() => setOpen(true)}>Show the codes below it</button></div>)}
          {children?.length > 0 && (
            <div className="icd-kids">
              {children.map(k => (
                <button key={k.code} type="button" className="icd-kid" onClick={() => pick(k.code)} title={k.long_description || k.description}>
                  <b>{icdDot(k.code)}</b> {k.long_description || k.description}{k.billable === false ? ' (header)' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button type="button" className="btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? 'Hide details' : header ? 'Codes below it + coding notes' : 'Coding notes'}
      </button>
      {open && (
        <div className="icd-notes">
          {notes === undefined && <div className="text-sm text-muted">Loading notes…</div>}
          {notes === null && <div className="text-sm text-muted">Coding notes aren’t available yet.</div>}
          {notes?.length === 0 && <div className="text-sm text-muted">No coding notes for this code or its category.</div>}
          {notes?.map(g => (
            <div key={g.type} className="icd-note-group">
              <div className="icd-note-type">{g.type}</div>
              <ul>
                {g.notes.map((n, i) => (
                  <li key={i}>{n.note}{n.inherited && <button type="button" className="icd-from" onClick={() => pick(n.from)} title="This note comes from a parent code and applies to every code below it">from {icdDot(n.from)}</button>}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
