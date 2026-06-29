'use strict';

/**
 * Unit tests for public/plan.js — the APPROVED outpatient plan is the single
 * source of truth for a patient's treatment types + per-type weekly frequency,
 * and this app is READ-ONLY on it. A plan can hold SEVERAL treatment types, each
 * with its own frequency and (potentially) its own therapist — so the projection
 * is a LIST of {treatmentType, frequencyPerWeek}, NOT one summed row. These guard:
 *   - forPhone: match / no-match / ambiguous multi-match / single + multi-type /
 *     scalar+serviceType fallback / zero-types / !plansOk → null
 *   - typesFromSessions: blob (single + multi-type, per-type counts) / scalar / empty
 *   - blockMessage: the no-approved-plan block (both flows) vs cannot-verify vs none
 *   - assignmentPayload: type+freq are FORCED from ONE plan-type entry, never input
 *   - a 2-type plan yields 2 independently-assignable rows (different therapists)
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

// --- forPhone: the per-type projection --------------------------------------

test('forPhone: a single-type plan → one entry { treatmentType, frequencyPerWeek }', () => {
  const r = Plan.forPhone({ phone: '0501234567', plans: [planClient()], plansOk: true });
  assert.deepEqual(r, [{ treatmentType: 'פרטני', frequencyPerWeek: 1 }]);
});

test('forPhone: a MULTI-type plan → one entry per type with its own count (not summed)', () => {
  const plans = [planClient({ serviceType: 'מרכז יום', sessions: '{"מרכז יום":3,"טיפול משפחתי":1}' })];
  const r = Plan.forPhone({ phone: '0501234567', plans, plansOk: true });
  assert.equal(r.length, 2);
  assert.deepEqual(r, [
    { treatmentType: 'מרכז יום', frequencyPerWeek: 3 },
    { treatmentType: 'טיפול משפחתי', frequencyPerWeek: 1 }
  ]);
});

test('forPhone: matches tolerantly across phone formatting (dashes / +972)', () => {
  const plans = [planClient({ phone: '052-365-9865', serviceType: 'משפחתי', sessions: '{"משפחתי":2}' })];
  assert.deepEqual(Plan.forPhone({ phone: '0523659865', plans, plansOk: true }), [{ treatmentType: 'משפחתי', frequencyPerWeek: 2 }]);
  assert.deepEqual(Plan.forPhone({ phone: '+972 52-365-9865', plans, plansOk: true }), [{ treatmentType: 'משפחתי', frequencyPerWeek: 2 }]);
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

test('forPhone: scalar sessions + a serviceType → single entry for that type', () => {
  const plans = [planClient({ serviceType: 'פרטני', sessions: '2' })];
  assert.deepEqual(Plan.forPhone({ phone: '0501234567', plans, plansOk: true }), [{ treatmentType: 'פרטני', frequencyPerWeek: 2 }]);
});

test('forPhone: a plan that yields ZERO types → null (treated as no plan)', () => {
  assert.equal(Plan.forPhone({ phone: '0501234567', plans: [planClient({ sessions: '' })], plansOk: true }), null);
  assert.equal(Plan.forPhone({ phone: '0501234567', plans: [planClient({ sessions: '2', serviceType: '' })], plansOk: true }), null);
});

test('forPhone: !plansOk (plans endpoint down) → null even if a row would match', () => {
  assert.equal(Plan.forPhone({ phone: '0501234567', plans: [planClient()], plansOk: false }), null);
});

test('forPhone: blank phone or empty plans → null', () => {
  assert.equal(Plan.forPhone({ phone: '', plans: [planClient()], plansOk: true }), null);
  assert.equal(Plan.forPhone({ phone: '0501234567', plans: [], plansOk: true }), null);
});

// --- typesFromSessions ------------------------------------------------------

test('typesFromSessions: single-type blob → one entry', () => {
  assert.deepEqual(Plan.typesFromSessions('{"פרטני":1}'), [{ treatmentType: 'פרטני', frequencyPerWeek: 1 }]);
});

test('typesFromSessions: multi-type blob → N entries (the KEYS are the types)', () => {
  assert.deepEqual(Plan.typesFromSessions('{"מרכז יום":3,"טיפול משפחתי":1}'), [
    { treatmentType: 'מרכז יום', frequencyPerWeek: 3 },
    { treatmentType: 'טיפול משפחתי', frequencyPerWeek: 1 }
  ]);
  assert.deepEqual(Plan.typesFromSessions({ a: 2, b: 1 }), [
    { treatmentType: 'a', frequencyPerWeek: 2 },
    { treatmentType: 'b', frequencyPerWeek: 1 }
  ]);
});

test('typesFromSessions: scalar + serviceType → single entry; scalar without serviceType → []', () => {
  assert.deepEqual(Plan.typesFromSessions('3', 'פרטני'), [{ treatmentType: 'פרטני', frequencyPerWeek: 3 }]);
  assert.deepEqual(Plan.typesFromSessions(3, 'משפחתי'), [{ treatmentType: 'משפחתי', frequencyPerWeek: 3 }]);
  assert.deepEqual(Plan.typesFromSessions('3', ''), []);
});

test('typesFromSessions: empty / null / garbage → []', () => {
  assert.deepEqual(Plan.typesFromSessions(''), []);
  assert.deepEqual(Plan.typesFromSessions(null), []);
  assert.deepEqual(Plan.typesFromSessions('not-a-number'), []);
  assert.deepEqual(Plan.typesFromSessions('{bad json'), []);
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

test('blockMessage: a present (non-empty) plan → null (no block)', () => {
  assert.equal(Plan.blockMessage([{ treatmentType: 'פרטני', frequencyPerWeek: 1 }], true), null);
});

// --- assignmentPayload: type + freq FORCED from ONE plan-type entry ----------

test('assignmentPayload: treatmentType + frequencyPerWeek come from the entry only', () => {
  const row = Plan.assignmentPayload({
    entry: { treatmentType: 'מרכז יום', frequencyPerWeek: 3 },
    id: 'a1', patientPhone: '0501234567', therapist: 'דנה',
    slots: '[{"weekday":1,"time":"10:00","location":"rehab"}]', updatedBy: 'דנה'
  });
  assert.equal(row.treatmentType, 'מרכז יום');
  assert.equal(row.frequencyPerWeek, '3');
  assert.equal(row.therapist, 'דנה');
  assert.equal(row.patientPhone, '0501234567');
});

test('assignmentPayload: takes NO type/freq input — a stray field cannot leak in', () => {
  const row = Plan.assignmentPayload({
    entry: { treatmentType: 'פרטני', frequencyPerWeek: 1 },
    id: 'a1', patientPhone: '0501234567', therapist: 'רון',
    treatmentType: 'קבוצה', frequencyPerWeek: '7'    // ignored — not read by the function
  });
  assert.equal(row.treatmentType, 'פרטני');
  assert.equal(row.frequencyPerWeek, '1');
});

test('assignmentPayload: a zero-frequency entry yields an empty frequencyPerWeek', () => {
  const row = Plan.assignmentPayload({ entry: { treatmentType: 'פרטני', frequencyPerWeek: 0 }, id: 'a1', therapist: 'רון' });
  assert.equal(row.frequencyPerWeek, '');
});

// --- a 2-type plan → 2 independently-assignable rows ------------------------

test('a 2-type plan produces 2 assignable rows with independent therapists + per-type freq', () => {
  // Mirrors what the שיבוץ modal does: forPhone → per-type entries; each type is
  // matched to its own assignment (by treatmentType) and saved via assignmentPayload.
  const plans = [planClient({ serviceType: 'מרכז יום', sessions: '{"מרכז יום":3,"טיפול משפחתי":1}' })];
  const types = Plan.forPhone({ phone: '0501234567', plans, plansOk: true });
  assert.equal(types.length, 2);

  // Two existing assignments, one per type, each held by a DIFFERENT therapist.
  const existing = [
    { id: 'a1', treatmentType: 'מרכז יום', therapist: 'דנה' },
    { id: 'a2', treatmentType: 'טיפול משפחתי', therapist: 'רון' }
  ];
  const payloads = types.map((t) => {
    const match = existing.filter((a) => a.treatmentType === t.treatmentType)[0] || {};
    return Plan.assignmentPayload({
      entry: t, id: match.id, patientPhone: '0501234567', therapist: match.therapist
    });
  });

  assert.deepEqual(payloads.map((p) => p.treatmentType), ['מרכז יום', 'טיפול משפחתי']);
  assert.deepEqual(payloads.map((p) => p.frequencyPerWeek), ['3', '1']);
  assert.deepEqual(payloads.map((p) => p.therapist), ['דנה', 'רון']);   // independent per type
  assert.deepEqual(payloads.map((p) => p.id), ['a1', 'a2']);
});

// --- Yarden's assignment save contract (therapist-only; slots preserved) -----
// Yarden's שיבוץ modal no longer edits weekly slots — it assigns the therapist
// per type and passes through any slots the therapist already set. assignmentPayload
// must (a) force type+freq from the plan entry, (b) carry slots through verbatim.

test('assignmentPayload forces type/freq from the plan entry, not from input', () => {
  const p = Plan.assignmentPayload({
    entry: { treatmentType: 'מעקב פסיכיאטרי', frequencyPerWeek: 2 },
    id: 'a1', patientPhone: '0501234567', therapist: 'ירדן', updatedBy: 'עורך'
  });
  assert.equal(p.treatmentType, 'מעקב פסיכיאטרי');
  assert.equal(p.frequencyPerWeek, '2');
  assert.equal(p.therapist, 'ירדן');
});

test('assignmentPayload preserves existing slots passed through (not wiped)', () => {
  const slots = '[{"weekday":"1","time":"10:00","location":"מרכז"},{"weekday":"3","time":"10:00","location":"מרכז"}]';
  const p = Plan.assignmentPayload({
    entry: { treatmentType: 'פרטני', frequencyPerWeek: 2 },
    id: 'a2', patientPhone: '0501234567', therapist: 'ירדן', slots: slots, updatedBy: 'עורך'
  });
  assert.equal(p.slots, slots, 'slots carried through unchanged');
});

test('assignmentPayload tolerates no slots (Yarden assigns before scheduling)', () => {
  const p = Plan.assignmentPayload({
    entry: { treatmentType: 'פרטני', frequencyPerWeek: 1 },
    id: 'a3', patientPhone: '0501234567', therapist: 'ירדן', updatedBy: 'עורך'
  });
  assert.equal(p.slots, '');
});
