// Pick-list values for the Payer Directory — shared by the payer card and the Excel importer.

const opts = list => list.map(v => (typeof v === 'string' ? { value: v, label: v } : v));

export const LINES_OF_BUSINESS = opts(['Medicare Advantage', 'Medicaid MCO', 'Commercial HMO', 'Commercial PPO', 'Commercial EPO/POS', 'Marketplace / Exchange', 'Medicare Supplement', 'Other']);
export const BLUECARD          = opts([{ value: 'home', label: 'BlueCard home plan' }, { value: 'host', label: 'BlueCard host plan' }]);
export const CLEARINGHOUSES    = ['Waystar', 'Availity', 'Change Healthcare', 'Office Ally', 'TriZetto', 'Claim.MD'];
export const TRANSACTIONS      = opts(['Claims (837)', 'ERA (835)', 'Eligibility (270/271)', 'Claim status (276/277)', 'Other']);
export const DEPARTMENTS       = opts([
  { value: 'claims', label: 'Claims' }, { value: 'auth', label: 'Authorization' }, { value: 'appeals', label: 'Appeals' },
  { value: 'provider_relations', label: 'Provider Relations' }, { value: 'eligibility', label: 'Eligibility' }, { value: 'other', label: 'Other' },
]);
export const LIMIT_TYPES       = opts([
  { value: 'TFL', label: 'Timely filing (TFL)' }, { value: 'CCTFL', label: 'Corrected claim (CCTFL)' },
  { value: 'AFL', label: 'Appeal (AFL)' }, { value: 'RECON', label: 'Reconsideration' },
]);
export const MEASURED_FROM     = opts(['Date of service', 'Discharge date', 'Denial / EOB date', 'Paid date', 'Other']);
export const NOTE_CATEGORIES   = opts(['General', 'Claims', 'Auth', 'Appeals', 'Portal', 'Other']);
// Authorization rules (9.2)
export const AUTH_SERVICES     = opts([
  { value: 'hh_soc', label: 'Home health – start of care' }, { value: 'hh_recert', label: 'Home health – recert / extension' },
  { value: 'skilled_nursing', label: 'Skilled nursing visits' }, { value: 'therapy', label: 'Therapy (PT / OT / ST)' },
  { value: 'hospice', label: 'Hospice' }, { value: 'dme', label: 'DME' }, { value: 'other', label: 'Other' },
]);
export const AUTH_REQUIRED     = opts([
  { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'after_visits', label: 'After N visits' },
  { value: 'notify', label: 'Notification only' },
]);
export const AUTH_METHODS      = opts([
  { value: 'portal', label: 'Portal' }, { value: 'fax', label: 'Fax' }, { value: 'phone', label: 'Phone' },
  { value: 'edi_278', label: '278 / clearinghouse' },
]);

export const labelOf = (list, v) => list.find(o => o.value === v)?.label ?? v;
export const orderOf = (list, v) => { const i = list.findIndex(o => o.value === v); return i < 0 ? list.length : i; };

const norm = s => (s ?? '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Typed text → a list value, accepting the value or its label in any case
 * ("Auth", "authorization", "TFL", "Timely filing"). '' when empty, null when unknown.
 */
export function matchOption(list, input) {
  const n = norm(input);
  if (!n) return '';
  const hit = list.find(o => norm(o.value) === n || norm(o.label) === n)
    ?? list.find(o => norm(o.label).startsWith(n));
  return hit ? hit.value : null;
}
