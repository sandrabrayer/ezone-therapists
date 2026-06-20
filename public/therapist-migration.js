/**
 * therapist-migration.js
 * -----------------------------------------------------------------------------
 * The CANONICAL therapist roster + the one-time short→full name migration.
 *
 * This is the single source of truth, MIRRORED in apps-script/Code.gs
 * (THERAPISTS_SEED + _THERAPIST_SHORT_TO_FULL + _migrateTherapistName): any change
 * here MUST be reflected there. It runs under `node --test` (so the roster and the
 * mapping are unit-tested) and the Apps Script migration mirrors this exact logic.
 * It is NOT loaded by the browser (the dropdown reads the Therapists sheet); it
 * exists for the server-side mirror + tests.
 *
 * Why: the old seed hard-coded SHORT therapist names (עידו, דליה, …). Deleting a
 * row re-seeded it on the next getData. The fix replaces the seed with the final
 * FULL-name roster (so nothing short is ever re-added) and migrates existing
 * Assignment/Schedule rows from the short names to the full ones, so pay/credit
 * matching lines up with the new roster.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // Node / tests
  else root.TherapistMigration = api;                                       // browser global (unused)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The FINAL 19-name roster (full names). This replaces the old short-name seed.
  var FINAL_THERAPISTS = [
    'מעיין דלומי', 'תמר גנץ', 'אורן כביר', 'אביב מלכה', 'רמי', 'כנרת', 'הילה',
    'עידו בוזגלו', 'אלה', 'שירן', 'דנה', 'יפעת', 'איתן דשה', 'דליה מלמד',
    'נועה זיפמן', 'אסתר', 'ד״ר שפרינץ', 'ד״ר נטליה', 'ד״ר דנגור'
  ];

  // EXPLICIT short→full mapping. ONLY these are renamed — no mapping is invented.
  // A name not listed here is left untouched (and, if not in FINAL_THERAPISTS,
  // reported as `unmapped` for a human to decide).
  var SHORT_TO_FULL = {
    'דליה': 'דליה מלמד',
    'מעיין': 'מעיין דלומי',
    'תמר': 'תמר גנץ',
    'איתן': 'איתן דשה',
    'עידו': 'עידו בוזגלו',
    'נועה': 'נועה זיפמן'
  };

  function trimName(name) { return String(name == null ? '' : name).trim(); }

  // Membership KEY: trim, collapse inner whitespace, and drop Hebrew gershayim/
  // geresh + ASCII quotes so a ד״ר vs ד"ר quote-style difference is treated as the
  // SAME name (punctuation normalization only — never a name mapping).
  function normalizeKey(name) {
    return trimName(name).replace(/[״׳"']/g, '').replace(/\s+/g, ' ');
  }

  var ROSTER_EXACT = {};
  var ROSTER_NORM = {};
  FINAL_THERAPISTS.forEach(function (n) { ROSTER_EXACT[trimName(n)] = true; ROSTER_NORM[normalizeKey(n)] = true; });

  // Apply the explicit mapping to ONE name. Idempotent: a full name (or any name
  // not a short-key) is returned unchanged, so re-running never double-maps.
  function migrateName(name) {
    var t = trimName(name);
    return Object.prototype.hasOwnProperty.call(SHORT_TO_FULL, t) ? SHORT_TO_FULL[t] : t;
  }

  function isInRosterExact(name) { return !!ROSTER_EXACT[trimName(name)]; }
  function isInRosterNormalized(name) { return !!ROSTER_NORM[normalizeKey(name)]; }

  /**
   * Plan the migration over a list of therapist-name strings (one per row).
   * Pure — no I/O. Returns:
   *   changes: [{ index, from, to }]   rows whose name the mapping rewrites
   *   unmapped: [name, …]              distinct post-migration names NOT in the
   *                                    roster even after punctuation-normalizing —
   *                                    true unknowns (חנן, מרים, …) for a human
   *   punctuationVariants: [name, …]   distinct names that match a roster entry
   *                                    ONLY after normalization (ד"ר vs ד״ר) —
   *                                    informational, not rewritten
   * @param {Array<*>} names therapist field values, in row order
   * @returns {{changes:Array, unmapped:string[], punctuationVariants:string[], scanned:number}}
   */
  function planMigration(names) {
    var list = Array.isArray(names) ? names : [];
    var changes = [];
    var unmappedSeen = {}, unmapped = [];
    var pvSeen = {}, punctuationVariants = [];
    for (var i = 0; i < list.length; i++) {
      var from = trimName(list[i]);
      if (!from) continue;
      var to = migrateName(from);
      if (to !== from) changes.push({ index: i, from: from, to: to });
      // Classify the POST-migration name.
      if (!isInRosterNormalized(to)) {
        if (!unmappedSeen[to]) { unmappedSeen[to] = true; unmapped.push(to); }
      } else if (!isInRosterExact(to)) {
        if (!pvSeen[to]) { pvSeen[to] = true; punctuationVariants.push(to); }
      }
    }
    return { changes: changes, unmapped: unmapped, punctuationVariants: punctuationVariants, scanned: list.length };
  }

  return {
    FINAL_THERAPISTS: FINAL_THERAPISTS,
    SHORT_TO_FULL: SHORT_TO_FULL,
    migrateName: migrateName,
    isInRosterExact: isInRosterExact,
    isInRosterNormalized: isInRosterNormalized,
    normalizeKey: normalizeKey,
    planMigration: planMigration
  };
});
