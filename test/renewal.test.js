'use strict';

/**
 * Tests for the package-renewal alerts (חידוש חבילה):
 *
 *  1. public/renewal.js — status boundaries (the 7-day due_soon window, the
 *     same rule as outpatient's due_soon), alert filtering/sorting, discharged
 *     exclusion, and daysBetween parity with the OUTPATIENT formula.
 *  2. public/roster.js — the plans projection's `renewalDate` carries onto the
 *     roster item; an outpatient deploy WITHOUT the field yields '' (the app
 *     must not break before Handoff 3 is live).
 *  3. Rendering — the card's third date line, the chip (only for
 *     due_soon/overdue), the alerts list + empty state; and the app.js /
 *     index.html / sw.js wiring (source guards, same pattern as guide.test.js).
 *
 * Run with:  npm test   (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Renewal = require('../public/renewal');
const Roster = require('../public/roster');

const PUB = path.join(__dirname, '..', 'public');
const TODAY = '2026-08-31';

// A minimal roster-shaped item (already built — renewalAlerts consumes items).
function item(over) {
  return Object.assign({
    name: 'אורי', phone: '0501234567', therapists: ['הילה תבור'],
    treatmentStartDate: '2026-01-01', treatmentEndDate: '', renewalDate: '',
    key: '0501234567'
  }, over || {});
}
// The getTreatmentPlans client projection feeding Roster.build.
function planClient(over) {
  return Object.assign({
    sourceApp: 'ezone-outpatient', clientId: 'c1', name: 'אורי',
    phone: '0501234567', serviceType: 'פרטני', sessions: '{"פרטני":1}', status: 'פעיל'
  }, over || {});
}
function plusDays(iso, n) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- renewalStatus boundaries ----------------------------------------------

test('renewalStatus boundaries: -1 overdue, 0 & 7 due_soon, 8 ok', () => {
  assert.deepEqual(Renewal.renewalStatus(plusDays(TODAY, -1), TODAY), { status: 'overdue', daysLeft: -1 });
  assert.deepEqual(Renewal.renewalStatus(TODAY, TODAY), { status: 'due_soon', daysLeft: 0 });
  assert.deepEqual(Renewal.renewalStatus(plusDays(TODAY, 7), TODAY), { status: 'due_soon', daysLeft: 7 });
  assert.deepEqual(Renewal.renewalStatus(plusDays(TODAY, 8), TODAY), { status: 'ok', daysLeft: 8 });
});

test('renewalStatus: blank / garbage / null → unknown with null daysLeft', () => {
  for (const v of ['', '   ', null, undefined, 'garbage', '31/12/2026', '2026-13-01', '2026-12-40', 12345]) {
    assert.deepEqual(Renewal.renewalStatus(v, TODAY), { status: 'unknown', daysLeft: null },
      'value: ' + JSON.stringify(v));
  }
});

test('renewalStatus tolerates an ISO T-suffixed date', () => {
  assert.deepEqual(Renewal.renewalStatus(TODAY + 'T00:00:00', TODAY), { status: 'due_soon', daysLeft: 0 });
});

// ---- daysBetween parity with the outpatient formula ------------------------

test('daysBetween agrees with the outpatient formula on 20 random date pairs', () => {
  // Verbatim copy of outpatient public/app.js daysBetween.
  const outpatientDaysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  for (let i = 0; i < 20; i++) {
    const a = plusDays('2026-01-01', Math.floor(Math.random() * 700));
    const b = plusDays('2026-01-01', Math.floor(Math.random() * 700));
    assert.equal(Renewal.daysBetween(a, b), outpatientDaysBetween(a, b), a + ' → ' + b);
  }
});

// ---- renewalAlerts ---------------------------------------------------------

test('renewalAlerts keeps only due_soon/overdue, sorted daysLeft asc (overdue first)', () => {
  const roster = [
    item({ name: 'שבוע', renewalDate: plusDays(TODAY, 7) }),
    item({ name: 'רחוק', renewalDate: plusDays(TODAY, 8) }),
    item({ name: 'באיחור', renewalDate: plusDays(TODAY, -3) }),
    item({ name: 'היום', renewalDate: TODAY }),
    item({ name: 'בלי-תאריך', renewalDate: '' })
  ];
  const alerts = Renewal.renewalAlerts(roster, TODAY);
  assert.deepEqual(alerts.map((a) => a.name), ['באיחור', 'היום', 'שבוע']);
  assert.deepEqual(alerts.map((a) => a.daysLeft), [-3, 0, 7]);
  assert.deepEqual(alerts.map((a) => a.renewalStatus), ['overdue', 'due_soon', 'due_soon']);
});

test('renewalAlerts excludes discharged patients (treatmentEndDate set)', () => {
  const roster = [
    item({ name: 'פעיל', renewalDate: TODAY }),
    item({ name: 'שוחרר', renewalDate: TODAY, treatmentEndDate: '2026-08-01' })
  ];
  assert.deepEqual(Renewal.renewalAlerts(roster, TODAY).map((a) => a.name), ['פעיל']);
});

test('renewalAlerts handles empty/null roster; alertCount matches', () => {
  assert.deepEqual(Renewal.renewalAlerts([], TODAY), []);
  assert.deepEqual(Renewal.renewalAlerts(null, TODAY), []);
  assert.equal(Renewal.alertCount([item({ renewalDate: TODAY })], TODAY), 1);
  assert.equal(Renewal.alertCount([item({ renewalDate: plusDays(TODAY, 30) })], TODAY), 0);
});

// ---- roster carry ----------------------------------------------------------

test('roster: the plans renewalDate carries onto the built item', () => {
  const roster = Roster.build({ plans: [planClient({ renewalDate: '2026-09-04' })] });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].renewalDate, '2026-09-04');
});

test('roster: an outpatient deploy WITHOUT renewalDate yields "" (no break)', () => {
  const roster = Roster.build({ plans: [planClient()] });
  assert.equal(roster[0].renewalDate, '');
  // Downstream logic treats it as unknown → no alert, card shows «—».
  assert.equal(Renewal.renewalStatus(roster[0].renewalDate, TODAY).status, 'unknown');
});

test('roster: first non-empty renewalDate wins for a duplicated phone', () => {
  const roster = Roster.build({ plans: [
    planClient({ clientId: 'c1', renewalDate: '' }),
    planClient({ clientId: 'c2', renewalDate: '2026-09-10' })
  ]});
  assert.equal(roster.length, 1);
  assert.equal(roster[0].renewalDate, '2026-09-10');
});

// ---- rendering: chips ------------------------------------------------------

test('chip: due_soon renders the amber days-left chip (היום / מחר / בעוד X ימים)', () => {
  assert.equal(Renewal.chipLabel('due_soon', 0), 'היום');
  assert.equal(Renewal.chipLabel('due_soon', 1), 'מחר');
  assert.equal(Renewal.chipLabel('due_soon', 5), 'בעוד 5 ימים');
  const html = Renewal.chipHtml('due_soon', 5);
  assert.ok(html.includes('renewal-chip-warn'));
  assert.ok(html.includes('בעוד 5 ימים'));
});

test('chip: overdue renders the red «באיחור» chip; ok/unknown render NO chip', () => {
  const html = Renewal.chipHtml('overdue', -2);
  assert.ok(html.includes('renewal-chip-over'));
  assert.ok(html.includes('באיחור'));
  assert.equal(Renewal.chipHtml('ok', 12), '');
  assert.equal(Renewal.chipHtml('unknown', null), '');
});

// ---- rendering: the card's third date line ---------------------------------

test('card line: labeled חידוש חבילה, DD/MM/YYYY value, chip only when due', () => {
  const due = Renewal.cardDateLineHtml(plusDays(TODAY, 3), TODAY);
  assert.ok(due.includes('חידוש חבילה'));
  assert.ok(due.includes('cc-date-line'));
  assert.ok(due.includes('03/09/2026'), 'value must be TreatmentDates-formatted');
  assert.ok(due.includes('renewal-chip-warn'));

  const far = Renewal.cardDateLineHtml(plusDays(TODAY, 30), TODAY);
  assert.ok(far.includes('חידוש חבילה'));
  assert.ok(!far.includes('renewal-chip'), 'ok → no chip');

  const blank = Renewal.cardDateLineHtml('', TODAY);
  assert.ok(blank.includes('—'), 'missing date renders the em-dash placeholder');
  assert.ok(!blank.includes('renewal-chip'), 'unknown → no chip');
});

// ---- rendering: the alerts section list ------------------------------------

test('alerts list: rows carry name, phone, therapists, formatted date and chip', () => {
  const html = Renewal.alertsListHtml([
    item({ name: 'דנה כהן', phone: '0521112222', therapists: ['הילה תבור', 'ד"ר מיכאל שפרינץ'], renewalDate: plusDays(TODAY, 2) })
  ], TODAY);
  assert.ok(html.includes('renewal-row'));
  assert.ok(html.includes('דנה כהן'));
  assert.ok(html.includes('0521112222'));
  assert.ok(html.includes('הילה תבור'));
  assert.ok(html.includes('02/09/2026'));
  assert.ok(html.includes('renewal-chip-warn'));
});

test('alerts list: empty state is «אין חידושים השבוע»', () => {
  const html = Renewal.alertsListHtml([item({ renewalDate: plusDays(TODAY, 60) })], TODAY);
  assert.ok(html.includes('אין חידושים השבוע'));
  assert.ok(!html.includes('renewal-row'));
});

test('alerts list: HTML-escapes patient-sourced values', () => {
  const html = Renewal.alertsListHtml([
    item({ name: '<img src=x onerror=1>', renewalDate: TODAY })
  ], TODAY);
  assert.ok(!html.includes('<img'), 'name must be escaped');
  assert.ok(html.includes('&lt;img'));
});

// ---- wiring guards (source assertions, guide.test.js pattern) --------------

test('app.js wires the card line, the alerts section render and the summed badge', () => {
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.ok(app.includes('Renewal.cardDateLineHtml(p.renewalDate'), 'card must render the renewal date line');
  assert.ok(app.includes('Renewal.alertsListHtml'), 'the renewal alerts section must be rendered');
  assert.ok(/stopN\s*\+\s*renewN/.test(app), 'badge count must be stop alerts + renewal alerts');
  assert.ok(app.includes("classList.toggle('tab-badge-stop', stopN > 0)"), 'badge keeps stop-alert red when any stop alert exists');
});

test('index.html carries the renewal section above the stop alerts and loads renewal.js', () => {
  const idx = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(idx.includes('חידוש חבילה — השבוע הקרוב'), 'section title');
  const section = idx.indexOf('id="renewalAlertsPanel"');
  const stopList = idx.indexOf('id="stopAlertsUnread"');
  assert.ok(section !== -1 && stopList !== -1 && section < stopList, 'renewal section must sit ABOVE the stop alerts list');
  assert.ok(idx.includes('id="renewalAlertsList"'));
  assert.ok(/<script src="renewal\.js\?v=__BUILD__"><\/script>/.test(idx), 'renewal.js must be loaded');
  const dates = idx.indexOf('src="treatmentdates.js');
  const renewal = idx.indexOf('src="renewal.js');
  assert.ok(dates < renewal, 'renewal.js must load after treatmentdates.js (browser dependency)');
});

test('service worker: cache bumped to v17+ and renewal.js precached', () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  const m = sw.match(/ezone-therapists-v(\d+)/);
  assert.ok(m, 'sw.js must define a versioned cache name');
  assert.ok(Number(m[1]) >= 17, 'cache version must be >= v17 so installed clients pick up the renewal UI');
  const shell = sw.match(/var SHELL = \[[^\]]*\]/);
  assert.ok(shell, 'sw.js must define the SHELL precache list');
  assert.ok(shell[0].includes("'./renewal.js'"), 'SHELL must precache ./renewal.js');
});
