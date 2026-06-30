'use strict';

/**
 * Tests for public/export.js — the per-therapist CSV builder.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Exporter = require('../public/export');

const svc = (x) => x;
const locationLabel = (x) => ({ ramot: 'רמות השבים', rehab: 'קיסריה ריהאב' }[x] || x);
const freqUnit = (t) => (t === 'מעקב פסיכיאטרי' ? 'חודש' : 'שבוע');
const isFramework = (t) => t === 'ליווי יומי בקהילה';

test('buildCsv: a patient row carries name, phone, type, frequency, therapist', () => {
  const csv = Exporter.buildCsv({
    therapistName: 'ירדן',
    patients: [{
      name: 'דנה', phone: '0501234567',
      planTypes: [{ treatmentType: 'פרטני', frequencyPerWeek: 2 }],
      assignments: [{ treatmentType: 'פרטני', frequencyPerWeek: 2, therapist: 'ירדן',
        slots: '[{"weekday":1,"time":"10:00","location":"ramot","room":"3"}]' }]
    }],
    sessions: [],
    svc, locationLabel, freqUnit, isFramework
  });
  assert.ok(csv.includes('דנה'));
  assert.ok(csv.includes('0501234567'));
  assert.ok(csv.includes('2/שבוע'));
  assert.ok(csv.includes('ירדן'));
  // weekly slot rendered with weekday + time + location label + room
  assert.ok(csv.includes('שני · 10:00 · רמות השבים · חדר 3'));
});

test('buildCsv: framework type shows מסגרת + location, never a therapist', () => {
  const csv = Exporter.buildCsv({
    therapistName: 'ירדן',
    patients: [{
      name: 'אבי', phone: '0509999999',
      planTypes: [{ treatmentType: 'ליווי יומי בקהילה', frequencyPerWeek: 3 }],
      assignments: [{ treatmentType: 'ליווי יומי בקהילה', therapist: '',
        slots: '[{"weekday":"","time":"","location":"rehab","room":""}]' }]
    }],
    sessions: [],
    svc, locationLabel, freqUnit, isFramework
  });
  assert.ok(csv.includes('מסגרת — קיסריה ריהאב'));
  assert.ok(!csv.includes('טרם שובץ'));
});

test('buildCsv: unassigned non-framework type shows טרם שובץ', () => {
  const csv = Exporter.buildCsv({
    patients: [{ name: 'גל', phone: '0501112222',
      planTypes: [{ treatmentType: 'פרטני', frequencyPerWeek: 1 }], assignments: [] }],
    sessions: [], svc, locationLabel, freqUnit, isFramework
  });
  assert.ok(csv.includes('טרם שובץ'));
});

test('buildCsv: upcoming sessions are listed and sorted by date', () => {
  const csv = Exporter.buildCsv({
    patients: [],
    sessions: [
      { scheduledDate: '2026-07-10', time: '11:00', patientName: 'ב', treatmentType: 'פרטני', location: 'ramot', room: '5' },
      { scheduledDate: '2026-07-03', time: '09:00', patientName: 'א', treatmentType: 'פרטני', location: 'rehab', room: '' }
    ],
    svc, locationLabel, freqUnit, isFramework
  });
  // earlier date appears before the later one
  assert.ok(csv.indexOf('2026-07-03') < csv.indexOf('2026-07-10'));
  assert.ok(csv.includes('רמות השבים'));
});

test('cell escaping: quotes and commas are safe', () => {
  assert.equal(Exporter._cell('a,b'), '"a,b"');
  assert.equal(Exporter._cell('he said "hi"'), '"he said ""hi"""');
});

test('fileName: includes therapist and is filesystem-safe', () => {
  const fn = Exporter.fileName('ד"ר/יוסי');
  assert.ok(fn.endsWith('.csv'));
  assert.ok(!/[\\/:"*?<>|]/.test(fn.replace('.csv', '')));
});
