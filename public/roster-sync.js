/**
 * roster-sync.js
 * -----------------------------------------------------------------------------
 * PURE planner for syncing the Therapists sheet from the ezone-staffing roster
 * feed (`getTherapistsForTherapists`). No I/O — it takes the current sheet rows
 * and the feed rows and returns a plan; `applyPlan` turns a plan into the
 * row writes. The Apps Script side (`apps-script/Code.gs` `_staffingRoster` /
 * `_previewStaffingRosterSync`) mirrors the core VERBATIM — see the BEGIN/END
 * markers below; test/roster-sync.test.js asserts the two copies are
 * BYTE-IDENTICAL (the therapist-migration mirror convention, upgraded from
 * parsed-equal to byte-equal).
 *
 * Design rules (the whole point of this module):
 *   - Matching is BYTE-EXACT after trim(). Every downstream consumer
 *     (Assignments, Schedule, outpatient TherapistRates) matches therapist
 *     names as exact strings, so the sync must never be cleverer than they are.
 *   - Normalization (gershayim ״→", trim, collapse spaces) is used ONLY to
 *     surface `nearMatches` for a human to fix at the source — NEVER to
 *     auto-merge two spellings.
 *   - `possibleRenames` is a report-only heuristic (shared first token) so a
 *     staffing-side rename (שירן → שירן כהן) is visible in the preview.
 *   - The plan NEVER deletes a row and NEVER renames one. Deactivation must be
 *     explicitly enabled via applyPlan(plan, {allowDeactivate:true}).
 *
 * Not loaded by the browser (like therapist-migration.js): it exists for the
 * Apps Script mirror + `node --test`.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // Node / tests
  else root.RosterSync = api;                                               // browser global (unused)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* === BEGIN roster-sync core — MIRROR: public/roster-sync.js ⇄ apps-script/Code.gs; keep BYTE-IDENTICAL (guarded by test/roster-sync.test.js) === */

function _rosterSyncTrim(name) { return String(name == null ? '' : name).trim(); }

// Normalization used ONLY to surface nearMatches — NEVER to match or merge.
// Gershayim (״) → ASCII quote ("), trim, collapse whitespace runs.
function _rosterSyncNormalize(name) {
  return _rosterSyncTrim(name).replace(/״/g, '"').replace(/\s+/g, ' ');
}

// Tolerant active-flag reader: the sheet stores 'true'/'false' strings, the
// staffing feed sends booleans. Same semantics as public/scheduling.js
// isActive — only an explicit negative retires; blank means active.
function _rosterSyncIsActive(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === undefined || v === null || v === '') return true;
  var s = String(v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === 'inactive' || s === 'לא');
}

function _rosterSyncFirstToken(name) {
  return _rosterSyncTrim(name).split(/\s+/)[0] || '';
}

// Why a nearMatch pair differs: 'whitespace' (edge or internal spacing only),
// 'gershayim' (״ vs " only), or 'gershayim+whitespace' (both needed).
function _rosterSyncNearReason(a, b) {
  var ta = _rosterSyncTrim(a), tb = _rosterSyncTrim(b);
  if (ta === tb) return 'whitespace';
  if (ta.replace(/״/g, '"') === tb.replace(/״/g, '"')) return 'gershayim';
  if (ta.replace(/\s+/g, ' ') === tb.replace(/\s+/g, ' ')) return 'whitespace';
  return 'gershayim+whitespace';
}

// De-dupe + index one side's rows: [{raw, key, active}], first occurrence wins
// (same rule as Scheduling.activeNames). key = trim(name); raw is kept verbatim
// so a whitespace-only difference is still visible in nearMatches.
function _rosterSyncIndex(rows) {
  var list = [], seen = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    var raw = (r && r.name != null) ? String(r.name) : '';
    var key = _rosterSyncTrim(raw);
    if (!key || seen[key]) return;
    seen[key] = true;
    list.push({ raw: raw, key: key, active: _rosterSyncIsActive(r.active) });
  });
  return list;
}

/**
 * Plan the staffing→Therapists roster sync. Pure — no I/O.
 * @param {Array} sheetRows current Therapists sheet rows [{name, active}]
 * @param {Array} feedRows  staffing feed rows [{name, active}]
 * @returns {{add:string[], deactivate:string[], reactivate:string[],
 *            unchanged:number, nearMatches:Array, possibleRenames:Array,
 *            unknownInSheet:string[]}}
 */
