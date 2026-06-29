'use strict';

/**
 * Unit tests for public/roster.js — the cross-app patient-roster build that
 * feeds the dashboard cards. The focus is the PHONE CARRY: every source must
 * pass its phone through into the built item's `phone` (the exact field
 * patientCard renders), for the getTreatmentPlans projection shape and the
 * other sources. Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Roster = require('../public/roster');

// The documented getTreatmentPlans client projection (docs/outpatient-
// getTreatmentPlans.patch.md): phone present, canonical leading-zero string.
function planClient(over) {
  return Object.assign({
    sourceApp: 'ezone-outpatient', clientId: 'c1', name: 'אורי',
    phone: '0501234567', serviceType: 'פרטני', sessions: '{"פרטני":1}', status: 'פעיל'
  }, over || {});
}

function byKey(roster, key) { return roster.filter(function (p) { return p.key === key; })[0]; }

// --- the bug under test: plans phone must reach the card field --------------

test('plans source: the projection phone carries through to item.phone', () => {
  const roster = Roster.build({ plans: [planClient()] });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].phone, '0501234567', 'item.phone must equal the plan phone');
  assert.equal(roster[0].name, 'אורי');
});

test('plans source: a dashed / +972 phone is preserved verbatim on the card field', () => {
  // normalizeForMatch keys it, but the DISPLAY phone is the raw source value.
  const roster = Roster.build({ plans: [
    planClient({ clientId: 'c1', phone: '052-3659865' }),
    planClient({ clientId: 'c2', name: 'דנה', phone: '+972 50-111-2222' })
  ]});
  assert.equal(byKey(roster, '0523659865').phone, '052-3659865');
  assert.equal(byKey(roster, '0501112222').phone, '+972 50-111-2222');
});

test('EVERY built item carries a non-empty phone (a card can never be phone-less)', () => {
  const roster = Roster.build({
    plans: [planClient({ phone: '0501234567' })],
    debtRoster: [{ name: 'דנה', phone: '0523659865', debtStatus: 'clear' }],
    patients: [{ name: 'רון', phone: '0539998888', active: 'true' }]
  });
  assert.equal(roster.length, 3);
  roster.forEach(function (p) { assert.ok(p.phone && String(p.phone).length, 'phone present for ' + p.name); });
});

// --- the other sources also carry phone -------------------------------------

test('debt-roster source: phone carries through when a patient is debt-only', () => {
  const roster = Roster.build({ debtRoster: [{ name: 'דנה', phone: '0523659865', debtStatus: 'debt', amountOwed: 300 }] });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].phone, '0523659865');
  assert.equal(roster[0].debtStatus, 'debt');
});

test('local-intake source: phone carries through when a patient is local-only', () => {
  const roster = Roster.build({ patients: [{ name: 'רון', phone: '0539998888', active: 'true' }] });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].phone, '0539998888');
});

// --- merge interactions don't blank the phone -------------------------------

test('plans + local + debt for one patient: plans phone wins, never blanked', () => {
  // Same person across all three sources (different formatting → same key).
  const roster = Roster.build({
    plans: [planClient({ phone: '0501234567', name: 'אורי' })],
    debtRoster: [{ name: 'אורי', phone: '+972 50-123-4567', debtStatus: 'clear' }],
    patients: [{ name: 'אורי לוי', phone: '050-123-4567', active: 'true' }]
  });
  assert.equal(roster.length, 1, 'merged into one item by phone key');
  const p = roster[0];
  assert.equal(p.phone, '0501234567', 'first adder (plans) sets the display phone');
  assert.equal(p.name, 'אורי לוי', 'local intake name overrides');     // sanity: local override applies to name
});

test('a source with an unusable phone is dropped (no phone-less card created)', () => {
  const roster = Roster.build({
    plans: [planClient({ phone: '' }), planClient({ clientId: 'c2', name: 'ok', phone: '0501112222' })]
  });
  assert.equal(roster.length, 1, 'blank-phone client is not added');
  assert.equal(roster[0].phone, '0501112222');
});

// --- assignments attach but never create a phone-less card ------------------

test('assignments attach therapists to an existing roster item without touching phone', () => {
  const roster = Roster.build({
    plans: [planClient({ phone: '0501234567' })],
    assignments: [{ id: 'a1', patientPhone: '0501234567', therapist: 'דנה', treatmentType: 'פרטני', active: 'true' }]
  });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].phone, '0501234567');
  assert.deepEqual(roster[0].therapists, ['דנה']);
});

test('an assignment-only patient creates NO card (assignments do not add)', () => {
  const roster = Roster.build({
    assignments: [{ id: 'a1', patientPhone: '0501234567', therapist: 'דנה', active: 'true' }]
  });
  assert.equal(roster.length, 0);
});

// --- dashboard plan summary: clean per-type breakdown, not the raw blob ------

test('planTypes: multi-type sessions blob becomes a parsed per-type array', () => {
  const roster = Roster.build({ plans: [planClient({
    sessions: '{"פרטני":1,"ליווי יומי בקהילה":3}'
  })]});
  const p = roster[0];
  assert.ok(Array.isArray(p.planTypes), 'planTypes is an array');
  assert.equal(p.planTypes.length, 2, 'one entry per treatment type');
  const byType = {};
  p.planTypes.forEach(function (t) { byType[t.treatmentType] = t.frequencyPerWeek; });
  assert.equal(byType['פרטני'], 1);
  assert.equal(byType['ליווי יומי בקהילה'], 3);
});

test('planTypes: empty when there is no parseable plan', () => {
  const roster = Roster.build({ plans: [planClient({ serviceType: '', sessions: '' })]});
  assert.deepEqual(roster[0].planTypes, []);
});

// --- browser path: Plan resolved from the global, not injected --------------
// Regression guard: roster.js must resolve Plan via the global object when it is
// NOT passed in as a Node dependency (the real browser load order). A previous
// bug referenced an out-of-scope `root`, so planTypes silently came back empty.

test('planTypes resolves Plan from the global object (browser path)', () => {
  // Load a FRESH roster module instance with no Plan dependency, the way the
  // browser IIFE does (root.Roster = factory(Phone, StopFlow, null)).
  const path = require('path');
  const Phone = require('../public/phone');
  const StopFlow = require('../public/stopflow');
  const PlanGlobal = require('../public/plan');
  // Expose Plan as a global, like the browser <script> would.
  globalThis.Plan = PlanGlobal;
  // Re-require roster.js in browser mode by clearing the cache and stubbing the
  // module system off: simplest reliable approach is to read + eval the factory
  // with module.exports undefined so it takes the browser branch.
  delete require.cache[require.resolve('../public/roster')];
  const code = require('fs').readFileSync(path.resolve(__dirname, '../public/roster.js'), 'utf8');
  const sandbox = { self: globalThis, Phone: Phone, StopFlow: StopFlow };
  globalThis.Phone = Phone; globalThis.StopFlow = StopFlow;
  // eslint-disable-next-line no-eval
  (0, eval)(code); // defines self.Roster using the global Plan
  const R = globalThis.Roster;
  const roster = R.build({ plans: [{
    sourceApp: 'ezone-outpatient', name: 'גלוב', phone: '0501234567',
    serviceType: 'פרטני', sessions: '{"פרטני":1,"מעקב פסיכיאטרי":2}', status: 'מצורף'
  }]});
  assert.equal(roster[0].planTypes.length, 2, 'Plan resolved from global → per-type array');
  delete globalThis.Plan; delete globalThis.Phone; delete globalThis.StopFlow; delete globalThis.Roster;
});
