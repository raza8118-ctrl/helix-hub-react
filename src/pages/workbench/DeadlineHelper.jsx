import { useState, useEffect } from 'react';
import { loadPayerInfo } from '../../lib/denialSteps';
import {
  DATE_FIELDS, LIMIT_LABELS, MEDICARE_PRESETS, STATUS_STYLE, SOON_DAYS, fromKeyOf, limitName, computeDeadline,
  summaryLine, fmtDue, dateLabel,
} from '../../lib/deadlines';
import CopyButton from '../../components/shared/CopyButton';
import { Card, Button, Tabs, Field, Notice, Toolbar, EmptyState } from '../../components/ui';

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
    <Card id="deadline-helper">
      <button type="button" className="ui-disclose" onClick={onToggle} aria-expanded={open}>
        <span className="ui-disclose-arrow" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="ui-card-t">⏰ Deadline helper</span>
        <span className="ui-muted">appeal, reconsideration, corrected claim and timely filing due dates</span>
      </button>

      {open && (
        <div className="ui-stack" style={{ marginTop: 'var(--ui-s4)' }}>
          <div>
            <Tabs value={mode} onChange={setSource} label="Where the limits come from"
              options={[
                { value: 'payer', label: payer ? `${payer.name} limits` : 'Payer limits', disabled: !payer },
                { value: 'medicare', label: 'Medicare standard limits' },
                { value: 'manual', label: 'Enter days by hand' },
              ]} />
          </div>

          {source === 'payer' && !payer && (
            <Notice>Pick a payer under “Working on” to use its limits from the Payer Directory.</Notice>
          )}
          {source === 'payer' && payer && payerLimits === null && <EmptyState compact title="Loading the payer’s limits…" />}
          {source === 'payer' && payer && payerLimits && !hasPayerLimits && (
            <Notice tone="info">
              No limits are recorded for {payer.name} in the Payer Directory yet — enter the days below, or use Medicare standard limits.
            </Notice>
          )}
          {mode === 'medicare' && (
            <Notice tone="warn">⚠ Medicare standard limits — check current CMS rules before relying on them.</Notice>
          )}

          {mode === 'manual' && (
            <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
              {manual.map((m, i) => (
                <Toolbar key={i}>
                  <select value={m.limit_type} onChange={e => setManualRow(i, { limit_type: e.target.value })} aria-label="Limit">
                    {Object.entries(LIMIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input type="number" min={1} max={20} value={m.level} placeholder="Level" title="Appeal level (optional)"
                    onChange={e => setManualRow(i, { level: e.target.value })} style={{ width: 80 }} aria-label="Level" />
                  <input type="number" min={1} max={2000} value={m.days} placeholder="Days" onChange={e => setManualRow(i, { days: e.target.value })} style={{ width: 90 }} aria-label="Days" />
                  <span className="ui-small">days from</span>
                  <select value={m.fromKey} onChange={e => setManualRow(i, { fromKey: e.target.value })} aria-label="Counted from">
                    {DATE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label.toLowerCase()}</option>)}
                  </select>
                  {manual.length > 1 && <Button size="xs" variant="ghost" aria-label="Remove this limit" onClick={() => setManual(list => list.filter((_, j) => j !== i))}>✕</Button>}
                </Toolbar>
              ))}
              <div><Button size="sm" onClick={() => setManual(list => [...list, blankManual()])}>+ Add a limit</Button></div>
            </div>
          )}

          {needed.length > 0 && (
            <div className="ui-grid2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
              {needed.map(f => (
                <div key={f.key} title={f.hint}>
                  <Field label={f.label} style={{ marginBottom: 0 }}>
                    <input type="date" value={dates[f.key]} onChange={e => setDates(d => ({ ...d, [f.key]: e.target.value }))} />
                  </Field>
                </div>
              ))}
            </div>
          )}

          {results.map(({ rule, result }) => (
            <div key={rule.id} className="ui-result" style={{ borderLeftColor: result ? STATUS_STYLE[result.status].color : undefined }}>
              <div className="ui-row">
                <b>{rule.name}</b>
                <span className="ui-muted">{rule.source}</span>
              </div>
              {rule.missingDays && <div className="ui-muted">No number of days recorded for this limit — check the payer card.</div>}
              {!rule.missingDays && !result && <div className="ui-muted">Enter the {dateLabel(rule.fromKey)} above.</div>}
              {result && (
                <div className="ui-small" style={{ marginTop: 2 }}>
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
                  {rule.assumed && <div className="ui-text-muted">No start date recorded for this limit — counted from the denial date.</div>}
                  {rule.note && <div className="ui-text-muted">{rule.note}</div>}
                </div>
              )}
            </div>
          ))}

          {summary && (
            <div className="ui-row">
              <CopyButton value={summary} label="📋 Copy summary" title="Copy for claim notes" />
              <span className="ui-muted">For claim notes — contains dates and limits only.</span>
            </div>
          )}
          <div className="ui-muted">
            Calendar days. 🟠 = {SOON_DAYS} days or fewer. Some payers count from the date the notice was received — check the
            payer card notes. 🔒 Dates typed here are not saved.
          </div>
        </div>
      )}
    </Card>
  );
}
