'use strict';

/**
 * Guard tests for public/houses.js — the single source of truth for the house
 * and location enumerations (extracted from app.js when רעננה הפרדס opened).
 *
 * Locks shut:
 *  1. the canonical 5-house ecosystem list (asher, ramot, arfoni, rehab,
 *     pardes) — adding a house means updating CANONICAL_HOUSES and every
 *     enumeration, and this file fails until that happens;
 *  2. every enumeration (LOCATIONS, ORIGIN_HOUSES) covers ALL five canonical
 *     houses under this repo's documented internal keys;
 *  3. stored ids are frozen — renaming an id would orphan live Sheet rows;
 *  4. honest fallbacks — an unknown stored id renders verbatim, never throws.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Houses = require('../public/houses.js');

const CANONICAL = ['asher', 'ramot', 'arfoni', 'rehab', 'pardes'];

test('canonical list is exactly the ecosystem 5-house set', () => {
  assert.deepEqual(Houses.CANONICAL_HOUSES.map((h) => h.canonical), CANONICAL);
  assert.deepEqual(Houses.CANONICAL_HOUSES.map((h) => h.he), [
    'רעננה אשר', 'רמות השבים', 'קיסריה עפרוני', 'קיסריה ריהאב', 'רעננה הפרדס'
  ]);
});

test('ORIGIN_HOUSES covers every canonical house (plus external, last)', () => {
  const ids = Houses.ORIGIN_HOUSES.map((h) => h.id);
  for (const c of Houses.CANONICAL_HOUSES) {
    assert.ok(ids.includes(c.originId), `ORIGIN_HOUSES missing ${c.canonical} (id ${c.originId})`);
    const entry = Houses.ORIGIN_HOUSES.find((h) => h.id === c.originId);
    assert.equal(entry.he, c.he, `ORIGIN_HOUSES label for ${c.originId} must match canonical label`);
  }
  // external (חיצוני) is not a house — present, and last.
  assert.equal(ids[ids.length - 1], 'external');
  // Frozen stored ids: renaming any would orphan live admittedHouse values.
  assert.deepEqual(ids, ['raanana', 'ramot', 'efroni', 'rehab', 'pardes', 'external']);
});

test('LOCATIONS covers every canonical house (plus שדה אליעז, a non-house venue)', () => {
  const ids = Houses.LOCATIONS.map((l) => l.id);
  for (const c of Houses.CANONICAL_HOUSES) {
    assert.ok(ids.includes(c.locationId), `LOCATIONS missing ${c.canonical} (id ${c.locationId})`);
    const entry = Houses.LOCATIONS.find((l) => l.id === c.locationId);
    assert.equal(entry.he, c.he, `LOCATIONS label for ${c.locationId} must match canonical label`);
  }
  assert.ok(ids.includes('sde_eliaz'), 'שדה אליעז venue must stay on the scheduling list');
  // Frozen stored ids: bookings persist these strings.
  assert.deepEqual(ids, ['sde_eliaz', 'rehab', 'efroni', 'raanana_asher', 'raanana_pardes', 'ramot']);
});

test('the new house pardes labels as רעננה הפרדס in both enumerations', () => {
  assert.equal(Houses.houseLabel('pardes'), 'רעננה הפרדס');
  assert.equal(Houses.locationLabel('raanana_pardes'), 'רעננה הפרדס');
});

test('label helpers fall back verbatim for unknown ids (never throw, never blank)', () => {
  assert.equal(Houses.houseLabel('no_such_house'), 'no_such_house');
  assert.equal(Houses.locationLabel('no_such_place'), 'no_such_place');
  assert.equal(Houses.houseLabel(''), '');
  assert.equal(Houses.houseLabel(null), '');
});

test('legacy location ids still label in Hebrew (historical bookings)', () => {
  assert.equal(Houses.locationLabel('arfoni'), 'קיסריה עפרוני');
  assert.equal(Houses.locationLabel('raanana'), 'רעננה אשר');
  assert.equal(Houses.locationLabel('asher'), 'אשר');
});

test('index.html loads houses.js before app.js; app.js consumes the module', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const housesAt = idx.indexOf('src="houses.js');
  const appAt = idx.indexOf('src="app.js');
  assert.ok(housesAt > -1, 'index.html must load houses.js');
  assert.ok(appAt > -1 && housesAt < appAt, 'houses.js must load before app.js');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(app.includes('window.Houses'), 'app.js must read the lists from window.Houses');
  assert.ok(!/var ORIGIN_HOUSES = \[/.test(app), 'app.js must not redefine ORIGIN_HOUSES inline');
  assert.ok(!/var LOCATIONS = \[/.test(app), 'app.js must not redefine LOCATIONS inline');
});
