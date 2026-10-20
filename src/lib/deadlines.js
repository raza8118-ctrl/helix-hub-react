// Deadline helper (roadmap 4.4; reusable by the 6.2 calculators): appeal / reconsideration / corrected-claim /
// timely filing due dates from a payer's limits. Calendar days. Dates typed in are only used on screen —
// never saved, logged or sent anywhere.
import { addDays, isWknd, today } from './helpers';

export const SOON_DAYS = 14;

// Dates a limit can count from (values match payer_limits.measured_from labels)
export const DATE_FIELDS = [
  { key: 'denial',    label: 'Denial / EOB date',   from: 'Denial / EOB date' },
  { key: 'dos',       label: 'Date of service',     from: 'Date of service', hint: 'For institutional claims use the “through” date' },
  { key: 'discharge', label: 'Discharge date',      from: 'Discharge date' },
  { key: 'paid',      label: 'Paid date',           from: 'Paid date' },
];

/** Which date field a limit counts from; unknown / "Other" → the denial date (flagged as assumed). */
export function fromKeyOf(measuredFrom) {
  const f = DATE_FIELDS.find(d => d.from.toLowerCase() === String(measuredFrom ?? '').toLowerCase());
  return f ? { key: f.key, assumed: false } : { key: 'denial', assumed: true };
}
export const dateLabel = key => DATE_FIELDS.find(d => d.key === key)?.label.toLowerCase() ?? key;

export const LIMIT_LABELS = { AFL: 'Appeal', RECON: 'Reconsideration', CCTFL: 'Corrected claim', TFL: 'Timely filing' };
export const limitName = l => `${LIMIT_LABELS[l.limit_type] ?? l.limit_type}${l.level ? ` – level ${l.level}` : ''}`;

// Medicare quick-fill — clearly labelled; teams should check current CMS rules
export const MEDICARE_PRESETS = [
  { id: 'redet', limit_type: 'AFL', level: 1, name: 'Redetermination (Medicare appeal level 1)', days: 120, fromKey: 'denial', receiptDays: 5,
    note: '120 days from receipt of the initial determination (receipt assumed 5 days after the notice date)' },
  { id: 'recon', limit_type: 'RECON', level: 2, name: 'Reconsideration by the QIC (Medicare appeal level 2)', days: 180, fromKey: 'denial', receiptDays: 5,
    note: '180 days from receipt of the redetermination decision — enter the redetermination decision date as the denial date' },
  { id: 'tfl', limit_type: 'TFL', level: null, name: 'Timely filing', years: 1, fromKey: 'dos', receiptDays: 0,
    note: '1 calendar year from the date of service (“through” date for institutional claims)' },
];

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const parse = d => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); };
const ymd = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const fmtDue = d => d ? parse(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
export const fmtUS = d => { if (!d) return ''; const [y, m, day] = d.split('-'); return `${m}/${day}/${y}`; };

/**
 * One deadline. rule = { days | years, fromKey, receiptDays }. dates = { denial, dos, discharge, paid } (yyyy-mm-dd).
 * Returns null when the start date is missing, else { start, due, daysLeft, status, weekend, sendBy }.
 */
export function computeDeadline(rule, dates) {
  const start = dates[rule.fromKey];
  if (!start) return null;
  const base = rule.receiptDays ? addDays(start, rule.receiptDays) : start;
  let due;
  if (rule.years) {
    const dt = parse(base);
    const target = new Date(dt.getFullYear() + rule.years, dt.getMonth(), dt.getDate());
    if (target.getMonth() !== dt.getMonth()) target.setDate(0);   // Feb 29 → Feb 28
    due = ymd(target);
  } else {
    due = addDays(base, Number(rule.days) || 0);
  }
  const daysLeft = daysBetween(today(), due);
  const weekend = isWknd(due) ? WEEKDAY[parse(due).getDay()] : null;
  let sendBy = null;
  if (weekend) { sendBy = due; while (isWknd(sendBy)) sendBy = addDays(sendBy, -1); }
  return {
    start, due, daysLeft, weekend, sendBy,
    status: daysLeft < 0 ? 'late' : daysLeft <= SOON_DAYS ? 'soon' : 'ok',
  };
}

export const STATUS_STYLE = {
  ok:   { icon: '🟢', color: 'var(--success)' },
  soon: { icon: '🟠', color: 'var(--warning)' },
  late: { icon: '🔴', color: 'var(--danger)' },
};

/** One line for claim notes, e.g. "Appeal L1 due 01/18/2027 (90 days from denial date 10/20/2026, Aetna standard)". */
export function summaryLine(name, rule, result, source) {
  const length = rule.years ? `${rule.years} year${rule.years > 1 ? 's' : ''}` : `${rule.days} days`;
  const receipt = rule.receiptDays ? ` + ${rule.receiptDays} days for receipt` : '';
  return `${name} due ${fmtUS(result.due)} (${length} from ${dateLabel(rule.fromKey)} ${fmtUS(result.start)}${receipt}, ${source})`;
}
