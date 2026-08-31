/**
 * therapist-migration.js
 * -----------------------------------------------------------------------------
 * The one-time short→full therapist name migration (+ future renames).
 *
 * This is the single source of truth, MIRRORED in apps-script/Code.gs
 * (_THERAPIST_SHORT_TO_FULL + _migrateTherapistName + _normalizeTherapistKey):
 * any change here MUST be reflected there. It runs under `node --test` (so the
 * mapping is unit-tested) and the Apps Script migration mirrors this exact
 * logic. It is NOT loaded by the browser (the dropdown reads the Therapists
 * sheet); it exists for the server-side mirror + tests.
 *
 * The ROSTER is no longer a hard-coded list: since the staffing roster sync,
 * the Therapists sheet (synced from ezone-staffing) is the source of truth, so
 * every membership check here takes the roster as a PARAMETER — Code.gs passes
 * the live sheet names (_rosterKeySet), tests pass fixtures. The old
 * FINAL_THERAPISTS constant is gone with the THERAPISTS_SEED it mirrored.
 *
 * Why the mapping exists: the old seed hard-coded SHORT therapist names (עידו,
 * דליה, …). The migration renames existing Assignment/Schedule rows from the
 * short names to the full ones, so pay/credit matching lines up with the
 * roster. ONLY the explicit mapping is applied — nothing is invented.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // Node / tests
  else root.TherapistMigration = api;                                       // browser global (unused)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // EXPLICIT short→full mapping. ONLY these are renamed — no mapping is invented.
  // A name not listed here is left untouched (and, if not in the roster,
  // reported as `unmapped` for a human to decide).
  var SHORT_TO_FULL = {
    'רמי': 'רמי רום',
    'כנרת': 'כנרת זיידן',
    'הילה': 'הילה תבור',
    'אלה': 'אלה שפירא',
    'שירן': 'שירן כהן',
    'דנה': 'דנה דרוקר',
    'יפעת': 'יפעת רומנו',
    'איתן דשה': 'איתן דשא',
    'דליה': 'דליה מלמד',
    'מעיין': 'מעיין דלומי',
    'תמר': 'תמר גנץ',
    'עידו': 'עידו בוזגלו',
    'ד״ר שפרינץ': 'ד"ר מיכאל שפרינץ',
    'ד"ר שפרינץ': 'ד"ר מיכאל שפרינץ',
    'ד״ר נטליה': 'ד"ר נטליה סדוגין',
    'ד"ר נטליה': 'ד"ר נטליה סדוגין',
    'ד״ר דנגור': 'ד"ר יצחק דנגור',
    'ד"ר דנגור': 'ד"ר יצחק דנגור'
  };

  function trimName(name) { return String(name == null ? '' : name).trim(); }

  // Membership KEY: trim, collapse inner whitespace, and drop Hebrew gershayim/
  // geresh + ASCII quotes so a ד״ר vs ד"ר quote-style difference is treated as the
  // SAME name (punctuation normalization only — never a name mapping).
  function normalizeKey(name) {
    return trimName(name).replace(/[״׳"']/g, '').replace(/\s+/g, ' ');
  }

  // Exact + normalized membership sets for a roster (an array of name strings).
  function rosterKeySet(rosterNames) {
    var exact = {}, norm = {};
    (Array.isArray(rosterNames) ? rosterNames : []).forEach(function (n) {
      var t = trimName(n);
      if (!t) return;
      exact[t] = true;
      norm[normalizeKey(t)] = true;
    });
    return { exact: exact, norm: norm };
  }

  // Apply the explicit mapping to ONE name. Idempotent: a full name (or any name
  // not a short-key) is returned unchanged, so re-running never double-maps.
  function migrateName(name) {
    var t = trimName(name);
    return Object.prototype.hasOwnProperty.call(SHORT_TO_FULL, t) ? SHORT_TO_FULL[t] : t;
  }

  function isInRosterExact(name, rosterNames) {
    return !!rosterKeySet(rosterNames).exact[trimName(name)];
  }
  function isInRosterNormalized(name, rosterNames) {
    return !!rosterKeySet(rosterNames).norm[normalizeKey(name)];
  }

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
   * @param {Array<string>} rosterNames the current roster (the synced Therapists
   *   sheet's names) to classify against
   * @returns {{changes:Array, unmapped:string[], punctuationVariants:string[], scanned:number}}
   */
  function planMigration(names, rosterNames) {
    var list = Array.isArray(names) ? names : [];
    var roster = rosterKeySet(rosterNames);
    var changes = [];
    var unmappedSeen = {}, unmapped = [];
    var pvSeen = {}, punctuationVariants = [];
    for (var i = 0; i < list.length; i++) {
      var from = trimName(list[i]);
      if (!from) continue;
      var to = migrateName(from);
      if (to !== from) changes.push({ index: i, from: from, to: to });
      // Classify the POST-migration name.
      if (!roster.norm[normalizeKey(to)]) {
        if (!unmappedSeen[to]) { unmappedSeen[to] = true; unmapped.push(to); }
      } else if (!roster.exact[to]) {
        if (!pvSeen[to]) { pvSeen[to] = true; punctuationVariants.push(to); }
      }
    }
    return { changes: changes, unmapped: unmapped, punctuationVariants: punctuationVariants, scanned: list.length };
  }

  return {
    SHORT_TO_FULL: SHORT_TO_FULL,
    migrateName: migrateName,
    isInRosterExact: isInRosterExact,
    isInRosterNormalized: isInRosterNormalized,
    normalizeKey: normalizeKey,
    rosterKeySet: rosterKeySet,
    planMigration: planMigration
  };
});
