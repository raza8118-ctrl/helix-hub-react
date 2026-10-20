// AR calculators (roadmap 6.2): home health NOA / PDGM periods / LUPA, hospice NOE / benefit periods, expected payment.
// Pure date and money maths in the browser — nothing is saved or logged. Medicare rules change: every result is shown
// with "check current CMS rules" and the rule that was used.
import { addDays, isWknd } from './helpers';
import { daysBetween } from './deadlines';

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = d => { const [y, m, day] = d.split('-').map(Number); return WEEKDAY[new Date(y, m - 1, day).getDay()]; };

/** The next weekday on or after a date. */
export function nextBusinessDay(date) {
  let d = date;
  while (isWknd(d)) d = addDays(d, 1);
  return d;
}

/** Due date rule shared by the NOA and the NOE: 5 calendar days after the start date. */
function fiveDayDue(start) {
  const due = addDays(start, 5);
  return { due, weekend: isWknd(due) ? weekdayOf(due) : null, nextBusiness: isWknd(due) ? nextBusinessDay(due) : null };
}

// ── Home health ────────────────────────────────────────────────────────────

/**
 * NOA: due within 5 calendar days after the period's From date. When submitted late, the payment is reduced by 1/30 of
 * the 30-day period payment for each day from the From date until the NOA was submitted (never more than the payment).
 */
export function noaResult(fromDate, submitted = '', periodPayment = '') {
  if (!fromDate) return null;
  const r = fiveDayDue(fromDate);
  if (!submitted) return r;
  const late = submitted > r.due;
  const lateDays = late ? daysBetween(fromDate, submitted) : 0;
  const pay = parseFloat(String(periodPayment).replace(/[$,]/g, ''));
  const reduction = late && pay > 0 ? Math.min(pay, Math.round((pay / 30) * lateDays * 100) / 100) : null;
  return { ...r, submitted, late, daysAfterDue: late ? daysBetween(r.due, submitted) : 0, lateDays, reduction };
}

/**
 * PDGM: 30-day payment periods inside 60-day certification periods, counted from the start of care.
 * Returns [{ n, start, end, timing, cert, certStart, certEnd, recertFrom, recertTo }].
 */
export function pdgmPeriods(soc, count = 6) {
  if (!soc) return [];
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(soc, 30 * i);
    const cert = Math.floor(i / 2) + 1;
    const certStart = addDays(soc, 60 * (cert - 1));
    const certEnd = addDays(certStart, 59);
    return {
      n: i + 1, start, end: addDays(start, 29), timing: i === 0 ? 'Early' : 'Late',
      cert, certStart, certEnd, recertFrom: addDays(certEnd, -4), recertTo: certEnd,
    };
  });
}

/** LUPA: fewer visits than the case-mix group's threshold → paid per visit. */
export function lupaResult(threshold, visits) {
  const t = parseInt(threshold, 10), v = parseInt(visits, 10);
  if (!(t > 0) || !(v >= 0)) return null;
  return { lupa: v < t, needed: Math.max(0, t - v), threshold: t, visits: v };
}

// ── Hospice ────────────────────────────────────────────────────────────────

/**
 * NOE: must be filed and accepted within 5 calendar days after the election date. When late, the days from the
 * election date up to the day before the NOE was accepted are not covered (provider liability).
 */
export function noeResult(election, accepted = '') {
  if (!election) return null;
  const r = fiveDayDue(election);
  if (!accepted) return r;
  const late = accepted > r.due;
  const nonCovered = late ? daysBetween(election, accepted) : 0;
  return { ...r, accepted, late, nonCovered, nonCoveredFrom: election, nonCoveredTo: late ? addDays(accepted, -1) : null };
}

/** Benefit periods 90 / 90 / then 60 days; face-to-face needed from the 3rd period (within 30 days before it starts). */
export function hospicePeriods(election, count = 6) {
  if (!election) return [];
  const out = [];
  let start = election;
  for (let i = 0; i < count; i++) {
    const length = i < 2 ? 90 : 60;
    const end = addDays(start, length - 1);
    out.push({ n: i + 1, start, end, length, f2f: i >= 2, f2fFrom: i >= 2 ? addDays(start, -30) : null });
    start = addDays(end, 1);
  }
  return out;
}

// ── Expected payment ───────────────────────────────────────────────────────

const num = v => { const n = parseFloat(String(v ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const cents = n => Math.round(n * 100) / 100;
export const usd = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Expected payment. Patient share = deductible + copay + coinsurance % of what's left; sequestration applies to the
 * payer's payment after deductible and coinsurance. Returns null until an allowed amount is entered.
 */
export function paymentResult({ billed, allowed, deductible, coinsurancePct, copay, seqPct, paid }) {
  const a = num(allowed);
  if (!(a > 0)) return null;
  const ded = Math.min(num(deductible), a);
  const cop = Math.min(num(copay), a - ded);
  const remaining = Math.max(0, a - ded - cop);
  const coins = cents(remaining * num(coinsurancePct) / 100);
  const payer = cents(remaining - coins);
  const seq = cents(payer * num(seqPct) / 100);
  const net = cents(payer - seq);
  const out = {
    contractual: num(billed) ? cents(num(billed) - a) : null,
    patient: cents(ded + cop + coins), deductible: ded, copay: cop, coinsurance: coins,
    payer, seq, net,
  };
  if (String(paid ?? '').trim()) out.difference = cents(num(paid) - net);
  return out;
}
