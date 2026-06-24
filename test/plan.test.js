'use strict';

/**
 * Unit tests for public/plan.js — the APPROVED outpatient plan is the single
 * source of truth for a patient's treatment type + weekly frequency, and this
 * app is READ-ONLY on it. These guard:
 *   - forPhone: match / no-match / ambiguous multi-match / JSON-blob multi-type / !plansOk
 *   - freqFromSessions: blob (single + multi-type SUM) / scalar / empty
 *   - blockMessage: the no-approved-plan block (both flows) vs cannot-verify vs none
 *   - assignmentPayload: type+freq are FORCED from the plan, never from user input
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Plan = require('../public/plan');

function planClient(over) {
  return Object.assign({
    sourceApp: 'ezone-outpatient', clientId: 'c1', name: 'אורי',
    phone: '0501234567', serviceType: 'פרטני', sessions: '{"פרטני":1}', status: 'פעיל'
  }, over || {});
}

// --- forPhone: the projection -----------------------------------------------

test('forPhone: a single matching plan projects { serviceType, frequency }', () => {
  const r = Plan.forPhone({ phone: '0501234567', plans: [planClient()], plansOk: true });
  assert.deepEqual(r, { serviceType: 'פרטני', frequency: 1 });
});

test('forPhone: matches tolerantly across phone formatting (dashes / +972)', () => {
  const plans = [planClient({ phone: '052-365-9865', serviceType: 'משפחתי', sessions: '{"משפחתי":2}' })];
  const r = Plan.forPhone({ phone: '0523659865', plans, plansOk: true });
  assert.deepEqual(r, { serviceType: 'משפחתי', frequency: 2 });
  const r2 = Plan.forPhone({ phone: '+972 52-365-9865', plans, plansOk: true });
  assert.deepEqual(r2, { serviceType: 'משפחתי', frequency: 2 });
});

test('forPhone: NO match → null (caller must block, never fail open)', () => {
  assert.equal(Plan.forPhone({ phone: '0500000000', plans: [planClient()], plansOk: true }), null);
});

test('forPhone: ambiguous multi-match (2+ plan rows, same phone) → null', () => {
  const plans = [
    planClient({ clientId: 'c1' }),
    planClient({ clientId: 'c2', serviceType: 'משפחתי', sessions: '{"משפחתי":2}' })
  ];
  assert.equal(Plan.forPhone({ phone: '0501234567', plans, plansOk: true }), null);
});

test('forPhone: JSON-blob multi-type → frequency is the SUM across types (not collapsed)', () => {
  const plans = [planClient({ serviceType: 'מרכז יום', sessions: '{"מרכז יום":3,"טיפול משפחתי":1}' })];
  const r = Plan.forPhone({ phone: '0501234567', plans, plansOk: true });
  assert.equal(r.serviceType, 'מרכז יום');
  assert.equal(r.frequency, 4, 'multi-type weekly sessions are summed: 3 + 1');
});

test('forPhone: !plansOk (plans endpoint down) → null even if a row would match', () => {
  assert.equal(Plan.forPhone({ phone: '0501234567', plans: [planClient()], plansOk: false }), null);
});

test('forPhone: blank phone or empty plans → null', () => {
  assert.equal(Plan.forPhone({ phone: '', plans: [planClient()], plansOk: true }), null);
  assert.equal(Plan.forPhone({ phone: '0501234567', plans: [], plansOk: true }), null);
});

// --- freqFromSessions -------------------------------------------------------

test('freqFromSessions: single-type blob → its count', () => {
  assert.equal(Plan.freqFromSessions('{"פרטני":1}'), 1);
  assert.equal(Plan.freqFromSessions('{"מרכז יום":3}'), 3);
});

test('freqFromSessions: multi-type blob → sum of counts', () => {
  assert.equal(Plan.freqFromSessions('{"מרכז יום":3,"טיפול משפחתי":1}'), 4);
  assert.equal(Plan.freqFromSessions({ a: 2, b: 2, c: 1 }), 5);   // object form
});

test('freqFromSessions: scalar (string or number) → that number', () => {
  assert.equal(Plan.freqFromSessions('2'), 2);
  assert.equal(Plan.freqFromSessions(3), 3);
});

test('freqFromSessions: empty / null / garbage → 0', () => {
  assert.equal(Plan.freqFromSessions(''), 0);
  assert.equal(Plan.freqFromSessions(null), 0);
  assert.equal(Plan.freqFromSessions('not-a-number'), 0);
  assert.equal(Plan.freqFromSessions('{bad json'), 0);
});

// --- blockMessage: the no-approved-plan block in BOTH flows -----------------

test('blockMessage: null plan + plansOk → "no approved plan, Vered must define one"', () => {
  assert.equal(Plan.blockMessage(null, true), Plan.MSG_NO_PLAN);
  assert.match(Plan.MSG_NO_PLAN, /אין תוכנית טיפול מאושרת/);
});

test('blockMessage: null plan + !plansOk → "cannot verify, try later"', () => {
  assert.equal(Plan.blockMessage(null, false), Plan.MSG_CANNOT_VERIFY);
  assert.match(Plan.MSG_CANNOT_VERIFY, /לא ניתן לאמת/);
});

test('blockMessage: a present plan → null (no block)', () => {
  assert.equal(Plan.blockMessage({ serviceType: 'פרטני', frequency: 1 }, true), null);
});

// --- assignmentPayload: type + freq FORCED from the plan --------------------

test('assignmentPayload: treatmentType + frequencyPerWeek come from the plan only', () => {
  const plan = { serviceType: 'מרכז יום', frequency: 4 };
  const row = Plan.assignmentPayload({
    plan, id: 'a1', patientPhone: '0501234567', therapist: 'דנה',
    slots: '[{"weekday":1,"time":"10:00","location":"rehab"}]', updatedBy: 'דנה'
  });
  assert.equal(row.treatmentType, 'מרכז יום');
  assert.equal(row.frequencyPerWeek, '4');
  assert.equal(row.therapist, 'דנה');
  assert.equal(row.patientPhone, '0501234567');
});

test('assignmentPayload: takes NO type/freq input — a stray field cannot leak in', () => {
  const plan = { serviceType: 'פרטני', frequency: 1 };
  // Even if a caller passes treatmentType/frequencyPerWeek, the function ignores
  // them (its signature only reads `plan`): the saved row stays plan-sourced.
  const row = Plan.assignmentPayload({
    plan, id: 'a1', patientPhone: '0501234567', therapist: 'רון',
    treatmentType: 'קבוצה', frequencyPerWeek: '7'
  });
  assert.equal(row.treatmentType, 'פרטני');
  assert.equal(row.frequencyPerWeek, '1');
});

test('assignmentPayload: a zero-frequency plan yields an empty frequencyPerWeek', () => {
  const row = Plan.assignmentPayload({ plan: { serviceType: 'פרטני', frequency: 0 }, id: 'a1', therapist: 'רון' });
  assert.equal(row.frequencyPerWeek, '');
});
