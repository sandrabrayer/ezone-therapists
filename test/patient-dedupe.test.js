'use strict';
const test = require('node:test');
const assert = require('node:assert');
const PatientDedupe = require('../public/patient-dedupe');

test('create with an existing canonical phone is a duplicate (blocked)', () => {
  const existing = ['0501234567', '0521112222'];
  assert.strictEqual(
    PatientDedupe.isDuplicateCreate('create', '0501234567', existing), true);
});

test('create with a new phone is allowed', () => {
  const existing = ['0501234567', '0521112222'];
  assert.strictEqual(
    PatientDedupe.isDuplicateCreate('create', '0509999999', existing), false);
});

test('edit never blocks, even when the phone already exists', () => {
  const existing = ['0501234567'];
  assert.strictEqual(
    PatientDedupe.isDuplicateCreate('edit', '0501234567', existing), false);
  assert.strictEqual(
    PatientDedupe.isDuplicateCreate('', '0501234567', existing), false);
});

test('empty phone / empty list never blocks', () => {
  assert.strictEqual(PatientDedupe.isDuplicateCreate('create', '', ['0501234567']), false);
  assert.strictEqual(PatientDedupe.isDuplicateCreate('create', '0501234567', []), false);
  assert.strictEqual(PatientDedupe.isDuplicateCreate('create', '0501234567', undefined), false);
});
