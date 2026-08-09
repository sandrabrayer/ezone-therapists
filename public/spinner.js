/* E-ZONE Therapists — framework-free spinner helpers.
 *
 * Kept tiny and PURE so the "when do we show a loading spinner" decision and the
 * markup are unit-testable without a DOM. The actual injection into the page
 * lives in app.js; here we only build the markup string and decide state.
 *
 * The spinner itself is CSS-only (see .spinner / .spinner-wrap in style.css) —
 * no image, no library — so it themes with the app (fuchsia accent on the dark
 * background) and respects prefers-reduced-motion.
 */
(function (global) {
  'use strict';

  // Inline spinner markup for a section/tab placeholder. `label` is optional
  // Hebrew helper text shown beside the spinner. role=status + aria-live so
  // assistive tech announces the loading state; the glyph itself is aria-hidden.
  function html(label) {
    var text = label ? '<span class="spinner-label"></span>' : '';
    var node = '<div class="spinner-wrap" role="status" aria-live="polite">' +
      '<span class="spinner" aria-hidden="true"></span>' + text +
      '</div>';
    // Fill the label via a placeholder swap so callers can't inject markup
    // through the label (defense-in-depth; labels are app constants today).
    if (label) node = node.replace('<span class="spinner-label"></span>',
      '<span class="spinner-label">' + escapeText(label) + '</span>');
    return node;
  }

  // Minimal HTML-escape for the (app-controlled) label text.
  function escapeText(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Show the whole-app initial-load spinner ONLY on the very first load, before
  // any data has arrived. Once `loaded` flips true this never returns true again
  // — a manual refresh re-uses whatever is already on screen (toast on done).
  function isInitialLoading(state) {
    state = state || {};
    return !!state.initialLoading && !state.loaded;
  }

  var Spinner = { html: html, isInitialLoading: isInitialLoading };

  if (typeof module !== 'undefined' && module.exports) module.exports = Spinner;
  else global.Spinner = Spinner;
})(typeof window !== 'undefined' ? window : this);