function planRosterSync(sheetRows, feedRows) {
  var plan = { add: [], deactivate: [], reactivate: [], unchanged: 0,
               nearMatches: [], possibleRenames: [], unknownInSheet: [] };
  var sheet = _rosterSyncIndex(sheetRows);
  var feed = _rosterSyncIndex(feedRows);
  var sheetByKey = {}, feedByKey = {};
  sheet.forEach(function (s) { sheetByKey[s.key] = s; });
  feed.forEach(function (f) { feedByKey[f.key] = f; });

  sheet.forEach(function (s) {
    var f = feedByKey[s.key];
    if (!f) {
      // Absent from the feed: report it, and (if currently active) deactivate.
      plan.unknownInSheet.push(s.key);
      if (s.active) plan.deactivate.push(s.key);
      return;
    }
    if (s.raw !== f.raw) {
      // Matched by trimmed key but not byte-equal raw (edge whitespace).
      plan.nearMatches.push({ sheet: s.raw, feed: f.raw, reason: _rosterSyncNearReason(s.raw, f.raw) });
    }
    if (s.active && !f.active) plan.deactivate.push(s.key);
    else if (!s.active && f.active) plan.reactivate.push(s.key);
    else plan.unchanged++;
  });
  feed.forEach(function (f) {
    if (!sheetByKey[f.key]) plan.add.push(f.key);
  });

  // nearMatches across the UNMATCHED names: same after normalization, not
  // byte-equal. These pairs are ALSO left in add/deactivate on purpose — the
  // human fixes the spelling at the source; nothing is auto-merged.
  var sheetOnly = sheet.filter(function (s) { return !feedByKey[s.key]; });
  var feedOnly = feed.filter(function (f) { return !sheetByKey[f.key]; });
  var nearPair = {};
  sheetOnly.forEach(function (s) {
    feedOnly.forEach(function (f) {
      if (_rosterSyncNormalize(s.key) === _rosterSyncNormalize(f.key)) {
        plan.nearMatches.push({ sheet: s.raw, feed: f.raw, reason: _rosterSyncNearReason(s.raw, f.raw) });
        nearPair[s.key + '\n' + f.key] = true;
      }
    });
  });

  // possibleRenames heuristic: a first token owned by EXACTLY one sheet-only
  // name and EXACTLY one feed-only name (and not already a nearMatch pair)
  // looks like a rename (שירן → שירן כהן). Report-only — never applied.
  var byToken = {};
  sheetOnly.forEach(function (s) {
    var t = _rosterSyncFirstToken(s.key);
    (byToken[t] = byToken[t] || { s: [], f: [] }).s.push(s.key);
  });
  feedOnly.forEach(function (f) {
    var t = _rosterSyncFirstToken(f.key);
    (byToken[t] = byToken[t] || { s: [], f: [] }).f.push(f.key);
  });
  Object.keys(byToken).forEach(function (t) {
    var g = byToken[t];
    if (g.s.length === 1 && g.f.length === 1 && !nearPair[g.s[0] + '\n' + g.f[0]]) {
      plan.possibleRenames.push({ from: g.s[0], to: g.f[0] });
    }
  });
  return plan;
}

/**
 * Turn a plan into the Therapists-sheet row writes: [{name, active}] where
 * active is the sheet's 'true'/'false' string convention (upsert by name;
 * missing names are appended). NEVER emits a delete, NEVER a rename;
 * deactivation only when explicitly allowed.
 * @param {Object} plan a planRosterSync result
 * @param {{allowDeactivate:boolean}} opts
 * @returns {Array<{name:string, active:string}>}
 */
function applyPlan(plan, opts) {
  var allowDeactivate = !!(opts && opts.allowDeactivate);
  var writes = [];
  if (!plan) return writes;
  (plan.add || []).forEach(function (n) { writes.push({ name: n, active: 'true' }); });
  (plan.reactivate || []).forEach(function (n) { writes.push({ name: n, active: 'true' }); });
  if (allowDeactivate) {
    (plan.deactivate || []).forEach(function (n) { writes.push({ name: n, active: 'false' }); });
  }
  return writes;
}

/* === END roster-sync core === */

  return {
    planRosterSync: planRosterSync,
    applyPlan: applyPlan,
    normalizeName: _rosterSyncNormalize,
    isActive: _rosterSyncIsActive
  };
});
