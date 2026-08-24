/**
 * houses.js
 * -----------------------------------------------------------------------------
 * SINGLE source of truth for the house / location enumerations. Extracted from
 * app.js so the lists are testable under `node --test` (test/houses.test.js
 * guards that every enumeration covers the canonical 5-house list).
 *
 * CANONICAL 5-HOUSE LIST (ecosystem-wide)
 * ---------------------------------------
 * The E-ZONE ecosystem has five houses. Sibling apps address them by canonical
 * id; THIS repo predates two of those ids, so it keeps its historical internal
 * keys for values already stored in the Sheet (renaming would orphan live
 * rows). The mapping is:
 *
 *   | canonical | Hebrew label   | ORIGIN_HOUSES id | LOCATIONS id     |
 *   |-----------|----------------|------------------|------------------|
 *   | asher     | רעננה אשר      | raanana (legacy) | raanana_asher    |
 *   | ramot     | רמות השבים     | ramot            | ramot            |
 *   | arfoni    | קיסריה עפרוני  | efroni (legacy)  | efroni           |
 *   | rehab     | קיסריה ריהאב   | rehab            | rehab            |
 *   | pardes    | רעננה הפרדס    | pardes           | raanana_pardes   |
 *
 * The NEW house (רעננה הפרדס, opened Aug 2026, תחלואה כפולה) uses the
 * canonical id `pardes` directly in ORIGIN_HOUSES — no new legacy key. Its
 * scheduling-location id `raanana_pardes` predates this file (iteration 10)
 * and is already stored on live bookings, so it stays as-is.
 *
 * Both label helpers fall back to echoing an unknown id verbatim — an
 * unrecognized stored value renders as itself, never an error.
 *
 * Framework-free so it runs in the browser AND under `node --test`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Houses = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The canonical ecosystem list, with this repo's internal keys per
  // enumeration. `originId` keys ORIGIN_HOUSES; `locationId` keys LOCATIONS.
  var CANONICAL_HOUSES = [
    { canonical: 'asher',  he: 'רעננה אשר',    originId: 'raanana', locationId: 'raanana_asher' },
    { canonical: 'ramot',  he: 'רמות השבים',   originId: 'ramot',   locationId: 'ramot' },
    { canonical: 'arfoni', he: 'קיסריה עפרוני', originId: 'efroni',  locationId: 'efroni' },
    { canonical: 'rehab',  he: 'קיסריה ריהאב',  originId: 'rehab',   locationId: 'rehab' },
    { canonical: 'pardes', he: 'רעננה הפרדס',   originId: 'pardes',  locationId: 'raanana_pardes' }
  ];

  // Scheduling LOCATIONS are a fixed code list (id stored, Hebrew shown). This
  // is the therapist's scheduling choice — independent of any roster house.
  // שדה אליעז is a treatment venue, not a house.
  var LOCATIONS = [
    { id: 'sde_eliaz',      he: 'שדה אליעז' },
    { id: 'rehab',          he: 'קיסריה ריהאב' },
    { id: 'efroni',         he: 'קיסריה עפרוני' },
    { id: 'raanana_asher',  he: 'רעננה אשר' },
    { id: 'raanana_pardes', he: 'רעננה הפרדס' },
    { id: 'ramot',          he: 'רמות השבים' }
  ];

  // Display labels for ids that may sit on OLDER bookings (pre-iteration-10
  // list) so historical rows still read in Hebrew even though they're off the
  // dropdown.
  var LEGACY_LOCATION_LABELS = { raanana: 'רעננה אשר', asher: 'אשר', arfoni: 'קיסריה עפרוני' };

  // ORIGIN HOUSES — a SEPARATE list from the scheduling LOCATIONS, used for
  // the "still admitted — which house" field on the intake record. `external`
  // (חיצוני) is not a house — it stays last.
  var ORIGIN_HOUSES = [
    { id: 'raanana',  he: 'רעננה אשר' },
    { id: 'ramot',    he: 'רמות השבים' },
    { id: 'efroni',   he: 'קיסריה עפרוני' },
    { id: 'rehab',    he: 'קיסריה ריהאב' },
    { id: 'pardes',   he: 'רעננה הפרדס' },
    { id: 'external', he: 'חיצוני' }
  ];

  function locationLabel(v) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < LOCATIONS.length; i++) if (LOCATIONS[i].id === s) return LOCATIONS[i].he;
    return LEGACY_LOCATION_LABELS[s] || s;
  }

  function houseLabel(v) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < ORIGIN_HOUSES.length; i++) if (ORIGIN_HOUSES[i].id === s) return ORIGIN_HOUSES[i].he;
    return s;
  }

  return {
    CANONICAL_HOUSES: CANONICAL_HOUSES,
    LOCATIONS: LOCATIONS,
    LEGACY_LOCATION_LABELS: LEGACY_LOCATION_LABELS,
    ORIGIN_HOUSES: ORIGIN_HOUSES,
    locationLabel: locationLabel,
    houseLabel: houseLabel
  };
}));
