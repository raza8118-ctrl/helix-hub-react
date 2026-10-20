import { useState, useEffect } from 'react';
import { loadPayerInfo } from '../../lib/denialSteps';
import {
  DATE_FIELDS, LIMIT_LABELS, MEDICARE_PRESETS, STATUS_STYLE, SOON_DAYS, fromKeyOf, limitName, computeDeadline,
  summaryLine, fmtDue, dateLabel,
} from '../../lib/deadlines';
import CopyButton from '../../components/shared/CopyButton';

const blankManual = () => ({ limit_type: 'AFL', level: '', days: '', fromKey: 'denial' });

/**
 * ⏰ Deadline helper (roadmap 4.4): appeal / reconsideration / corrected-claim / timely filing due dates from the
 * Working-on payer's limits (client contract limits replace the standard ones), Medicare standard limits, or days
 * typed by hand. Dates typed here are only used on screen — never saved, logged or sent anywhere.
 */
export default function DeadlineHelper({ payer, client, open, onToggle }) {
  const [info, setInfo] = useState({ key: null, limits: null });
  const [source, setSource] = useState('payer');          // 'payer' | 'medicare' | 'manual'
  const [dates, setDates] = useState({ denial: '', dos: '', discharge: '', paid: '' });
  const [manual, setManual] = useState(() => [blankManual()]);

  const key = payer ? `${payer.id}|${client?.id ?? ''}` : null;
  useEffect(() => {
    let alive = true;
    if (open && payer) loadPayerInfo(payer.id, client?.id ?? null).then(d => { if (alive) setInfo({ key, limits: d.limits }); });
    return () => { alive = false; };
  }, [open, payer, client?.id, key]);
  const payerLimits = info.key === key ? info.limits : null;
  const hasPayerLimits = !!payerLimits?.length;
  const mode = source === 'payer' && payer && payerLimits && !hasPayerLimits ? 'manual' : source;

  // Rules on screen, whatever the source
  let rules = [];
  if (mode === 'payer' && hasPayerLimits) {
    rules = payerLimits.map(l => {
      const from = fromKeyOf(l.measured_from);
      return {
        id: `p${l.id}`, name: limitName(l), days: l.days, fromKey: from.key, assumed: from.assumed, receiptDays: 0,
        source: l.isOverride ? `${client?.name} contract` : `${payer.name} standard`, note: l.notes, missingDays: l.days == null,
      };
    });
  } else if (mode === 'medicare') {
    rules = MEDICARE_PRESETS.map(p => ({ ...p, source: 'Medicare standard — check current CMS rules' }));
  } else if (mode === 'manual') {
    rules = manual.filter(m => Number(m.days) > 0).map((m, i) => ({
      id: `m${i}`, name: limitName({ limit_type: m.limit_type, level: Number(m.level) || null }),
      days: Number(m.days), fromKey: m.fromKey, receiptDays: 0, source: 'entered by hand',
    }));
  }
  const needed = DATE_FIELDS.filter(f => rules.some(r => r.fromKey === f.key) || (mode === 'manual' && f.key === 'denial'));
  const results = rules.map(r => ({ rule: r, result: r.missingDays ? null : computeDeadline(r, dates) }));
  const summary = results.filter(x => x.result).map(x => summaryLine(x.rule.name, x.rule, x.result, x.rule.source)).join('\n');
  const setManualRow = (i, patch) => setManual(list => list.map((m, j) => j === i ? { ...m, ...patch } : m));

  return (
    <div className="card mb-16" id="deadline-helper">
      <div className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }} onClick={onToggle} role="button" aria-expanded={open}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="card-title">⏰ Deadline helper</span>
        <span className="text-sm text-muted">appeal, reconsideration, corrected claim and timely filing due dates</span>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {[['payer', payer ? `${payer.name} limits` : 'Payer limits'], ['medicare', 'Medicare standard limits'], ['manual', 'Enter days by hand']].map(([id, label]) => (
              <button key={id} type="button" className={mode === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={mode === id}
                disabled={id === 'payer' && !payer} onClick={() => setSource(id)}>{label}</button>
            ))}
          </div>

          {source === 'payer' && !payer && (
            <div className="text-sm text-muted" style={{ marginBottom: 8 }}>Pick a payer under “Working on” to use its limits from the Payer Directory.</div>
          )}
          {source === 'payer' && payer && payerLimits === null && <div className="text-sm text-muted">Loading the payer’s limits…</div>}
          {source === 'payer' && payer && payerLimits && !hasPayerLimits && (
            <div className="text-sm" style={{ marginBottom: 8 }}>
              No limits are recorded for {payer.name} in the Payer Directory yet — enter the days below, or use Medicare standard limits.
            </div>
          )}
          {mode === 'medicare' && (
            <div className="text-sm" style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)' }}>
              ⚠ Medicare standard limits — check current CMS rules before relying on them.
            </div>
          )}

          {mode === 'manual' && (
            <div style={{ marginBottom: 8 }}>
              {manual.map((m, i) => (
                <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                  <select value={m.limit_type} onChange={e => setManualRow(i, { limit_type: e.target.value })} style={{ maxWidth: 170 }}>
                    {Object.entries(LIMIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input type="number" min={1} max={20} value={m.level} placeholder="Level" title="Appeal level (optional)"
                    onChange={e => setManualRow(i, { level: e.target.value })} style={{ width: 70 }} />
                  <input type="number" min={1} max={2000} value={m.days} placeholder="Days" onChange={e => setManualRow(i, { days: e.target.value })} style={{ width: 80 }} />
                  <span className="text-sm">days from</span>
                  <select value={m.fromKey} onChange={e => setManualRow(i, { fromKey: e.target.value })} style={{ maxWidth: 180 }}>
                    {DATE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label.toLowerCase()}</option>)}
                  </select>
                  {manual.length > 1 && <button type="button" className="btn-sm" onClick={() => setManual(list => list.filter((_, j) => j !== i))}>✕</button>}
                </div>
              ))}
              <button type="button" className="btn-sm" onClick={() => setManual(list => [...list, blankManual()])}>+ Add a limit</button>
            </div>
          )}

          {needed.length > 0 && (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              {needed.map(f => (
                <label key={f.key} className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={f.hint}>
                  {f.label}
                  <input type="date" value={dates[f.key]} onChange={e => setDates(d => ({ ...d, [f.key]: e.target.value }))} />
                </label>
              ))}
            </div>
          )}

          {results.map(({ rule, result }) => (
            <div key={rule.id} style={{
              padding: '6px 10px', marginTop: 6, borderRadius: 6, background: 'var(--surface-2)',
              borderLeft: `4px solid ${result ? STATUS_STYLE[result.status].color : 'var(--border)'}`,
            }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <b>{rule.name}</b>
                <span className="text-sm text-muted">{rule.source}</span>
              </div>
              {rule.missingDays && <div className="text-sm text-muted">No number of days recorded for this limit — check the payer card.</div>}
              {!rule.missingDays && !result && <div className="text-sm text-muted">Enter the {dateLabel(rule.fromKey)} above.</div>}
              {result && (
                <div className="text-sm" style={{ marginTop: 2 }}>
                  {STATUS_STYLE[result.status].icon} <b>Due {fmtDue(result.due)}</b>
                  {' · '}{rule.years ? `${rule.years} year` : `${rule.days} days`} from the {dateLabel(rule.fromKey)}
                  {rule.receiptDays ? ` (+${rule.receiptDays} days for receipt)` : ''}
                  {' · '}
                  <b style={{ color: STATUS_STYLE[result.status].color }}>
                    {result.daysLeft < 0 ? `${-result.daysLeft} days past due` : result.daysLeft === 0 ? 'due today' : `${result.daysLeft} days left`}
                  </b>
                  {result.weekend && (
                    <div>⚠ Falls on a {result.weekend} — send by {fmtDue(result.sendBy)} to be safe.</div>
                  )}
                  {rule.assumed && <div className="text-muted">No start date recorded for this limit — counted from the denial date.</div>}
                  {rule.note && <div className="text-muted">{rule.note}</div>}
                </div>
              )}
            </div>
          ))}

          {summary && (
            <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <CopyButton value={summary} label="📋 Copy summary" title="Copy for claim notes" />
              <span className="text-sm text-muted">For claim notes — contains dates and limits only.</span>
            </div>
          )}
          <div className="text-sm text-muted" style={{ marginTop: 8 }}>
            Calendar days. 🟠 = {SOON_DAYS} days or fewer. Some payers count from the date the notice was received — check the
            payer card notes. 🔒 Dates typed here are not saved.
          </div>
        </div>
      )}
    </div>
  );
}
