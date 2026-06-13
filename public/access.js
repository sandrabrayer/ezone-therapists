/**
 * access.js
 * -----------------------------------------------------------------------------
 * The app's access rules as pure predicates (iteration 6). Editing is gated by an
 * explicit EDIT MODE that an editor turns on, and only on the editable tabs:
 *
 *   - דשבורד מטופלים (dashboard) — VIEW-ONLY for everyone (not editable).
 *   - שיבוץ מטפלים (workflow)     — editable: assignments, plans, scheduling.
 *   - המטופלים שלי (mine)          — editable: the therapist marks did-it-happen.
 *
 * The «עריכה» toggle is shown only to an editor and only on an editable tab; the
 * edit controls (.edit-only) are visible only once that editor turns edit mode on.
 *
 * Framework-free; runs in the browser and under `node --test`.
 * `test/access.test.js` guards it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.Access = api;               // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The tabs where editing is allowed. The dashboard is deliberately absent.
  var EDITABLE_VIEWS = { workflow: true, mine: true };

  function isEditableView(view) { return !!EDITABLE_VIEWS[String(view == null ? '' : view)]; }
  function isEditor(role) { return role === 'editor'; }

  // The «עריכה» toggle: editor-only, and only on an editable tab.
  function editToggleVisible(role, view) { return isEditor(role) && isEditableView(view); }

  // Edit controls (.edit-only): visible only when an editor has edit mode ON.
  // (Viewers can never enter edit mode, so they never see edit controls.)
  function editControlsVisible(role, editMode) { return isEditor(role) && !!editMode; }

  return {
    EDITABLE_VIEWS: EDITABLE_VIEWS,
    isEditableView: isEditableView,
    isEditor: isEditor,
    editToggleVisible: editToggleVisible,
    editControlsVisible: editControlsVisible
  };
});
