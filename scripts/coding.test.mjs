// Coding Assistant tests (PO 2026-11-11) — run with `npm test` (Node's built-in test runner, no extra packages).
// ONLY MADE-UP TEXT. The rules fixtures are small hand-made samples in the shape of the Master Library's ICD-10-CM data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findIdentifiers } from '../src/lib/phiCheck.js';
import { evaluateCodes, noteRefs, refMatches, seventhChoices } from '../src/lib/codingRulesCore.js';

const kinds = t => findIdentifiers(t).map(f => f.kind);

test('identifiers are blocked (made-up examples)', () => {
  assert.ok(kinds('MBI 1EG4-TE5-MK73 on file').includes('mbi'));
  assert.ok(kinds('DOB 03/14/1938').includes('dob'));
  assert.ok(kinds('DOB 03/14/1938').includes('date'));
  assert.ok(kinds('admitted Jan 5, 2026').includes('date'));
  assert.ok(kinds('seen 2026-01-05').includes('date'));
  assert.ok(kinds('call (214) 555-0182').includes('phone'));
  assert.ok(kinds('call 214-555-0182').includes('phone'));
  assert.ok(kinds('Patient: John Test, CHF').includes('label'));
  assert.ok(kinds('Name: J Test').includes('label'));
  assert.ok(kinds('Mrs. Garcia has CHF').includes('title'));
  assert.ok(kinds('Mr. Lee has COPD').includes('title'));
  assert.ok(kinds('MRN 4471932').includes('idword'));
  assert.ok(kinds('acct 88231194').includes('number'));
  assert.ok(kinds('lives at 1204 Oak Ridge Dr').includes('address'));
  assert.ok(kinds('Dallas TX 75201').includes('address'));
  assert.ok(kinds('93 y/o with dementia').includes('age'));
  assert.ok(kinds('mail j.test@example.com').includes('email'));
  assert.ok(kinds('SSN 123-45-6789').includes('ssn'));
  assert.ok(kinds('member id ABC123').includes('idword'));
});

test('clinical wording and codes are NOT blocked', () => {
  for (const t of [
    'Acute on chronic systolic CHF. Hypertensive heart and CKD stage 3b. Type 2 DM with hyperglycemia, on insulin.',
    'MS exacerbation with weakness', 'Stage 2 pressure ulcer of sacrum', 'BP 140/90, HR 88, A1c 9.2, EF 35%',
    'hx of CVA 2019 with left hemiparesis', 'S72.001A aftercare, Z47.89, I11.0, Z79.4, O2 2 L', '3 days of cough, 2 wounds',
    'Dr visit last week for COPD', 'Code first underlying disease',
  ]) assert.deepEqual(findIdentifiers(t), [], t);
});

test('note references and 7th characters are read', () => {
  assert.deepEqual(noteRefs('cardiac arrest (I46.-); (O00-O07, O08.8) E87.70'),
    [{ from: 'I46', to: null }, { from: 'O00', to: 'O07' }, { from: 'O088', to: null }, { from: 'E8770', to: null }]);
  assert.equal(refMatches({ from: 'O00', to: 'O07' }, 'O039'), true);
  assert.equal(refMatches({ from: 'O00', to: 'O07' }, 'O091'), false);
  assert.equal(refMatches({ from: 'I46', to: null }, 'I469'), true);
  assert.deepEqual(seventhChoices('A = initial encounter; D = subsequent encounter').map(s => s.char), ['A', 'D']);
});

// Small fixtures (shape of the Master Library data)
const byCode = new Map([
  ['I509', { code: 'I509', long_description: 'Heart failure, unspecified', billable: true }],
  ['I110', { code: 'I110', long_description: 'Hypertensive heart disease with heart failure', billable: true }],
  ['E1165', { code: 'E1165', long_description: 'Type 2 diabetes mellitus with hyperglycemia', billable: true }],
  ['E109', { code: 'E109', long_description: 'Type 1 diabetes mellitus without complications', billable: true }],
  ['S72001', { code: 'S72001', long_description: 'Fracture of unspecified part of neck of right femur', billable: false }],
  ['I50', { code: 'I50', long_description: 'Heart failure', billable: false }],
  ['S23420', { code: 'S23420', long_description: 'Sprain of sternoclavicular joint', billable: true, retired: true, retired_on: '2026-10-01' }],
]);
const notes = [
  { code: 'I50', note_type: 'Code first', note: 'heart failure due to hypertension (I11.0)' },
  { code: 'I11', note_type: 'Use additional code', note: 'to identify type of heart failure (I50.-)' },
  { code: 'E11', note_type: 'Excludes1', note: 'type 1 diabetes mellitus (E10.-)' },
  { code: 'S72', note_type: '7th characters', note: 'A = initial encounter for closed fracture; D = subsequent encounter for closed fracture with routine healing' },
];
const children = new Map([
  ['S72001', [{ code: 'S72001A', billable: true }, { code: 'S72001D', billable: true }]],
  ['I50', [{ code: 'I501', billable: true }, { code: 'I509', billable: true }]],
]);
const run = codes => evaluateCodes(codes.map(code => ({ code })), { byCode, notes, children });

test('Code first / Use additional code put I11.0 before I50.9, with ONE note', () => {
  const r = run(['I50.9', 'I11.0']);
  assert.equal(r.moved, true);
  assert.deepEqual(r.rows.map(x => x.code), ['I110', 'I509']);
  assert.equal(r.rows[1].seq.length, 1);
  assert.match(r.rows[1].seq[0], /Goes after I11\.0 — Code first \/ Use additional code/);
  assert.deepEqual(r.rows[1].hints, []);
});

test('Excludes1 conflict is flagged on both codes', () => {
  const r = run(['E11.65', 'E10.9']);
  assert.deepEqual(r.rows.map(x => x.conflicts.map(c => c.with)), [['E109'], ['E1165']]);
});

test('7th character, header, retired and unknown codes', () => {
  const [hip] = run(['S72.001']).rows;
  assert.equal(hip.status, 'more_digits');
  assert.equal(hip.needs7th, true);
  assert.deepEqual(hip.seventh.map(s => s.char), ['A', 'D']);
  assert.deepEqual(hip.children.map(k => k.code), ['S72001A', 'S72001D']);
  const [head] = run(['I50']).rows;
  assert.equal(head.status, 'more_digits');
  assert.equal(head.needs7th, false);
  assert.equal(run(['S23.420']).rows[0].status, 'invalid');
  assert.equal(run(['ZZ99']).rows[0].status, 'invalid');
  assert.equal(run(['I50.9']).rows[0].status, 'valid');
});

test('the coder order is kept when no rule applies', () => {
  assert.deepEqual(run(['E10.9', 'I50.9']).rows.map(x => x.code), ['E109', 'I509']);
});
