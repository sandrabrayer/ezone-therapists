/* E-ZONE Therapists — frontend (iteration 3: dashboard + assignment workflow) */
(function () {
  'use strict';

  // Surface uncaught errors as a toast (same convention as the siblings).
  window.addEventListener('error', function (ev) {
    try {
      var msg = (ev && ev.error && ev.error.message) || ev.message || 'Unknown error';
      var where = ev.filename ? (' @ ' + ev.filename + ':' + ev.lineno) : '';
      var t = document.getElementById('toast');
      if (t) { t.textContent = 'JS error: ' + msg + where; t.classList.add('error'); t.hidden = false; }
      console.error('[ezone-therapists] window error', ev.error || ev.message, where);
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    console.error('[ezone-therapists] unhandled rejection', ev.reason);
  });

  // Modules loaded as globals before this file (see index.html).
  var Phone = window.Phone;
  var DebtGate = window.DebtGate;
  var Approval = window.Approval;
  var Scheduling = window.Scheduling;
  var DebtAlert = window.DebtAlert;
  var Writeback = window.Writeback;
  var Access = window.Access;
  var Plan = window.Plan;
  var StopAlerts = window.StopAlerts;

  // Scheduling LOCATIONS are a fixed code list (id stored, Hebrew shown). This
  // is the therapist's scheduling choice — independent of any roster house.
  var LOCATIONS = [
    { id: 'sde_eliaz',     he: 'שדה אליעז' },
    { id: 'rehab',         he: 'קיסריה ריהאב' },
    { id: 'efroni',        he: 'קיסריה עפרוני' },
    { id: 'raanana_asher', he: 'רעננה אשר' },
    { id: 'raanana_pardes', he: 'רעננה הפרדס' },
    { id: 'ramot',         he: 'רמות השבים' }
  ];
  // Display labels for ids that may sit on OLDER bookings (pre-iteration-10 list)
  // so historical rows still read in Hebrew even though they're off the dropdown.
  var LEGACY_LOCATION_LABELS = { raanana: 'רעננה אשר', asher: 'אשר', arfoni: 'קיסריה עפרוני' };
  function locationLabel(v) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < LOCATIONS.length; i++) if (LOCATIONS[i].id === s) return LOCATIONS[i].he;
    return LEGACY_LOCATION_LABELS[s] || s;
  }

  // ORIGIN HOUSES — a SEPARATE list from the scheduling LOCATIONS, used for the
  // "still admitted — which house" field on the intake record.
  var ORIGIN_HOUSES = [
    { id: 'raanana',  he: 'רעננה אשר' },
    { id: 'ramot',    he: 'רמות השבים' },
    { id: 'efroni',   he: 'קיסריה עפרוני' },
    { id: 'rehab',    he: 'קיסריה ריהאב' },
    { id: 'external', he: 'חיצוני' }
  ];
  function houseLabel(v) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < ORIGIN_HOUSES.length; i++) if (ORIGIN_HOUSES[i].id === s) return ORIGIN_HOUSES[i].he;
    return s;
  }
  // Display-only relabel for legacy outpatient service terms (e.g. מרכז יום).
  function svc(v) { return Scheduling.displayServiceType(v); }

  // --- access: NO roles, NO login -----------------------------------------
  // The app opens directly; all three tabs are visible to everyone. The only
  // "identity" is the therapist NAME picked inside «המטופלים שלי» (tab 3) — fresh
  // each open, NOT persisted. Scheduling/reporting there require a name picked
  // (`hasTherapist`); tab-2 actions (register/assign) are open to all. The real
  // controls are the outpatient debt gate + the Ron/Sandra approval audit.
  function hasTherapist() { return !!state.therapist; }

  // Hebrew copy for each gate flag reason (stable ids come from debt-gate.js).
  var FLAG_TEXT = {
    no_payment_record: 'אין רישום תשלומים עבור מטופל זה — לא ניתן לקבוע חוב. דרוש בירור ידני.',
    no_record: 'הטלפון אינו תואם לאף מטופל חוץ. דרוש בירור ידני.',
    ambiguous: 'הטלפון תואם ליותר ממטופל אחד. דרוש בירור ידני.',
    lookup_failed: 'בדיקת החוב אינה זמינה כרגע — הטיפול יישמר לבירור (לא אומת חוב).'
  };

  // --- state -------------------------------------------------------------
  var state = {
    therapist: '',         // tab-3 selection only — runtime, never persisted
    view: 'dashboard',
    schedule: [],
    occurrences: [],       // virtual recurring occurrences for the coming week
    approvals: [],
    patients: [],
    assignments: [],
    therapists: [],
    treatmentTypes: [],
    debtRoster: [], debtRosterOk: false,
    plans: [], plansOk: false,
    alerts: [],
    notifications: [],
    stopAlerts: [], stopAlertsOk: true,   // «עצירת טיפול» tab — persistent, outpatient-authored
    dashboardSearch: '',
    workflowSearch: '',
    workflowTherapist: '',
    mineSearch: '',
    loaded: false
  };

  // Per-patient gate decisions pending in the schedule modal (null until check).
  var pendingPatients = null;
  // True when the chosen single patient has NO approved plan type — scheduling is
  // blocked (never fail open). Drives the submit button's disabled state.
  var planBlocked = false;

  // --- utils -------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function uid() { return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function daysFromToday(n) {
    var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function fmtDate(v) {
    if (!v) return '';
    var s = String(v);
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    return s;
  }
  function displayDate(v) {
    var s = fmtDate(v);
    if (!s) return '';
    var parts = s.split('-');
    if (parts.length !== 3) return s;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  function money(n) {
    if (!isFinite(n)) return '₪0';
    return '₪' + Math.round(n).toLocaleString('he-IL');
  }
  function displayDateTime(date, time) {
    var d = displayDate(date);
    var t = String(time || '').trim();
    return t ? (d + ' ' + t) : d;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normPhone(v) { return Phone.normalizeForMatch(v); }
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // --- API ---------------------------------------------------------------
  async function apiLoad() {
    var r = await fetch('/api/sheets', { cache: 'no-store' });
    var data = await r.json();
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiPost(body) {
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  // saveSession verifies each patient row server-side and may PARTIALLY reject;
  // tolerate ok:false as long as a results array came back (only a transport
  // failure throws), so per-patient rejections are visible.
  async function apiSaveSession(rows) {
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveSession', rows: rows })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!Array.isArray(data.results)) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  function apiUpdateBooking(id, fields) {
    return apiPost({ action: 'updateBooking', id: id, scheduledDate: fields.scheduledDate, time: fields.time, location: fields.location, room: fields.room });
  }
  function apiRemoveSchedule(id) { return apiPost({ action: 'removeSchedule', id: id }); }
  function apiMarkAttendance(id, attendance, extra) {
    extra = extra || {};
    return apiPost({
      action: 'markAttendance', id: id, attendance: attendance,
      reason: extra.reason || '', approval: extra.approval || null,
      flagged: !!extra.flagged, gateReason: extra.gateReason || '',
      // For a recurring occurrence (virtual until reported), the backend
      // materializes this booking row first (create-only, idempotent by id).
      occurrence: extra.occurrence || null
    });
  }
  // iteration 18 step 2 — record the 3-state session outcome (storage-only; no
  // debt gate, no outpatient write-back — that's step 3). For a virtual recurring
  // occurrence the backend materializes the booking row first (idempotent by id).
  function apiSetSessionOutcome(id, outcome, extra) {
    extra = extra || {};
    return apiPost({
      action: 'setSessionOutcome', id: id, outcome: outcome,
      outcomeAt: extra.outcomeAt || '', occurrence: extra.occurrence || null
    });
  }
  function apiSyncPending() { return apiPost({ action: 'syncPending' }); }
  function apiSavePatient(patient, mode) { return apiPost({ action: 'savePatient', patient: patient, mode: mode || 'edit' }); }
  function apiMarkPatientStopped(body) { return apiPost(Object.assign({ action: 'markPatientStopped' }, body)); }
  function apiRestorePatient(body) { return apiPost(Object.assign({ action: 'restorePatient' }, body)); }
  function apiRemovePatient(body) { return apiPost(Object.assign({ action: 'removePatient' }, body)); }
  function apiSaveAssignment(assignment) { return apiPost({ action: 'saveAssignment', assignment: assignment }); }
  function apiDismissNotification(id) { return apiPost({ action: 'dismissNotification', id: id, therapist: state.therapist || '' }); }
  function apiRemoveAssignment(id) { return apiPost({ action: 'removeAssignment', id: id }); }

  // The assignment ALWAYS saves locally; pushing the clinical billing type to
  // outpatient is a best-effort side-effect the server reports back as
  // `clinicalSync`. ClinicalSync.warningFor maps a FAILED sync to a Hebrew reason
  // so we WARN rather than silently swallow it (null = nothing pushed / synced OK).
  function clinicalSyncWarning(data) {
    return ClinicalSync.warningFor(data && data.clinicalSync);
  }
  // Same shape for the session-outcome push: the outcome ALWAYS saves locally;
  // the pay-sync to outpatient (recordSessionOutcome) is reported back as
  // `outcomeSync`. OutcomeSync.warningFor maps a FAILED sync to a Hebrew reason so
  // we WARN rather than silently swallow it (null = nothing pushed / synced OK).
  function outcomeSyncWarning(data) {
    return OutcomeSync.warningFor(data && data.outcomeSync);
  }
  // Live read — never cached.
  async function apiDebtStatus() {
    var r = await fetch('/api/debt-status', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiTreatmentPlans() {
    var r = await fetch('/api/treatment-plans', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  // «עצירת טיפול» — the outpatient-authored persistent stop-treatment alerts,
  // and the one-by-one mark-read. Secrets are injected server-side; the browser
  // only ever calls these relative paths.
  async function apiStopAlerts() {
    var r = await fetch('/api/stop-alerts', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiMarkStopAlertRead(id) {
    var r = await fetch('/api/stop-alerts/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  // Return ONE alert to unread — the mirror of the read call (same proxy
  // pattern). Requires the outpatient `markStopAlertUnread` backend action.
  async function apiMarkStopAlertUnread(id) {
    var r = await fetch('/api/stop-alerts/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  // The alert shape is defensive: the outpatient app owns these rows. The field
  // aliasing (name incl. clientName, created, note, stable reason key, read) is
  // the PURE StopAlerts.normalize; here we only add the patient phone, which
  // needs the browser-only Phone module.
  function normalizeStopAlert(a) {
    a = a || {};
    var out = StopAlerts.normalize(a);
    out.patientPhone = Phone.recoverStored(a.patientPhone || a.phone || '');
    return out;
  }

  function normalizeScheduleRow(row) {
    return {
      id: row.id || uid(),
      sessionId: row.sessionId || '',
      therapist: row.therapist || '',
      treatmentType: row.treatmentType || '',
      location: row.location || '',
      room: row.room || '',
      scheduledDate: fmtDate(row.scheduledDate),
      time: row.time || '',
      patientName: row.patientName || '',
      patientPhone: Phone.recoverStored(row.patientPhone || ''),
      attendance: row.attendance || '',
      attendanceMarkedAt: row.attendanceMarkedAt || '',
      reason: row.reason || '',
      // iteration 18 step 2 — 3-state session outcome (storage-only) + its stamp.
      outcome: row.outcome || '',
      outcomeAt: row.outcomeAt || '',
      gateStatus: row.gateStatus || '',
      gateReason: row.gateReason || '',
      amountOwed: Number(row.amountOwed) || 0,
      approverId: row.approverId || '',
      approverName: row.approverName || '',
      approvalNote: row.approvalNote || '',
      approvedAt: row.approvedAt || '',
      created: row.created || '',
      syncStatus: row.syncStatus || '',
      syncedAt: row.syncedAt || ''
    };
  }

  // --- loading -----------------------------------------------------------
  // Re-read ONLY this app's own data (schedule/approvals/patients/assignments/
  // therapists/types/notifications). Used after a SAVE — debt and plans live in
  // the outpatient app and don't change when we write here, so we skip those two
  // slow cross-app round-trips. Initial load and manual refresh use loadAll().
  async function loadOwn() {
    try {
      var data = await apiLoad();
      state.schedule = (data.schedule || []).map(normalizeScheduleRow);
      state.approvals = data.approvals || [];
      state.patients = (data.patients || []).map(function (p) {
        if (p && p.phone != null) p.phone = Phone.recoverStored(p.phone);
        return p;
      });
      state.assignments = (data.assignments || []).map(function (a) {
        if (a && a.patientPhone != null) a.patientPhone = Phone.recoverStored(a.patientPhone);
        return a;
      });
      state.therapists = data.therapists || [];
      state.treatmentTypes = data.treatmentTypes || [];
      state.notifications = (data.notifications || []).map(function (n) {
        if (n && n.patientPhone != null) n.patientPhone = Phone.recoverStored(n.patientPhone);
        return n;
      });
      state.loaded = true;
    } catch (e) {
      toast('שגיאה בטעינת הנתונים: ' + e.message, true);
      throw e;
    }
    recomputeAlerts();
    render();
  }

  async function loadAll() {
    await loadOwn();
    // Cross-app reads are best-effort and independent; never block the app.
    await Promise.all([loadDebtRoster(), loadPlans(), loadStopAlerts()]);
    recomputeAlerts();
    render();
  }
  // Load the persistent stop-treatment alerts and refresh the tab badge. On
  // failure we KEEP whatever alerts we already had (an alert never disappears on
  // its own) and only flag the endpoint as down so the tab can say so.
  async function loadStopAlerts() {
    try {
      var d = await apiStopAlerts();
      var raw = Array.isArray(d.alerts) ? d.alerts
        : (Array.isArray(d.stopAlerts) ? d.stopAlerts : []);
      state.stopAlerts = raw.map(normalizeStopAlert);
      state.stopAlertsOk = true;
    } catch (e) {
      console.warn('[ezone-therapists] stop alerts unavailable:', e.message);
      state.stopAlertsOk = false;
    }
    updateStopAlertsBadge();
  }
  async function loadDebtRoster() {
    try {
      var d = await apiDebtStatus();
      state.debtRoster = Array.isArray(d.clients) ? d.clients : [];
      state.debtRosterOk = true;
    } catch (e) {
      console.warn('[ezone-therapists] debt status unavailable:', e.message);
      state.debtRoster = []; state.debtRosterOk = false;
    }
  }
  async function loadPlans() {
    try {
      var d = await apiTreatmentPlans();
      state.plans = Array.isArray(d.clients) ? d.clients : (Array.isArray(d.plans) ? d.plans : []);
      state.plansOk = true;
    } catch (e) {
      console.warn('[ezone-therapists] treatment plans unavailable:', e.message);
      state.plans = []; state.plansOk = false;
    }
  }

  // Re-check live debt for upcoming, unmarked scheduled rows: surface patients
  // who fell into debt AFTER booking. Pure logic in debt-alert.js.
  function recomputeAlerts() {
    state.alerts = DebtAlert.evaluateAlerts({
      rows: state.schedule,
      roster: state.debtRoster,
      rosterOk: state.debtRosterOk,
      today: today()
    });
  }
  function alertFor(id) {
    for (var i = 0; i < state.alerts.length; i++) if (state.alerts[i].id === id) return state.alerts[i];
    return null;
  }

  // Always re-check debt live just before scheduling.
  async function refreshDebtRoster() {
    await loadDebtRoster();
    return { roster: state.debtRoster, rosterOk: state.debtRosterOk };
  }

  // --- derived rosters ---------------------------------------------------
  // Active outpatients come from the outpatient sibling roster (treatment plans
  // preferred, debt roster as a fallback/union), keyed by normalized phone, then
  // LEFT-JOINED with this app's local intake record. The dashboard's plan view
  // prefers Vered's locally-set main plan and falls back to the roster's.
  // Build EVERY patient (active + stopped), each tagged with a `stopped` flag.
  // `activePatients` / `stoppedPatients` are thin filters over this so the heavy
  // cross-app join runs once per call site. A patient is stopped when discharged
  // in outpatient (plan status 'סיים טיפול') OR locally flagged (StopFlow).
  // The merge itself lives in the framework-free, unit-tested Roster module.
  function buildPatientRoster() {
    return Roster.build({
      plans: state.plans,
      debtRoster: state.debtRoster,
      patients: state.patients,
      assignments: state.assignments
    });
  }
  // Active = not stopped (the default working list everywhere). Stopped = the
  // stop-requested / discharged list (history kept, off the active list). Both
  // partition one roster via the shared StopFlow.splitStopped.
  function activePatients() { return StopFlow.splitStopped(buildPatientRoster()).active; }
  function stoppedPatients() { return StopFlow.splitStopped(buildPatientRoster()).stopped; }

  // The coming week's recurring occurrences for the picked therapist (virtual —
  // not persisted until reported). Skips stopped patients and any occurrence whose
  // deterministic id is already a real Schedule row (idempotent re-view).
  function buildOccurrences() {
    if (!hasTherapist()) return [];
    var roster = buildPatientRoster();
    var nameByKey = {}, stoppedByKey = {};
    roster.forEach(function (p) {
      nameByKey[p.key] = { name: p.name };
      if (p.stopped) stoppedByKey[p.key] = true;
    });
    var existingIds = {};
    (state.schedule || []).forEach(function (r) { if (r && r.id) existingIds[r.id] = true; });
    return Recurring.generateOccurrences({
      assignments: state.assignments || [],
      therapist: state.therapist,
      today: today(),
      horizonDays: 7,
      patientsByPhone: nameByKey,
      stoppedPhones: stoppedByKey,
      existingScheduleIds: existingIds
    });
  }
  // Short human label for a patient's assignments (multiple parallel plans).
  function assignmentSummary(p, withTherapist) {
    if (!p.assignments.length) {
      // Not yet assigned by Yarden: show the APPROVED plan, parsed per-type,
      // instead of dumping the raw `sessions` JSON blob. e.g.
      // "פרטני · 1× בשבוע | ליווי יומי בקהילה · 3× בשבוע".
      var types = (p.planTypes && p.planTypes.length) ? p.planTypes : [];
      if (types.length) {
        return types.map(function (t) {
          var bits = [svc(t.treatmentType) || '—'];
          if (t.frequencyPerWeek) bits.push(t.frequencyPerWeek + '× בשבוע');
          return bits.join(' · ');
        }).join(' | ');
      }
      // Last-resort fallback for a scalar plan with no parseable per-type map.
      return p.serviceType ? svc(p.serviceType) + (p.rosterSessions ? ' · ' + p.rosterSessions + '×' : '') : '';
    }
    return p.assignments.map(function (a) {
      var bits = [svc(a.treatmentType) || '—'];
      if (a.frequencyPerWeek) bits.push(a.frequencyPerWeek + '× בשבוע');
      if (withTherapist && a.therapist) bits.unshift(a.therapist);
      return bits.join(' · ');
    }).join(' | ');
  }
  function patientByPhone(phone) {
    var key = normPhone(phone);
    return activePatients().filter(function (p) { return p.key === key; })[0] || null;
  }

  // Patients ASSIGNED to the current therapist — the only patients they may
  // schedule (individual AND group). Mirrors renderMine's filter. Empty when no
  // therapist is picked.
  function assignedPatients() {
    if (!hasTherapist()) return [];
    return Scheduling.assignedToTherapist(activePatients(), state.therapist);
  }
  function assignedPatientNames() {
    return assignedPatients().map(function (p) { return p.name; }).filter(Boolean)
      .sort(function (a, b) { return String(a).localeCompare(b, 'he'); });
  }
  // Resolve the assigned patient a schedule row refers to (by phone key first,
  // then exact name), or null when the row doesn't (yet) name an assigned patient.
  function resolveAssignedPatientForRow(row) {
    if (!row) return null;
    var phone = (row.querySelector('.patient-phone').value || '').trim();
    var name = (row.querySelector('.patient-name').value || '').trim();
    var list = assignedPatients();
    var key = phone ? normPhone(phone) : '';
    if (key) { var byPhone = list.filter(function (p) { return p.key === key; })[0]; if (byPhone) return byPhone; }
    if (name) { var byName = list.filter(function (p) { return p.name === name; })[0]; if (byName) return byName; }
    return null;
  }

  // The approved outpatient plan (getTreatmentPlans → state.plans) is the ONLY
  // authority for a patient's treatment type + weekly frequency. This app is
  // READ-ONLY on it. planForPhone returns { serviceType, frequency } for the one
  // matching plan, or null when it cannot be verified (no match / ambiguous
  // multi-match / plans endpoint down) — callers must BLOCK on null, never fail open.
  function planForPhone(phone) {
    return Plan.forPhone({ phone: phone, plans: state.plans, plansOk: state.plansOk });
  }
  // The Hebrew block copy for a null plan, distinguishing "no approved plan"
  // (plans available — Vered must define one) from "cannot verify" (plans down).
  function planBlockMessage(plan) {
    return Plan.blockMessage(plan, state.plansOk);
  }

  // --- render ------------------------------------------------------------
  function render() {
    syncDropdowns();
    renderDashboard();
    renderAssign();
    renderSchedule();
    renderMine();
    renderStopAlerts();
    updateLeadsBadge();
    updateStopAlertsBadge();
  }

  // Live count of waiting leads (patients needing a non-framework therapist) on
  // the «שיבוץ מטפלים» tab, visible from anywhere. Everyone sees it.
  function updateLeadsBadge() {
    var el = $('#leadsBadge');
    if (!el) return;
    var n = activePatients().filter(needsAssignment).length;
    el.textContent = n;
    el.hidden = n === 0;
  }

  // «עצירת טיפול» tab badge — count of UNREAD stop-treatment alerts (red,
  // attention style). Hidden at zero. Refreshed on load, on tab open, and after
  // every mark-read (incl. optimistic + rollback).
  function updateStopAlertsBadge() {
    var el = $('#stopAlertsBadge');
    if (!el) return;
    var n = StopAlerts.unreadCount(state.stopAlerts);
    el.textContent = n;
    el.hidden = n === 0;
  }

  // One alert row: patient name, created date, an optional Hebrew reason chip,
  // and the note. Unread rows carry a «נקראה» (mark-read) button; read rows are
  // dimmed, show when they were read, and carry a «החזר ללא נקראה» (return to
  // unread) button so a mark-read is reversible. The chip is a render-time
  // localization of the stable reason key; legacy alerts with no/unknown reason
  // get no chip.
  function stopAlertCard(a, isReadGroup) {
    var action = isReadGroup
      ? '<span class="stop-alert-readmeta">נקראה' + (a.readAt ? ' · ' + escapeHtml(displayDate(a.readAt)) : '') + '</span>' +
        '<button class="btn btn-ghost btn-sm stop-alert-unread-btn" data-stop-alert-unread="' + escapeHtml(a.id) + '">החזר ללא נקראה</button>'
      : '<button class="btn btn-primary btn-sm stop-alert-btn" data-stop-alert-read="' + escapeHtml(a.id) + '">נקראה</button>';
    var reasonText = StopAlerts.reasonLabel(a.reason);
    var chip = reasonText
      ? '<span class="stop-alert-reason">' + escapeHtml(reasonText) + '</span>'
      : '';
    return '<div class="stop-alert-row' + (isReadGroup ? ' stop-alert-read' : '') + '">' +
      '<div class="stop-alert-main">' +
        '<span class="stop-alert-name">' + escapeHtml(a.patientName || '—') + '</span>' +
        (a.created ? '<span class="stop-alert-date">' + escapeHtml(displayDate(a.created)) + '</span>' : '') +
        chip +
      '</div>' +
      '<div class="stop-alert-note">' + escapeHtml(a.note || '') + '</div>' +
      '<div class="stop-alert-action">' + action + '</div>' +
      '</div>';
  }

  function renderStopAlerts() {
    var unreadHost = $('#stopAlertsUnread');
    if (!unreadHost) return;
    var notice = $('#stopAlertsNotice');
    if (notice) {
      if (!state.stopAlertsOk) {
        notice.hidden = false;
        notice.textContent = 'התראות עצירת הטיפול אינן זמינות כרגע (תלוי בנקודת הקצה של מטופלי החוץ).';
      } else { notice.hidden = true; }
    }
    var groups = StopAlerts.partition(state.stopAlerts);
    unreadHost.innerHTML = groups.unread.length
      ? groups.unread.map(function (a) { return stopAlertCard(a, false); }).join('')
      : '<div class="billing-empty">אין התראות חדשות</div>';

    var readPanel = $('#stopAlertsReadPanel');
    var readHost = $('#stopAlertsRead');
    if (readPanel && readHost) {
      readPanel.hidden = !groups.read.length;
      readHost.innerHTML = groups.read.map(function (a) { return stopAlertCard(a, true); }).join('');
    }
  }

  // Mark ONE alert read — OPTIMISTIC: flip it locally (it moves to the dimmed
  // «נקראו» group and the badge drops) then persist; on failure ROLL BACK.
  function markStopAlertRead(id) {
    var a = null;
    for (var i = 0; i < state.stopAlerts.length; i++) {
      if (state.stopAlerts[i].id === id) { a = state.stopAlerts[i]; break; }
    }
    if (!a || a.read) return;
    a.read = true;                    // optimistic
    renderStopAlerts();
    updateStopAlertsBadge();
    apiMarkStopAlertRead(id)
      .then(function () { /* persisted; the read state stays */ })
      .catch(function () {
        a.read = false;               // rollback
        renderStopAlerts();
        updateStopAlertsBadge();
        toast('סימון «נקראה» נכשל — נסו שוב', true);
      });
  }

  // Return ONE alert to unread — OPTIMISTIC mirror of markStopAlertRead: clear
  // BOTH read and readAt (isRead treats a lingering readAt as read), so the
  // alert moves back into the unread group and the badge rises; on failure ROLL
  // BACK to the prior read/readAt. Needs the outpatient markStopAlertUnread action.
  function markStopAlertUnread(id) {
    var a = null;
    for (var i = 0; i < state.stopAlerts.length; i++) {
      if (state.stopAlerts[i].id === id) { a = state.stopAlerts[i]; break; }
    }
    if (!a || !StopAlerts.isRead(a)) return;
    var prevRead = a.read;
    var prevReadAt = a.readAt;
    a.read = false; a.readAt = '';    // optimistic
    renderStopAlerts();
    updateStopAlertsBadge();
    apiMarkStopAlertUnread(id)
      .then(function () { /* persisted; the unread state stays */ })
      .catch(function () {
        a.read = prevRead; a.readAt = prevReadAt;   // rollback
        renderStopAlerts();
        updateStopAlertsBadge();
        toast('החזרה ל«לא נקראה» נכשלה — נסו שוב', true);
      });
  }

  function pendingSyncCount() {
    return state.schedule.filter(function (r) { return String(r.syncStatus || '') === 'pending'; }).length;
  }
  function syncBadge(r) {
    if (!r.attendance) return '';
    if (String(r.syncStatus) === 'pending') return ' <span class="chip chip-unpaid">ממתין לסנכרון</span>';
    if (String(r.syncStatus) === 'synced') return ' <span class="chip chip-paid">סונכרן</span>';
    return '';
  }

  function matchName(name, q) {
    if (!q) return true;
    return String(name || '').toLowerCase().indexOf(q.toLowerCase()) !== -1;
  }

  function debtChip(status, owed) {
    if (status === 'clear') return '<span class="chip chip-paid">ללא חוב</span>';
    if (status === 'debt') return '<span class="chip chip-unpaid">חוב ' + money(owed) + '</span>';
    return '';
  }

  // Per-type frequency unit: psychiatric follow-up is MONTHLY, everything else
  // is weekly. Mirrors the outpatient app so the two read identically.
  function freqUnit(treatmentType) {
    return svc(treatmentType) === 'מעקב פסיכיאטרי' ? 'חודש' : 'שבוע';
  }

  // Framework types are part of the plan but are a SETTING/מסגרת, not a
  // therapist-delivered session: they need no therapist, never count as
  // "unassigned", and expect no weekly scheduling. «ליווי יומי בקהילה» is one.
  var FRAMEWORK_TYPES = { 'ליווי יומי בקהילה': true, 'מרכז יום': true };
  function isFrameworkType(treatmentType) {
    return !!FRAMEWORK_TYPES[svc(treatmentType)] || !!FRAMEWORK_TYPES[treatmentType];
  }

  function patientUpcomingAlert(phone) {
    var key = normPhone(phone);
    for (var i = 0; i < state.alerts.length; i++) {
      if (normPhone(state.alerts[i].patientPhone) === key) return state.alerts[i];
    }
    return null;
  }

  // Plan panel: bordered «תוכנית טיפול» box with one cc-line per treatment type.
  // Each line shows: treatment type · frequency · assigned therapist (or
  // «טרם שובץ» when that type has no therapist yet). A patient can have a
  // DIFFERENT therapist per type, so the therapist is shown per-line, not once.
  // «תוכנית טיפול» panel — OUT style: one block per treatment type with the type
  // name on top and «N/שבוע» (or /חודש) below, plus the assigned therapist.
  function planPanelHtml(p) {
    var therByType = {};
    var slotsByType = {};
    (p.assignments || []).forEach(function (a) {
      if (a.treatmentType) {
        therByType[a.treatmentType] = a.therapist || '';
        slotsByType[a.treatmentType] = a.slots;
      }
    });
    var src = (p.planTypes && p.planTypes.length)
      ? p.planTypes
      : (p.assignments || []).map(function (a) { return { treatmentType: a.treatmentType, frequencyPerWeek: a.frequencyPerWeek }; });
    var lines = src.map(function (r) {
      var freqTxt = (r.frequencyPerWeek || r.frequencyPerWeek === 0) ? (r.frequencyPerWeek + '/' + freqUnit(r.treatmentType)) : '—';
      var tagHtml;
      if (isFrameworkType(r.treatmentType)) {
        // Framework (מסגרת) — no therapist. Show WHERE it happens (location set by
        // Yarden on the slots); never «טרם שובץ».
        var locs = Recurring.parseSlots(slotsByType[r.treatmentType])
          .map(function (s) { return s.location ? locationLabel(s.location) : ''; })
          .filter(Boolean);
        var place = locs.length ? locs.join(' · ') : 'מסגרת';
        tagHtml = '<span class="cc-ther cc-framework">' + escapeHtml(place) + '</span>';
      } else {
        var ther = therByType[r.treatmentType];
        tagHtml = ther
          ? '<span class="cc-ther">' + escapeHtml(ther) + '</span>'
          : '<span class="cc-ther cc-unassigned">טרם שובץ</span>';
      }
      return '<div class="cc-line cc-stack">' +
        '<span class="cc-k">' + escapeHtml(svc(r.treatmentType) || '—') + '</span>' +
        '<span class="cc-v">' + escapeHtml(freqTxt) + '</span>' +
        tagHtml +
        '</div>';
    }).join('');
    if (!lines) lines = '<div class="cc-line cc-muted">לא נקבעה תוכנית</div>';
    return '<div class="cc-panel cc-plan">' +
      '<div class="cc-panel-title">תוכנית טיפול</div>' + lines +
      '</div>';
  }

  // «לוז שבועי» panel — per treatment type, the fixed weekly slots as ordered
  // rows: type name, then each «יום · שעה · מיקום · חדר». Empty types are skipped.
  function schedulePanelHtml(p) {
    var blocks = (p.assignments || []).map(function (a) {
      var arr = Recurring.parseSlots(a.slots);
      if (!arr.length) return '';
      var rows = arr.map(function (s) {
        var wd = (WEEKDAY_LABELS[Number(s.weekday)] || '');
        var right = [wd, s.time].filter(Boolean).join(' ');
        var left = [s.location ? locationLabel(s.location) : '', s.room ? ('חדר ' + s.room) : ''].filter(Boolean).join(' · ');
        return '<div class="cc-line cc-sched-line">' +
          '<span class="cc-k">' + escapeHtml(right || '—') + '</span>' +
          '<span class="cc-v">' + escapeHtml(left) + '</span>' +
          '</div>';
      }).join('');
      return '<div class="cc-sched-type">' +
        '<div class="cc-sched-type-name">' + escapeHtml(svc(a.treatmentType) || '—') + '</div>' +
        rows + '</div>';
    }).filter(Boolean).join('');
    if (!blocks) blocks = '<div class="cc-line cc-muted">טרם נקבע לוז</div>';
    return '<div class="cc-panel cc-sched">' +
      '<div class="cc-panel-title">לוז שבועי</div>' + blocks +
      '</div>';
  }

  function patientCard(p) {
    var badges = '';
    if (p.stillAdmitted) badges += ' <span class="chip chip-partial">עדיין מאושפז/ת' + (p.admittedHouse ? ' · ' + escapeHtml(houseLabel(p.admittedHouse)) : '') + '</span>';
    var phoneChip = p.phone ? '<span class="chip">📞 ' + escapeHtml(p.phone) + '</span>' : '';
    var originChip = p.origin ? '<span class="chip">' + escapeHtml(p.origin) + '</span>' : '';
    var top =
      '<div class="cc-top">' +
        '<div class="client-head">' +
          '<div class="client-name">' + escapeHtml(p.name) + badges + '</div>' +
          debtChip(p.debtStatus, p.amountOwed) +
        '</div>' +
        '<div class="client-meta">' + phoneChip + originChip + '</div>' +
      '</div>';
    var alertHtml = '';
    var al = patientUpcomingAlert(p.phone);
    if (al) alertHtml = '<div class="alert-row">⚠️ נכנס/ה לחוב לאחר קביעת הטיפול (' + money(al.amountOwed) + ') — יש לבדוק טיפול עתידי</div>';
    // Dashboard is VIEW-ONLY for everyone — no edit/schedule actions here.
    return '<div class="client-card">' + top +
      '<div class="cc-body cc-body-2">' + planPanelHtml(p) + schedulePanelHtml(p) + '</div>' +
      alertHtml + '</div>';
  }

  function renderDashboard() {
    var list = activePatients();
    var assigned = list.filter(function (p) { return p.therapists.length; }).length;
    $('#kpiPatients').textContent = list.length;
    $('#kpiAssigned').textContent = assigned;
    $('#kpiAlerts').textContent = state.alerts.length;

    var notice = $('#dashboardNotice');
    if (!state.plansOk && !state.debtRosterOk) {
      notice.hidden = false;
      notice.textContent = 'רשימת המטופלים אינה זמינה כרגע (תלוי בנקודות הקצה של מטופלי החוץ).';
    } else { notice.hidden = true; }

    renderAlertBanner($('#alertBanner'));

    var rows = list
      .filter(function (p) { return matchName(p.name, state.dashboardSearch); })
      .sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); })
      .map(function (p) { return patientCard(p); });
    $('#patientsList').innerHTML = rows.length ? rows.join('') : '<div class="billing-empty">אין מטופלים פעילים</div>';

    // Stopped / discharged — read-only history (matches the same search box).
    var stoppedList = $('#stoppedList');
    if (stoppedList) {
      var stopped = stoppedPatients()
        .filter(function (p) { return matchName(p.name, state.dashboardSearch); })
        .sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); });
      var sec = $('#stoppedSection');
      if (sec) sec.hidden = !stopped.length;
      stoppedList.innerHTML = stopped.length ? stopped.map(stoppedCard).join('') : '';
    }
  }

  // A stopped/discharged patient — read-only line: name, why it's stopped
  // (discharged in outpatient vs a stop request pending Vered), and the local
  // who/when/note when we have it.
  function stoppedCard(p) {
    var reason = StopFlow.isStoppedStatus(p.planStatus)
      ? 'סיים טיפול (מטופלי חוץ)'
      : 'בקשת הפסקה ממתינה לאישור ורד';
    var meta = [];
    if (p.stoppedBy) meta.push('ע״י ' + p.stoppedBy);
    if (p.stoppedAt) meta.push(displayDate(p.stoppedAt));
    if (p.stopNote) meta.push(p.stopNote);
    // Only a LOCAL pending stop request is reversible here (a real outpatient
    // discharge is owned by outpatient). Delete is always offered on this list —
    // the cleanup surface — guarded by a naming confirm in the handler.
    var actions = '';
    if (StopFlow.canRestore(p)) {
      actions += '<button class="btn btn-primary btn-sm" data-restore-patient="' + escapeHtml(p.phone) + '">החזר לפעיל</button>';
    }
    actions += '<button class="btn btn-ghost btn-sm btn-danger" data-delete-patient="' + escapeHtml(p.phone) + '">מחק מטופל/ת</button>';
    return '<div class="assign-row stopped-row">' +
      '<span class="assign-name">' + escapeHtml(p.name) + '</span>' +
      '<span class="assign-type">' + escapeHtml(reason) + '</span>' +
      '<span class="assign-ther">' + escapeHtml(meta.join(' · ')) + '</span>' +
      '<span class="assign-actions">' + actions + '</span>' +
      '</div>';
  }

  function renderAlertBanner(el) {
    if (!el) return;
    if (!state.alerts.length) { el.hidden = true; el.innerHTML = ''; return; }
    var names = state.alerts.map(function (a) { return escapeHtml(a.patientName) + ' (' + money(a.amountOwed) + ')'; });
    el.hidden = false;
    el.innerHTML = '⚠️ ' + state.alerts.length + ' מטופלים נכנסו לחוב לאחר קביעת טיפול: ' + names.join(', ') +
      '. יש לבדוק את הטיפולים הקרובים בלשונית «שיבוץ מטפלים».';
    el.style.margin = '6px 0';
  }

  // Schedule rows grouped by session so a group treatment shows as one card.
  function sessionGroups() {
    var groups = {};
    var order = [];
    state.schedule.forEach(function (r) {
      var key = r.sessionId || r.id;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    return order.map(function (k) { return groups[k]; });
  }

  function attendanceChip(r) {
    if (r.attendance === 'occurred') return '<span class="chip chip-paid">התקיים</span>';
    if (r.attendance === 'missed') return '<span class="chip chip-unpaid">לא התקיים</span>';
    return '<span class="chip">טרם סומן</span>';
  }
  // iteration 18 step 2 — the 3-state session outcome chip (storage-only).
  function outcomeChip(r) {
    if (r.outcome === 'happened') return '<span class="chip chip-paid">התקיים</span>';
    if (r.outcome === 'therapist_cancelled') return '<span class="chip chip-partial">המטפל ביטל / לא הגיע</span>';
    if (r.outcome === 'patient_no_show') return '<span class="chip chip-unpaid">המטופל לא הגיע</span>';
    return '<span class="chip">טרם סומן</span>';
  }
  function gateChip(r) {
    if (r.gateStatus === 'approved') return '<span class="chip chip-partial">אושר למרות חוב (' + money(r.amountOwed) + ')</span>';
    if (r.gateStatus === 'flagged') return '<span class="chip chip-unpaid">לבירור</span>';
    if (r.gateStatus === 'clear') return '<span class="chip chip-paid">ללא חוב</span>';
    return '';
  }

  // Read-only line for Vered's oversight list (marking is the therapist's job,
  // done in «המטופלים שלי»).
  function patientLine(r) {
    var al = alertFor(r.id);
    return '<div class="sess-patient">' +
      '<span class="sess-pname">' + escapeHtml(r.patientName) + '</span> ' +
      gateChip(r) + ' ' + outcomeChip(r) + syncBadge(r) +
      (al ? '<div class="alert-row">⚠️ נכנס/ה לחוב לאחר קביעת הטיפול (' + money(al.amountOwed) + ')</div>' : '') +
      '</div>';
  }

  function sessionCard(rows) {
    var head = rows[0];
    var isGroup = rows.length > 1;
    var parts = [];
    parts.push('<div class="sess-head">' +
      '<span class="sess-date">' + escapeHtml(displayDateTime(head.scheduledDate, head.time)) + '</span>' +
      '<span class="chip">' + escapeHtml(svc(head.treatmentType)) + (isGroup ? ' · ' + rows.length + ' מטופלים' : '') + '</span>' +
      '<span class="chip">' + escapeHtml(locationLabel(head.location)) + '</span>' +
      '<span class="sess-therapist">' + escapeHtml(head.therapist) + '</span>' +
      '</div>');
    parts.push('<div class="sess-patients">' + rows.map(patientLine).join('') + '</div>');
    return '<div class="billing-row">' + parts.join('') + '</div>';
  }

  function renderSchedule() {
    var all = state.schedule;
    $('#kpiScheduled').textContent = all.length;
    var t = today();
    var upcoming = all.filter(function (r) {
      return (r.attendance === '') && fmtDate(r.scheduledDate) >= t;
    }).length;
    $('#kpiUpcoming').textContent = upcoming;
    $('#kpiScheduleAlerts').textContent = state.alerts.length;

    // Filter treatments by therapist AND by patient name.
    var groups = sessionGroups().filter(function (rows) {
      var byTher = !state.workflowTherapist || rows[0].therapist === state.workflowTherapist;
      var byName = rows.some(function (r) { return matchName(r.patientName, state.workflowSearch); });
      return byTher && byName;
    });
    groups.sort(function (a, b) { return String(b[0].scheduledDate || '').localeCompare(String(a[0].scheduledDate || '')); });
    var cards = groups.map(sessionCard);
    $('#scheduleList').innerHTML = cards.length ? cards.join('') : '<div class="billing-empty">אין טיפולים שנקבעו</div>';
  }

  // Compact patient list for the שיבוץ tab — ensures a newly registered patient
  // (local intake) is immediately available for assignment/scheduling here, not
  // only on the dashboard. Filterable by therapist (assigned) AND patient name.
  // A patient "needs assignment" (is a NEW LEAD) when at least one NON-framework
  // plan type still has no therapist. Framework types (ליווי יומי בקהילה) never
  // count — they're a setting, not a therapist session.
  function needsAssignment(p) {
    var assignedTypes = {};
    (p.assignments || []).forEach(function (a) {
      if (a.therapist && a.treatmentType) assignedTypes[a.treatmentType] = true;
    });
    var types = (p.planTypes && p.planTypes.length) ? p.planTypes : (p.assignments || []);
    return types.some(function (t) {
      var tt = t.treatmentType;
      return tt && !isFrameworkType(tt) && !assignedTypes[tt];
    });
  }

  function renderAssign() {
    var list = activePatients().filter(function (p) {
      var byTher = !state.workflowTherapist || p.therapists.indexOf(state.workflowTherapist) !== -1;
      return byTher && matchName(p.name, state.workflowSearch);
    }).sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); });

    function rowHtml(p) {
      var unassigned = needsAssignment(p);
      var thers = unassigned ? '<em class="assign-pending">טרם שובץ</em>' : escapeHtml(p.therapists.join(', '));
      var assignBtn = unassigned
        ? '<button class="btn btn-primary btn-sm" data-assignments-patient="' + escapeHtml(p.phone) + '">שבץ מטפל</button>'
        : '<button class="btn btn-primary btn-sm" data-assignments-patient="' + escapeHtml(p.phone) + '">עריכה</button>';
      return '<div class="assign-row' + (unassigned ? ' assign-row-pending' : ' assign-row-assigned') + '">' +
        '<span class="assign-name">' + escapeHtml(p.name) + (unassigned ? ' <span class="lead-new-tag">חדש</span>' : '') + '</span>' +
        '<span class="assign-ther"><span class="assign-ther-label">מטפל</span>' + thers + '</span>' +
        '<span class="assign-type">' + (assignmentSummary(p, false) ? escapeHtml(assignmentSummary(p, false)) : '—') + '</span>' +
        '<span class="assign-actions">' +
          '<button class="btn btn-ghost btn-sm" data-edit-patient="' + escapeHtml(p.phone) + '">פרטים</button>' +
          assignBtn +
          '<button class="btn btn-ghost btn-sm btn-danger" data-stop-patient="' + escapeHtml(p.phone) + '">הפסקת טיפול</button>' +
        '</span>' +
        '</div>';
    }

    // New leads = approved plan, ZERO assignments. Two side-by-side columns:
    // unassigned leads on one side, assigned patients on the other.
    var leads = list.filter(needsAssignment);
    var assigned = list.filter(function (p) { return !needsAssignment(p); });
    var leadsCol =
      '<div class="assign-col assign-col-leads">' +
        '<div class="assign-section-title assign-title-leads">לידים חדשים — טרם שובצו (' + leads.length + ')</div>' +
        (leads.length ? leads.map(rowHtml).join('') : '<div class="billing-empty">אין לידים חדשים</div>') +
      '</div>';
    var assignedCol =
      '<div class="assign-col assign-col-assigned">' +
        '<div class="assign-section-title assign-title-assigned">מטופלים משובצים (' + assigned.length + ')</div>' +
        (assigned.length ? assigned.map(rowHtml).join('') : '<div class="billing-empty">—</div>') +
      '</div>';
    $('#assignList').innerHTML = list.length
      ? '<div class="assign-columns">' + leadsCol + assignedCol + '</div>'
      : '<div class="billing-empty">אין מטופלים</div>';
  }

  // Outcome/report + edit buttons for ONE session row (shared by the therapist
  // card's per-session lines). Extracted so the card can reuse it.
  function sessionOutcomeButtons(r) {
    var outcomeBtns = Outcome.VALUES.map(function (v) {
      var on = r.outcome === v;
      return '<button class="btn btn-ghost btn-sm outcome-btn outcome-' + v + (on ? ' is-active' : '') +
        '" data-mine-outcome="' + v + '" data-id="' + escapeHtml(r.id) + '" aria-pressed="' + on + '">' +
        escapeHtml(Outcome.labelFor(v)) + '</button>';
    }).join('');
    return '<span class="att-btns outcome-picker" role="group" aria-label="תוצאת הטיפול">' +
      outcomeBtns +
      (r.recurring ? '' :
        '<button class="btn btn-ghost btn-sm" data-edit-booking="' + escapeHtml(r.id) + '">עריכה</button>' +
        (Scheduling.canCancelBooking(r) ? '<button class="btn btn-ghost btn-sm btn-danger" data-cancel-booking="' + escapeHtml(r.id) + '">ביטול</button>' : '')) +
      '</span>';
  }

  // The therapist's full patient card: dashboard-style plan + weekly schedule
  // panels, then this patient's upcoming sessions each with report buttons
  // (התקיים / לא התקיים …) so the therapist manages everything in one place.
  function myPatientCard(p, sessions) {
    var phoneChip = p.phone ? '<span class="chip">📞 ' + escapeHtml(p.phone) + '</span>' : '';
    var head =
      '<div class="cc-top">' +
        '<div class="client-head">' +
          '<div class="client-name">' + escapeHtml(p.name) + '</div>' +
          debtChip(p.debtStatus, p.amountOwed) +
        '</div>' +
        '<div class="client-meta">' + phoneChip + '</div>' +
      '</div>';
    var panels = '<div class="cc-body cc-body-2">' + planPanelHtml(p) + schedulePanelHtml(p) + '</div>';
    var sess = (sessions || []).slice().sort(function (a, b) {
      return String(a.scheduledDate).localeCompare(String(b.scheduledDate));
    });
    var sessHtml = '';
    if (sess.length) {
      sessHtml = '<div class="cc-panel cc-sessions"><div class="cc-panel-title">מפגשים לדיווח</div>' +
        sess.map(function (r) {
          return '<div class="cc-session-row">' +
            '<span class="cc-session-when">' + escapeHtml(displayDateTime(r.scheduledDate, r.time)) +
              (r.recurring ? ' <span class="recurring-tag">קבוע</span>' : '') + '</span>' +
            '<span class="cc-session-type">' + escapeHtml(svc(r.treatmentType)) + '</span>' +
            sessionOutcomeButtons(r) +
            '</div>';
        }).join('') +
        '</div>';
    }
    var actions = '<div class="cc-card-actions">' +
      '<button class="btn btn-primary btn-sm" data-weekly-patient="' + escapeHtml(p.phone) + '">לוז שבועי קבוע</button>' +
      '<button class="btn btn-ghost btn-sm" data-schedule-patient="' + escapeHtml(p.phone) + '">+ קביעת טיפול</button>' +
      '<button class="btn btn-ghost btn-sm btn-danger" data-stop-patient="' + escapeHtml(p.phone) + '">הפסקת טיפול</button>' +
      '</div>';
    return '<div class="client-card">' + head + panels + sessHtml + actions + '</div>';
  }

  // New-assignment alerts everyone sees, each dismissible («ראיתי»). Global:
  // dismissing hides it for all. Shown regardless of which therapist is picked.
  function renderNotifications() {
    var el = $('#notifBanner');
    if (!el) return;
    var live = (state.notifications || []).filter(function (n) {
      return String(n.dismissed) !== 'true';
    }).sort(function (a, b) { return String(b.created).localeCompare(String(a.created)); });
    if (!live.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="notif-title">🔔 שיבוצים חדשים</div>' +
      live.map(function (n) {
        return '<div class="notif-item">' +
          '<span class="notif-text">' + escapeHtml(n.patientName || 'מטופל/ת') +
            ' שובץ/ה ל' + escapeHtml(n.therapist) +
            (n.treatmentType ? ' · ' + escapeHtml(svc(n.treatmentType)) : '') + '</span>' +
          '<button class="btn btn-ghost btn-sm" data-dismiss-notif="' + escapeHtml(n.id) + '">ראיתי</button>' +
          '</div>';
      }).join('');
  }

  // Export the selected therapist's patients (plan + weekly schedule) and their
  // upcoming sessions to a CSV (UTF-8 BOM so Excel renders Hebrew correctly).
  function exportMyPatients() {
    if (!hasTherapist()) { toast('בחר/י את שמך כדי לייצא', true); return; }
    var myPatients = activePatients().filter(function (p) {
      return (p.therapists || []).indexOf(state.therapist) !== -1;
    });
    var sessions = state.schedule
      .filter(function (r) { return r.therapist === state.therapist; })
      .concat(buildOccurrences());
    var csv = Exporter.buildCsv({
      therapistName: state.therapist,
      patients: myPatients,
      sessions: sessions,
      svc: svc, locationLabel: locationLabel, freqUnit: freqUnit, isFramework: isFrameworkType
    });
    // Prepend UTF-8 BOM so Excel opens Hebrew correctly.
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = Exporter.fileName(state.therapist);
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('הקובץ יוצא');
  }

  function renderMine() {
    renderNotifications();    var panels = ['#myPatientsPanel', '#mineScheduledPanel', '#mineUpcomingPanel', '#minePerformedPanel', '#mineNotPerformedPanel'];

    // No name picked yet → prompt, hide everything else (notifications still show).
    if (!hasTherapist()) {
      $('#mineEmpty').hidden = false;
      $('#syncBanner').hidden = true;
      panels.forEach(function (s) { $(s).hidden = true; });
      return;
    }
    $('#mineEmpty').hidden = true;
    $('#myPatientsPanel').hidden = false;

    // My assigned patients (I am one of their assigned therapists).
    var myPatients = activePatients().filter(function (p) {
      return p.therapists.indexOf(state.therapist) !== -1 && matchName(p.name, state.mineSearch);
    }).sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); });
    var mpList = $('#myPatientsList');
    // My assigned patients → one full card each (plan + schedule + sessions to
    // report). Sessions for the coming week (real bookings + virtual recurring
    // occurrences) are grouped per patient and shown inside their card.
    state.occurrences = buildOccurrences();
    var sessions = state.schedule
      .filter(function (r) { return r.therapist === state.therapist; })
      .concat(state.occurrences);
    var byPhone = {};
    sessions.forEach(function (r) {
      var k = normPhone(r.patientPhone);
      (byPhone[k] = byPhone[k] || []).push(r);
    });
    var mpList = $('#myPatientsList');
    if (mpList) {
      mpList.innerHTML = myPatients.length
        ? myPatients.map(function (p) { return myPatientCard(p, byPhone[normPhone(p.phone)] || []); }).join('')
        : '<div class="billing-empty">אין מטופלים משויכים אליך עדיין.</div>';
    }

    var pending = pendingSyncCount();
    var banner = $('#syncBanner');
    if (pending > 0) {
      banner.hidden = false;
      banner.innerHTML = '⚠️ ' + pending + ' סימוני טיפול ממתינים לסנכרון למערכת התשלומים. ' +
        '<button id="syncNowBtn" class="btn btn-ghost btn-sm">סנכרן עכשיו</button>';
    } else { banner.hidden = true; banner.innerHTML = ''; }
    // Legacy bucket panels are retired in favour of per-patient cards.
    ['#mineScheduledPanel', '#mineUpcomingPanel', '#minePerformedPanel', '#mineNotPerformedPanel'].forEach(function (s) {
      if ($(s)) $(s).hidden = true;
    });
  }

  function syncNow() {
    toast('מסנכרן…');
    apiSyncPending()
      .then(function () { return loadOwn(); })
      .then(function () {
        var left = pendingSyncCount();
        toast(left ? (left + ' עדיין ממתינים לסנכרון') : 'סונכרן');
      })
      .catch(function (err) { toast('שגיאה בסנכרון: ' + err.message, true); });
  }

  // --- dropdown / datalist sync -----------------------------------------
  function activeTherapistNames() { return Scheduling.activeNames(state.therapists); }
  function activeTypeNames() { return Scheduling.activeNames(state.treatmentTypes); }

  function optionList(names, selected) {
    return ['<option value="">—</option>'].concat(names.map(function (n) {
      var sel = (n === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(n) + '"' + sel + '>' + escapeHtml(n) + '</option>';
    })).join('');
  }
  // Treatment-type options: value is the stored string, LABEL is relabeled so a
  // legacy 'מרכז יום' entry shows as 'ליווי יומי בקהילה' (and the seeded new
  // term shows directly). The 5 individual-billing types (ClinicalSync) are
  // nested under one 'פרטני' <optgroup> — DISPLAY ONLY: every option keeps its
  // own distinct value, so the saved treatmentType stays the specific clinical
  // name, never the group label. Every other active type stays inline.
  function typeOptionList(selected) {
    function opt(n) {
      var sel = (n === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(n) + '"' + sel + '>' + escapeHtml(svc(n)) + '</option>';
    }
    var names = activeTypeNames();
    var part = ClinicalSync.partitionTypes(names);
    var parts = ['<option value="">—</option>'];
    var groupPlaced = false;
    names.forEach(function (n) {
      if (ClinicalSync.isIndividualBillingType(n)) {
        // Emit the whole פרטני group once, at the position of its first member.
        if (!groupPlaced) {
          parts.push('<optgroup label="' + escapeHtml(ClinicalSync.GROUP_LABEL) + '">' +
            part.grouped.map(opt).join('') + '</optgroup>');
          groupPlaced = true;
        }
        return;
      }
      parts.push(opt(n));
    });
    return parts.join('');
  }
  // Resolve a stored/legacy plan type to a value that EXISTS in the type list,
  // mapping the relabeled term (מרכז יום → ליווי יומי בקהילה) when needed.
  function resolveTypeOption(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    var names = activeTypeNames();
    if (names.indexOf(v) !== -1) return v;
    var relabeled = svc(v);
    return (names.indexOf(relabeled) !== -1) ? relabeled : v;
  }
  function locationOptions(selected) {
    return ['<option value="">—</option>'].concat(LOCATIONS.map(function (l) {
      var sel = (l.id === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(l.id) + '"' + sel + '>' + escapeHtml(l.he) + '</option>';
    })).join('');
  }
  function houseOptions(selected) {
    return ['<option value="">—</option>'].concat(ORIGIN_HOUSES.map(function (h) {
      var sel = (h.id === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(h.id) + '"' + sel + '>' + escapeHtml(h.he) + '</option>';
    })).join('');
  }
  // 30-minute time slots 07:00–21:00 for the scheduling dropdowns.
  function timeOptions(selected) {
    return ['<option value="">—</option>'].concat(Scheduling.timeSlots('07:00', '21:00', 30).map(function (t) {
      var sel = (t === selected) ? ' selected' : '';
      return '<option value="' + t + '"' + sel + '>' + t + '</option>';
    })).join('');
  }

  function syncDropdowns() {
    var tNames = activeTherapistNames();
    var st = $('#scheduleTherapist'); if (st) st.innerHTML = optionList(tNames, state.therapist);
    var pt = $('#patientTherapist'); if (pt) pt.innerHTML = '<option value="">— לא שויך —</option>' +
      tNames.map(function (n) { return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; }).join('');
    var sty = $('#scheduleType'); if (sty) { var styv = sty.value; sty.innerHTML = typeOptionList(); sty.value = styv; }
    var pty = $('#patientType'); if (pty) { var ptyv = pty.value; pty.innerHTML = typeOptionList(); pty.value = ptyv; }
    var sl = $('#scheduleLocation'); if (sl) sl.innerHTML = locationOptions();
    var stime = $('#scheduleTime'); if (stime) { var stv = stime.value; stime.innerHTML = timeOptions(); stime.value = stv; }
    var ah = $('#admittedHouse'); if (ah) ah.innerHTML = houseOptions();
    // Identity-screen name picker.
    // Tab-3 name picker — preserve the current pick across re-renders.
    var mt = $('#mineTherapist'); if (mt) { mt.innerHTML = optionList(tNames, state.therapist); mt.value = state.therapist || ''; }
    var wf = $('#workflowTherapistFilter'); if (wf) wf.innerHTML = '<option value="">כל המטפלים</option>' +
      tNames.map(function (n) { var s = (n === state.workflowTherapist) ? ' selected' : ''; return '<option value="' + escapeHtml(n) + '"' + s + '>' + escapeHtml(n) + '</option>'; }).join('');

    // Intake (Vered) name picker — the FULL active roster (registering anyone).
    var roster = activePatients();
    var names = roster.map(function (p) { return p.name; }).filter(Boolean);
    var rn = $('#rosterNames');
    if (rn) rn.innerHTML = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    // Schedule-modal patient pickers — ONLY patients assigned to this therapist
    // (individual and group alike); a therapist can never schedule someone else's
    // patient. Empty when they have no assigned patients.
    var assignedNames = assignedPatientNames();
    $$('.patient-name-dl').forEach(function (dl) {
      dl.innerHTML = assignedNames.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    });
    var os = $('#originSuggestions');
    if (os) os.innerHTML = ORIGIN_HOUSES.map(function (h) { return '<option value="' + escapeHtml(h.he) + '"></option>'; }).join('');
  }

  // --- schedule modal ----------------------------------------------------
  function patientRowHtml(idx, prefill) {
    prefill = prefill || {};
    return '<div class="patient-row" data-idx="' + idx + '">' +
      '<input class="patient-name" name="pname" list="pdl' + idx + '" placeholder="שם מטופל/ת" autocomplete="off" value="' + escapeHtml(prefill.name || '') + '" />' +
      '<datalist id="pdl' + idx + '" class="patient-name-dl"></datalist>' +
      '<input class="patient-phone" name="pphone" inputmode="tel" placeholder="0501234567" value="' + escapeHtml(prefill.phone || '') + '" />' +
      '<button type="button" class="btn btn-ghost btn-sm remove-patient" title="הסר">✕</button>' +
      '</div>';
  }
  var patientRowSeq = 0;
  function addPatientRow(prefill) {
    var wrap = $('#patientRows');
    var div = document.createElement('div');
    div.innerHTML = patientRowHtml(++patientRowSeq, prefill);
    var node = div.firstChild;
    wrap.appendChild(node);
    syncDropdowns();
    return node;
  }
  function patientRowsData() {
    return $$('#patientRows .patient-row').map(function (row) {
      return {
        name: (row.querySelector('.patient-name').value || '').trim(),
        phone: (row.querySelector('.patient-phone').value || '').trim()
      };
    }).filter(function (p) { return p.name || p.phone; });
  }
  function updateGroupUi() {
    var type = $('#scheduleType').value;
    var isGroup = Scheduling.isGroupType(type, state.treatmentTypes);
    $('#addPatientRowBtn').hidden = !isGroup;
    $('#patientsSectionTitle').textContent = isGroup ? 'מטופלים בקבוצה' : 'מטופל/ת';
    $$('#patientRows .remove-patient').forEach(function (b) { b.style.visibility = isGroup ? 'visible' : 'hidden'; });
  }

  // --- treatment-type plan lock (INDIVIDUAL / single-patient path) -------
  // The type is locked to the chosen patient's approved plan so a therapist can't
  // schedule a treatment the patient has no plan for. (Group sessions are exempt
  // per product decision — there the patient-set restriction alone applies.) This
  // SUPERSEDES the earlier schedule-side scheduleLockedType; the שיבוץ assignment
  // modal's plan lock (planForPhone / Plan.assignmentPayload) is untouched.
  function setPlanNote(msg) {
    var el = $('#schedulePlanLock'); if (!el) return;
    el.textContent = msg || ''; el.hidden = !msg;
  }
  // Options built from a specific set of plan types (NOT the global type list);
  // value is the resolved/relabeled type that the store + gate expect.
  function planTypeOptions(types, selected) {
    return types.map(function (t) {
      var v = resolveTypeOption(t);
      var sel = (v === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(v) + '"' + sel + '>' + escapeHtml(svc(t)) + '</option>';
    }).join('');
  }
  // Restore the full, editable type list (no patient chosen, or a group session).
  function unlockType() {
    var typeEl = $('#scheduleType'); var cur = typeEl.value;
    typeEl.innerHTML = typeOptionList(cur); typeEl.value = cur;
    typeEl.disabled = false; setPlanNote('');
  }
  function applyPlanLock(types) {
    var typeEl = $('#scheduleType');
    var st = Scheduling.planLockState(types);
    if (st.mode === 'blocked') {
      typeEl.innerHTML = '<option value="">—</option>'; typeEl.value = '';
      typeEl.disabled = true; planBlocked = true;
      setPlanNote('אין תכנית טיפול מאושרת למטופל/ת זו — לא ניתן לקבוע'); return;
    }
    planBlocked = false;
    if (st.mode === 'locked') {
      var v = resolveTypeOption(st.types[0]);
      typeEl.innerHTML = planTypeOptions(st.types, v); typeEl.value = v;
      typeEl.disabled = true;
      setPlanNote('סוג הטיפול נקבע לפי תכנית הטיפול של המטופל/ת');
    } else {            // 'choose' — pick among ONLY this patient's plan types
      var allowed = st.types.map(resolveTypeOption);
      var keep = allowed.indexOf(typeEl.value) !== -1 ? typeEl.value : '';
      typeEl.innerHTML = '<option value="">— בחר/י —</option>' + planTypeOptions(st.types, keep);
      typeEl.value = keep; typeEl.disabled = false;
      setPlanNote('בחר/י מבין סוגי הטיפול בתכנית של המטופל/ת');
    }
  }
  function updateSubmitEnabled() {
    var sub = $('#scheduleSubmit');
    sub.disabled = planBlocked || !assignedPatients().length;
  }
  // Re-evaluate the type lock whenever the chosen patient changes. A group session
  // (group type) or a multi-patient set is exempt — the full type list stays.
  function refreshTypeLock() {
    var typeEl = $('#scheduleType');
    var rows = $$('#patientRows .patient-row');
    if (Scheduling.isGroupType(typeEl.value, state.treatmentTypes) || rows.length > 1) {
      unlockType(); planBlocked = false; updateSubmitEnabled(); return;
    }
    var p = resolveAssignedPatientForRow(rows[0]);
    if (!p) { unlockType(); planBlocked = false; updateSubmitEnabled(); return; }
    applyPlanLock(Scheduling.assignedTypesForPatient(p, state.therapist));
    updateGroupUi();
    updateSubmitEnabled();
  }

  function openScheduleModal(prefillPatient) {
    if (!ensureTherapist()) return;
    var form = $('#scheduleForm');
    form.reset();
    resetGateResults();
    form.querySelector('[name="scheduledDate"]').value = today();
    $('#patientRows').innerHTML = '';
    patientRowSeq = 0;
    addPatientRow(prefillPatient || {});
    // syncDropdowns ran inside addPatientRow; now apply defaults. The therapist
    // schedules as THEMSELVES — lock the therapist field to their identity.
    var th = $('#scheduleTherapist');
    th.value = state.therapist || (prefillPatient && prefillPatient.therapist) || '';
    th.disabled = true;
    if (prefillPatient && prefillPatient.treatmentType) $('#scheduleType').value = resolveTypeOption(prefillPatient.treatmentType);
    updateGroupUi();
    // A therapist with no assigned patients can't schedule anyone — say so plainly.
    $('#scheduleNoPatients').hidden = assignedPatients().length > 0;
    // Lock the type to the (prefilled) patient's plan on the individual path.
    refreshTypeLock();
    $('#scheduleModal').hidden = false;
  }
  function closeScheduleModal() { $('#scheduleModal').hidden = true; resetGateResults(); }
  function resetGateResults() {
    pendingPatients = null;
    var g = $('#gateResults');
    g.hidden = true; g.innerHTML = '';
    $('#scheduleSubmit').textContent = 'בדוק ושמור';
  }

  function readSession() {
    var fd = new FormData($('#scheduleForm'));
    // Read the type from the live select (not FormData): when the plan lock
    // disables #scheduleType for a single-plan patient, a disabled control is
    // omitted from FormData — the element's .value still carries the locked type.
    var typeEl = $('#scheduleType');
    return {
      // A therapist always schedules as themselves (the select is locked).
      therapist: state.therapist || (fd.get('therapist') || '').trim(),
      treatmentType: ((typeEl && typeEl.value) || fd.get('treatmentType') || '').trim(),
      location: (fd.get('location') || '').trim(),
      room: (fd.get('room') || '').trim(),
      scheduledDate: fd.get('scheduledDate') || '',
      time: fd.get('time') || ''
    };
  }

  // Monthly package-cap status for ONE patient + the session's treatment type,
  // for the month of the booking. Uses the existing plan (state.assignments) and
  // bookings (state.schedule), both keyed by normalized phone. A therapist-
  // cancelled session does NOT consume quota (mirrors the credits rule), so it is
  // excluded from usage. Returns the Quota.checkAdd shape, or null when we lack
  // the data to judge (no plan rows for this patient → don't warn spuriously).
  function quotaStatusFor(phone, treatmentType, scheduledDate) {
    if (!window.Quota) return null;
    var key = normPhone(phone);
    var assignments = (state.assignments || []).filter(function (a) {
      return normPhone(a.patientPhone) === key;
    });
    // No plan at all for this patient → we can't define a cap; skip the warning.
    if (!assignments.length) return null;
    var bookings = (state.schedule || []).filter(function (r) {
      return normPhone(r.patientPhone) === key;
    });
    return Quota.checkAdd({
      assignments: assignments,
      bookings: bookings,
      month: Quota.monthKey(scheduledDate),
      treatmentType: treatmentType,
      countsBooking: function (b) { return b.outcome !== 'therapist_cancelled'; }
    });
  }

  function renderGateResults() {
    var g = $('#gateResults');
    var session = readSession();
    var rowsHtml = pendingPatients.map(function (pp, i) {
      var d = pp.gate.decision;
      var status, body = '';
      if (d === 'allow') { status = '<span class="chip chip-paid">ללא חוב</span>'; }
      else if (d === 'block') {
        status = '<span class="chip chip-unpaid">חוב פתוח ' + money(pp.gate.amountOwed) + '</span>';
        body = '<div class="gate-approval">' +
          '<select class="approver-sel" data-i="' + i + '"><option value="">— מאשר/ת —</option>' +
          '<option value="ron">רון</option><option value="sandra">סנדרה</option></select>' +
          '<input class="approver-note" data-i="' + i + '" placeholder="הערת אישור" />' +
          '</div>';
      } else {
        status = '<span class="chip chip-unpaid">לבירור</span>';
        body = '<div class="gate-flag">' + (FLAG_TEXT[pp.gate.reason] || 'דרוש בירור ידני.') + '</div>';
      }
      // Soft package-cap warning (does NOT block). If this booking would push the
      // patient past their monthly quota for this treatment type, warn Yarden;
      // she can still proceed — the over-cap session is flagged for Vered (step 3).
      var q = quotaStatusFor(pp.phone, session.treatmentType, session.scheduledDate);
      var capWarn = '';
      if (q && q.willExceed) {
        capWarn = '<div class="cap-warn">⚠️ מעבר לחבילה החודשית — ' +
          escapeHtml(svc(session.treatmentType)) + ': נוצלו ' + q.used + ' מתוך ' + q.quota +
          ' החודש. דרוש אישור ורד לטיפול נוסף; ניתן לשמור והבקשה תועבר לאישור.</div>';
      }
      return '<div class="gate-patient">' +
        '<div class="gate-pname">' + escapeHtml(pp.name) + ' <span class="muted">' + escapeHtml(pp.phone) + '</span> ' + status + '</div>' +
        capWarn + body + '</div>';
    }).join('');
    var anyBlock = pendingPatients.some(function (pp) { return pp.gate.decision === 'block'; });
    g.hidden = false;
    g.innerHTML = '<div class="form-section-title">בדיקת חוב למטופלים</div>' + rowsHtml;
    // A debtor needs approval; everything else (clear / flagged-for-review) just saves.
    $('#scheduleSubmit').textContent = anyBlock ? 'אשר ושמור' : 'שמור';
  }

  async function handleScheduleSubmit() {
    var sub = $('#scheduleSubmit');
    if (sub.disabled) return;
    var session = readSession();

    // Phase 2 — gate already ran, build rows from the resolved decisions.
    // (lookup_failed is treated as a flag → saved for review, NOT a retry
    // dead-end: when the debt endpoint is down, scheduling still completes.)
    if (pendingPatients) {
      return finalizeSchedule(session);
    }

    // Phase 1 — resolve patients first (we need canonical phones to key each
    // record), then validate the session + the assigned-patient restriction, then
    // run the gate.
    var rawPatients = patientRowsData();
    if (!rawPatients.length) { toast('יש להזין מטופל/ת אחד לפחות', true); return; }

    var patients = [];
    for (var i = 0; i < rawPatients.length; i++) {
      var rp = rawPatients[i];
      if (!rp.name) { toast('חסר שם מטופל/ת', true); return; }
      var pv = Phone.toCanonical(rp.phone);    // normalize then validate; store normalized
      if (!pv.ok) { toast(rp.name + ': ' + pv.error, true); return; }
      patients.push({ name: rp.name, phone: pv.value });
    }

    var sv = Scheduling.validateSession(session);
    if (!sv.ok) { toast(sv.error, true); return; }
    var isGroup = Scheduling.isGroupType(session.treatmentType, state.treatmentTypes);
    if (!isGroup && rawPatients.length > 1) { toast('סוג טיפול זה מאפשר מטופל/ת אחד בלבד', true); return; }

    // Authoritative restriction: every patient must be assigned to THIS therapist
    // (individual AND group), and for an individual session the chosen type must
    // match the patient's approved plan. Never fail open. Mirrors the UI plan lock
    // and supersedes the prior schedule-side plan check.
    var assignedCheck = Scheduling.validateScheduledPatients(
      patients.map(function (p) { return { name: p.name, key: normPhone(p.phone) }; }),
      assignedPatients(),
      { therapist: state.therapist, isGroup: isGroup, treatmentType: session.treatmentType }
    );
    if (!assignedCheck.ok) { toast(assignedCheck.error, true); return; }

    sub.disabled = true;
    sub.textContent = 'בודק חוב…';
    var roster;
    try { roster = await refreshDebtRoster(); }
    catch (e) { roster = { roster: [], rosterOk: false }; }
    pendingPatients = Scheduling.evaluateGroup({ patients: patients, roster: roster.roster, rosterOk: roster.rosterOk });
    sub.disabled = false;
    renderGateResults();
  }

  function finalizeSchedule(session) {
    var sub = $('#scheduleSubmit');
    var patients = [];
    for (var i = 0; i < pendingPatients.length; i++) {
      var pp = pendingPatients[i];
      var d = pp.gate.decision;
      if (d === 'allow') {
        patients.push({ name: pp.name, phone: pp.phone, gateStatus: Scheduling.gateStatusForDecision(d) });
      } else if (d === 'flag') {
        // Any flag — including lookup_failed (debt endpoint down) — saves as
        // 'flagged' for manual resolution. Never silently 'clear', never a dead-end.
        patients.push({ name: pp.name, phone: pp.phone, gateStatus: Scheduling.gateStatusForDecision(d), gateReason: pp.gate.reason });
      } else if (d === 'block') {
        var sel = $('.approver-sel[data-i="' + i + '"]');
        var note = $('.approver-note[data-i="' + i + '"]');
        var stamp = Approval.buildApproval({
          approver: sel ? sel.value : '',
          patientName: pp.name, patientPhone: pp.phone,
          therapist: session.therapist,
          note: note ? note.value : '',
          amountOwed: pp.gate.amountOwed
        });
        if (!stamp.ok) { toast(pp.name + ': ' + stamp.error, true); return; }
        patients.push({
          name: pp.name, phone: pp.phone, gateStatus: 'approved',
          amountOwed: stamp.approval.amountOwed,
          approverId: stamp.approval.approverId, approverName: stamp.approval.approverName,
          approvalNote: stamp.approval.note, approvedAt: stamp.approval.approvedAt
        });
      }
    }
    if (!patients.length) { toast('אין מטופלים לשמירה', true); return; }

    // Capture who is OVER the monthly package for this session's type — these
    // become extra-session approval requests to Vered after the save succeeds.
    var overCap = [];
    patients.forEach(function (p) {
      var q = quotaStatusFor(p.phone, session.treatmentType, session.scheduledDate);
      if (q && q.willExceed) {
        overCap.push({
          phone: p.phone, patientName: p.name,
          treatmentType: session.treatmentType, therapist: session.therapist,
          monthKey: Quota.monthKey(session.scheduledDate),
          quota: q.quota, used: q.used, requestedBy: session.therapist
        });
      }
    });

    var rows = Scheduling.buildSessionRows(session, patients, {
      sessionId: 's_' + uid(), idFn: function () { return uid(); }, now: today()
    });
    var nameById = {};
    rows.forEach(function (r) { nameById[r.id] = r.patientName; });
    var anyFlagged = patients.some(function (p) { return p.gateStatus === 'flagged'; });
    sub.disabled = true;
    apiSaveSession(rows)
      .then(function (res) {
        var failed = (res.results || []).filter(function (r) { return !r.ok; });
        if (failed.length) {
          var who = failed.map(function (f) { return (nameById[f.id] || '') + ' (' + saveErrorText(f.error) + ')'; });
          toast('חלק מהמטופלים לא נקבעו: ' + who.join('; '), true);
        } else if (anyFlagged) {
          toast('נשמר לבירור — לא ניתן לאמת חוב כרגע');
        } else {
          toast('הטיפול נקבע');
        }
        // Fire extra-session approval requests for over-cap patients. Non-fatal:
        // the booking is already saved; a failed request just won't reach Vered.
        if (overCap.length) {
          overCap.forEach(function (req) {
            apiPost(Object.assign({ action: 'requestExtraSession' }, req)).catch(function () {});
          });
          toast('בקשת אישור לטיפול נוסף נשלחה לוורד', false);
        }
        return loadOwn();
      })
      .then(function () { closeScheduleModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); sub.disabled = false; });
  }

  // Friendly Hebrew for the server-authoritative rejection codes (mirrors
  // treatment-guard.js). These fire when the live re-read disagrees with the
  // browser's gate — usually a patient who fell into debt since the check.
  var SAVE_ERROR_TEXT = {
    debt_verification_failed: 'נמצא חוב בבדיקה החוזרת — נדרש אישור',
    debt_verification_unavailable: 'בדיקת החוב אינה זמינה — לא ניתן לאשר',
    debt_verification_unconfigured: 'בדיקת החוב אינה מוגדרת בשרת',
    invalid_approver: 'מאשר/ת לא מורשה',
    invalid_gate_status: 'סטטוס שער לא תקין',
    invalid_phone: 'מספר טלפון לא תקין (נדרשות 10 ספרות, מתחיל ב-0)',
    debt_block: 'נמצא חוב בבדיקה החוזרת — נדרש אישור רון/סנדרה כדי לדווח ביצוע',
    // Stop-flag UNDO (restore / delete) — fail-closed reasons from resolveStopFlag.
    stop_flag_unconfigured: 'סנכרון בקשות ההפסקה אינו מוגדר בשרת — לא ניתן לבטל',
    resolve_failed: 'לא ניתן לבטל את בקשת ההפסקה אצל ורד — נסו שוב',
    resolve_rejected: 'בקשת ביטול ההפסקה נדחתה אצל ורד',
    resolve_unreachable: 'מטופלי חוץ אינם זמינים כרגע — נסו שוב',
    // Delete propagation — fail-closed reasons from deactivateClient. The local
    // record is NOT removed until the outpatient client is deactivated.
    deactivate_unconfigured: 'סנכרון מחיקת המטופל אינו מוגדר בשרת — לא ניתן למחוק',
    deactivate_failed: 'לא ניתן להשבית את המטופל/ת במטופלי חוץ — נסו שוב',
    deactivate_rejected: 'מחיקת המטופל/ת נדחתה אצל ורד',
    deactivate_unreachable: 'מטופלי חוץ אינם זמינים כרגע — נסו שוב'
  };
  function saveErrorText(code) { return SAVE_ERROR_TEXT[code] || code || 'נדחה'; }

  // --- post-treatment report --------------------------------------------
  // The report is the payment trigger (no mark = no pay) and drives the
  // outpatient write-back. happened → debt-gated (block a debtor unless Ron/
  // Sandra approve); didn't-happen → capture a reason. Local state is the
  // source of truth; syncStatus tells us whether the write-back reached outpatient.
  var reportCtx = null;

  // A reportable row by id — a real Schedule row, or a virtual recurring occurrence.
  function reportableById(id) {
    return (state.schedule || []).filter(function (r) { return r.id === id; })[0] ||
           (state.occurrences || []).filter(function (o) { return o.id === id; })[0] || null;
  }

  // Entry from a mark button. Re-clicking the same outcome clears it (no modal).
  function markAttendance(id, value) {
    if (!ensureTherapist()) return;
    var row = reportableById(id);
    if (!row) return;
    if (row.attendance === value) { commitReport(id, '', {}); return; }   // toggle off
    openReport(row, value);
  }

  function openReport(row, outcome) {
    reportCtx = { id: row.id, outcome: outcome, row: row, gate: null };
    $('#reportPatient').textContent = row.patientName + ' · ' + svc(row.treatmentType) + ' · ' + displayDateTime(row.scheduledDate, row.time);
    var body = $('#reportBody');
    var save = $('#reportSave');
    if (outcome === 'missed') {
      body.innerHTML = '<label class="wide">סיבה שלא בוצע<textarea id="reportReason" rows="2" placeholder="מדוע הטיפול לא בוצע"></textarea></label>';
      save.disabled = false; $('#reportModal').hidden = false; return;
    }
    // happened → live debt check (authoritative re-check also runs server-side).
    body.innerHTML = '<div class="muted">בודק חוב…</div>';
    save.disabled = true; $('#reportModal').hidden = false;
    refreshDebtRoster().then(function (roster) {
      var gate = DebtGate.evaluate({ phone: row.patientPhone, roster: roster.roster, rosterOk: roster.rosterOk });
      reportCtx.gate = gate;
      if (gate.decision === 'allow') {
        body.innerHTML = '<div class="report-ok">ללא חוב — ניתן לאשר ביצוע.</div>';
      } else if (gate.decision === 'block') {
        body.innerHTML = '<div class="card-banner card-banner-stop" style="margin:0 0 8px">⛔ חוב פתוח ' + money(gate.amountOwed) +
          ' — יש להפסיק טיפול. נדרש אישור רון/סנדרה כדי לדווח ביצוע.</div>' +
          '<div class="gate-approval"><select id="reportApprover"><option value="">— מאשר/ת —</option>' +
          '<option value="ron">רון</option><option value="sandra">סנדרה</option></select>' +
          '<input id="reportNote" placeholder="הערת אישור" /></div>';
      } else {
        body.innerHTML = '<div class="gate-flag">⚠️ ' + (FLAG_TEXT[gate.reason] || 'דרוש בירור ידני.') + ' יירשם לבירור.</div>';
      }
      save.disabled = false;
    }).catch(function () {
      reportCtx.gate = { decision: 'flag', reason: 'lookup_failed' };
      body.innerHTML = '<div class="gate-flag">⚠️ בדיקת חוב נכשלה — יירשם לבירור.</div>';
      save.disabled = false;
    });
  }

  function saveReport() {
    if (!reportCtx) return;
    var outcome = reportCtx.outcome;
    var extra = {};
    if (outcome === 'missed') {
      var reason = ($('#reportReason').value || '').trim();
      if (!reason) { toast('יש לציין סיבה שהטיפול לא בוצע', true); return; }
      extra.reason = reason;
    } else {
      var g = reportCtx.gate;
      if (g && g.decision === 'block') {
        var ap = $('#reportApprover'), note = $('#reportNote');
        var stamp = Approval.buildApproval({
          approver: ap ? ap.value : '', patientName: reportCtx.row.patientName,
          patientPhone: reportCtx.row.patientPhone, therapist: state.therapist,
          note: note ? note.value : '', amountOwed: g.amountOwed
        });
        if (!stamp.ok) { toast(stamp.error, true); return; }
        extra.approval = stamp.approval;
      } else if (g && g.decision === 'flag') {
        extra.flagged = true; extra.gateReason = g.reason;
      }
    }
    $('#reportSave').disabled = true;
    commitReport(reportCtx.id, outcome, extra);
  }
  function closeReportModal() { $('#reportModal').hidden = true; reportCtx = null; }

  function commitReport(id, attendance, extra) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) {
      // Reporting a VIRTUAL recurring occurrence: promote it to a real row in
      // local state and tell the backend to materialize it (idempotent by id).
      var occ = (state.occurrences || []).filter(function (o) { return o.id === id; })[0];
      if (!occ) return;
      row = Object.assign({}, occ);
      delete row.recurring;
      state.schedule.push(row);
      extra = extra || {};
      extra.occurrence = occ;
    }
    var prev = row.attendance;
    row.attendance = attendance;
    if (extra && extra.reason != null) row.reason = extra.reason;
    state.schedule.forEach(function (r) { if (r.sessionId === row.sessionId) r.syncStatus = 'pending'; });
    recomputeAlerts(); render();
    apiMarkAttendance(id, attendance, extra)
      .then(function (res) {
        var status = res && res.syncStatus;
        if (status) state.schedule.forEach(function (r) { if (r.sessionId === row.sessionId) r.syncStatus = status; });
        render();
        var msg = attendance === 'occurred' ? 'דווח: התקיים' : attendance === 'missed' ? 'דווח: לא התקיים' : 'הסימון בוטל';
        if (status === 'pending') msg += ' (ממתין לסנכרון)';
        toast(msg);
        closeReportModal();
      })
      .catch(function (err) {
        row.attendance = prev; recomputeAlerts(); render();
        toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true);
        var s = $('#reportSave'); if (s) s.disabled = false;
      });
  }

  // --- session outcome (iteration 18 step 2) ----------------------------
  // The therapist marks one of three outcomes (happened / therapist-cancelled /
  // patient-no-show). STORAGE-ONLY: it stamps the Schedule row and does NOTHING
  // else — no debt gate, no outpatient write-back (that is step 3). No modal:
  // one click records it (optimistic, with rollback on failure).
  function markOutcome(id, value) {
    if (!ensureTherapist()) return;
    if (!Outcome.isValid(value)) return;
    var src = reportableById(id);
    if (!src) return;

    // Promote a VIRTUAL recurring occurrence to a real local row (the backend
    // materializes its booking row from the occurrence payload, idempotent by id).
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    var occurrence = null;
    if (!row) {
      var occ = (state.occurrences || []).filter(function (o) { return o.id === id; })[0];
      if (!occ) return;
      occurrence = occ;
      row = Object.assign({}, occ);
      delete row.recurring;
      state.schedule.push(row);
    }

    var built = Outcome.buildOutcome(row, value);
    if (!built.ok) { toast('ערך לא חוקי', true); return; }
    var prev = row.outcome, prevAt = row.outcomeAt;
    row.outcome = value;
    row.outcomeAt = built.record.outcomeAt;
    render();
    apiSetSessionOutcome(id, value, { outcomeAt: built.record.outcomeAt, occurrence: occurrence })
      .then(function (res) {
        if (res && res.outcomeAt) row.outcomeAt = res.outcomeAt;
        render();
        // The outcome ALWAYS saved locally. Flag (never swallow) when the
        // outpatient pay-sync didn't land — the outcome stands either way.
        var w = outcomeSyncWarning(res);
        if (w) toast('נרשם: ' + Outcome.labelFor(value) + ' — אך ' + w, true);
        else toast('נרשם: ' + Outcome.labelFor(value));
      })
      .catch(function (err) {
        row.outcome = prev; row.outcomeAt = prevAt; render();
        toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true);
      });
  }

  // --- edit / cancel a booking (therapist, in «המטופלים שלי») -----------
  var bookingEditId = null;
  function openBookingEdit(id) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    bookingEditId = id;
    $('#bookingPatient').textContent = row.patientName + ' · ' + svc(row.treatmentType);
    $('#bookingTime').innerHTML = timeOptions(row.time);
    $('#bookingLocation').innerHTML = locationOptions(row.location);
    var form = $('#bookingForm');
    form.querySelector('[name="scheduledDate"]').value = fmtDate(row.scheduledDate) || today();
    $('#bookingTime').value = row.time || '';
    $('#bookingLocation').value = row.location || '';
    if ($('#bookingRoom')) $('#bookingRoom').value = row.room || '';
    $('#bookingModal').hidden = false;
  }
  function closeBookingModal() { $('#bookingModal').hidden = true; bookingEditId = null; }
  function saveBooking() {
    if (!bookingEditId) return;
    var btn = $('#bookingSave'); if (btn.disabled) return;
    var fd = new FormData($('#bookingForm'));
    var fields = {
      scheduledDate: fd.get('scheduledDate') || '',
      time: fd.get('time') || '',
      location: (fd.get('location') || '').trim(),
      room: (fd.get('room') || '').trim()
    };
    if (!fields.scheduledDate) { toast('יש לבחור תאריך', true); return; }
    btn.disabled = true;
    apiUpdateBooking(bookingEditId, fields)
      .then(function () { toast('הטיפול עודכן'); return loadOwn(); })
      .then(function () { closeBookingModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { btn.disabled = false; });
  }
  function cancelBooking(id) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    if (!Scheduling.canCancelBooking(row)) {
      toast('כדי לבטל טיפול שכבר דווח — סמן/י תחילה «לא התקיים».', true); return;
    }
    if (!window.confirm('לבטל את הטיפול של ' + row.patientName + ' בתאריך ' + displayDate(row.scheduledDate) + '?')) return;
    apiRemoveSchedule(id)
      .then(function () { toast('הטיפול בוטל'); return loadOwn(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); });
  }

  // Mark a patient as stopped: send a flagStop request to outpatient (pending
  // Vered's confirmation) and, on success, cancel their future bookings. Does NOT
  // discharge directly. Fail-closed server-side — if the flag can't be sent,
  // nothing changes and the error surfaces here.
  function markPatientStopped(phone) {
    var rec = patientByPhone(phone);
    if (!rec) { toast('מטופל/ת לא נמצא', true); return; }
    if (!window.confirm('לסמן הפסקת טיפול עבור ' + rec.name + '?\nתישלח בקשה לאישור ורד והטיפולים העתידיים שטרם דווחו יבוטלו.')) return;
    var note = window.prompt('הערה (לא חובה):', '');
    if (note === null) return;                       // prompt cancelled → abort
    apiMarkPatientStopped({ phone: rec.phone, name: rec.name, reportedBy: state.therapist || 'עורך', note: note || '' })
      .then(function () { toast('נשלחה בקשת הפסקה לאישור ורד'); return loadOwn(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); });
  }

  // The display name for a stopped/orphaned patient — looked up by phone from the
  // stopped list (NOT patientByPhone, which only sees ACTIVE patients), falling
  // back to the phone itself so an orphaned flag is still actionable.
  function stoppedNameByPhone(phone) {
    var key = normPhone(phone);
    var hit = stoppedPatients().filter(function (p) { return p.key === key; })[0];
    return (hit && hit.name) || phone;
  }

  // Undo a pending stop request → patient returns to active. Resolves the
  // outpatient StopFlag first (fail-closed server-side), then clears the local
  // stop flag. Works by PHONE, so an orphaned flag (no active match) still clears.
  function restorePatient(phone) {
    var name = stoppedNameByPhone(phone);
    if (!window.confirm('להחזיר את ' + name + ' לרשימת הפעילים?\nבקשת ההפסקה תבוטל אצל ורד. הטיפולים שבוטלו לא ישוחזרו — יש לקבוע מחדש לפי הצורך.')) return;
    apiRestorePatient({ phone: phone, reportedBy: state.therapist || 'עורך' })
      .then(function () { toast('המטופל/ת הוחזר/ה לפעילים'); return loadOwn(); })
      .catch(function (err) { toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true); });
  }

  // Delete a patient entirely (test cleanup): removes the local record and
  // resolves any outpatient StopFlag. Double-guarded (destructive). By PHONE, so
  // an orphaned flag with no matching patient can still be cleaned up.
  function removePatient(phone) {
    var name = stoppedNameByPhone(phone);
    if (!window.confirm('למחוק לצמיתות את ' + name + '?\nפעולה זו מסירה את רשומת המטופל/ת המקומית, מבטלת בקשת הפסקה ומשביתה את המטופל/ת במטופלי חוץ. אין לבטל.')) return;
    apiRemovePatient({ phone: phone, reportedBy: state.therapist || 'עורך' })
      .then(function () { toast('המטופל/ת נמחק/ה'); return loadOwn(); })
      .catch(function (err) { toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true); });
  }

  // --- patient intake / edit modal (identity + origin) ------------------
  // The therapist assignment(s) + plan(s) live in the Assignments modal; the
  // intake form captures identity + origin, plus ONE optional INITIAL assignment
  // for a brand-new patient (further ones are added/edited in «שיבוץ מטפלים»).
  function fillPatientForm(rec) {
    var form = $('#patientForm');
    form.reset();
    syncDropdowns();
    rec = rec || {};
    form.querySelector('[name="name"]').value = rec.name || '';
    form.querySelector('[name="phone"]').value = rec.phone || '';
    $('#patientTherapist').value = '';
    $('#patientType').value = '';
    form.querySelector('[name="frequencyPerWeek"]').value = '';
    form.querySelector('[name="origin"]').value = rec.origin || '';
    $('#stillAdmitted').checked = !!rec.stillAdmitted;
    $('#admittedHouse').value = rec.admittedHouse || '';
    $('#admittedDetails').hidden = !$('#stillAdmitted').checked;
  }
  // 'create' rejects a phone that already belongs to a patient; 'edit' upserts.
  var patientModalMode = 'create';
  function openNewPatient() {
    patientModalMode = 'create';
    $('#patientModalTitle').textContent = 'רישום מטופל חדש';
    fillPatientForm(null);
    $('#initialAssignmentSection').hidden = false;   // initial assignment only for new
    $('#patientForm [name="phone"]').readOnly = false;
    $('#patientModal').hidden = false;
  }
  function openPatientModal(phone) {
    var rec = patientByPhone(phone);
    patientModalMode = rec ? 'edit' : 'create';
    $('#patientModalTitle').textContent = 'עריכת מטופל/ת';
    fillPatientForm(rec || {});
    // Existing patient: edit identity + origin here; manage assignments in שיבוץ.
    $('#initialAssignmentSection').hidden = !!rec;
    $('#patientForm [name="phone"]').readOnly = !!rec;
    $('#patientModal').hidden = false;
  }
  function closePatientModal() { $('#patientModal').hidden = true; }

  function handlePatientSubmit() {
    var sub = $('#patientSubmit');
    if (sub.disabled) return;
    var fd = new FormData($('#patientForm'));
    var name = (fd.get('name') || '').trim();
    if (!name) { toast('חסר שם מטופל/ת', true); return; }
    var pv = Phone.toCanonical(fd.get('phone'));    // normalize then validate; store normalized
    if (!pv.ok) { toast(pv.error, true); return; }
    // On create, block a phone that already belongs to a patient (naming them).
    if (patientModalMode === 'create') {
      var dup = Phone.duplicateOf(pv.value, state.patients);
      if (dup) {
        toast('כבר קיים/ת מטופל/ת עם מספר הטלפון הזה: ' + (dup.name || pv.value), true);
        return;
      }
    }
    var stillAdmitted = !!fd.get('stillAdmitted');
    var patient = {
      phone: pv.value, name: name,
      origin: (fd.get('origin') || '').trim(),
      stillAdmitted: stillAdmitted,
      admittedHouse: stillAdmitted ? (fd.get('admittedHouse') || '').trim() : '',
      updatedBy: state.therapist || 'עורך'
    };
    // Optional initial assignment (new patients only — section is shown then).
    var initTher = (fd.get('assignedTherapist') || '').trim();
    var initType = (fd.get('mainTreatmentType') || '').trim();
    var initFreq = (fd.get('frequencyPerWeek') || '').trim();
    var wantInitial = !$('#initialAssignmentSection').hidden && (initTher || initType);

    sub.disabled = true;
    var initSyncWarning = null;
    apiSavePatient(patient, patientModalMode)
      .then(function () {
        if (!wantInitial) return;
        return apiSaveAssignment({
          id: uid(), patientPhone: pv.value, therapist: initTher,
          treatmentType: initType, frequencyPerWeek: initFreq, updatedBy: state.therapist || 'עורך'
        }).then(function (data) {
          // Save stuck locally; flag if the outpatient billing-type sync didn't.
          var w = clinicalSyncWarning(data);
          if (w) initSyncWarning = svc(initType) + ': ' + w;
        });
      })
      .then(function () { return loadOwn(); })
      .then(function () {
        closePatientModal();
        if (initSyncWarning) toast('נשמר, אך סנכרון סוג החיוב נכשל — ' + initSyncWarning, true);
        else toast('נשמר');
      })
      .catch(function (err) {
        // The server is the duplicate safety-net; surface its Hebrew message.
        var msg = err.message === 'duplicate_phone'
          ? 'כבר קיים/ת מטופל/ת עם מספר הטלפון הזה'
          : err.message;
        toast('שגיאה: ' + msg, true);
      })
      .finally(function () { sub.disabled = false; });
  }

  // --- assignments modal (one locked row per approved plan type) --------
  var assignmentsCtx = { phone: '', removed: [], types: null };
  // Weekly recurring pattern editor: one slot row per weekly session (weekday +
  // time + location). 0=ראשון … 6=שבת (matches JS getDay used by Recurring).
  var WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function weekdayOptions(selected) {
    var sel = String(selected == null ? '' : selected);
    return ['<option value="">— יום —</option>'].concat(WEEKDAY_LABELS.map(function (lab, idx) {
      return '<option value="' + idx + '"' + (sel === String(idx) ? ' selected' : '') + '>' + lab + '</option>';
    })).join('');
  }
  function slotRowHtml(slot) {
    slot = slot || {};
    return '<div class="slot-row">' +
      '<select class="s-weekday">' + weekdayOptions(slot.weekday) + '</select>' +
      '<select class="s-time">' + timeOptions(slot.time || '') + '</select>' +
      '<select class="s-location">' + locationOptions(slot.location || '') + '</select>' +
      '<input type="text" class="s-room" placeholder="חדר" value="' + escapeHtml(slot.room || '') + '">' +
      '</div>';
  }
  // N slot rows prefilled from stored slots, sized to the approved plan frequency.
  // Used by the therapist's «המטופלים שלי» scheduling (NOT by Yarden's שיבוץ modal,
  // which is therapist-only). The frequency is LOCKED to the approved plan, so when
  // `freq` is given it WINS (exactly `freq` rows, padded/truncated from the stored
  // slots); only when no freq is known do we fall back to the stored slot count.
  function slotsEditorHtml(slots, freq) {
    var arr = Recurring.parseSlots(slots);
    var n = (parseInt(freq, 10) || 0) || arr.length;
    var html = '';
    for (var i = 0; i < n; i++) html += slotRowHtml(arr[i] || {});
    return html;
  }
  function readSlotRows(container) {
    return $$('.slot-row', container).map(function (el) {
      return {
        weekday: el.querySelector('.s-weekday').value,
        time: el.querySelector('.s-time').value,
        location: el.querySelector('.s-location').value,
        room: (el.querySelector('.s-room') ? el.querySelector('.s-room').value : '')
      };
    });
  }
  // Yarden's row: she assigns ONLY the therapist per treatment type. The type and
  // its frequency are LOCKED to the approved plan (read-only). The weekly
  // days/hours are NOT set here — the assigned therapist sets them in their own
  // «המטופלים שלי» tab. Any slots already set by the therapist are preserved
  // (carried on data-slots) so re-saving an assignment here never wipes them.
  function assignmentRowHtml(a, entry) {
    a = a || {};
    entry = entry || { treatmentType: '', frequencyPerWeek: 0 };
    var freq = entry.frequencyPerWeek;
    var freqText = freq ? (freq + '× בשבוע') : '—';
    var slotsAttr = a.slots ? escapeHtml(typeof a.slots === 'string' ? a.slots : JSON.stringify(a.slots)) : '';
    var framework = isFrameworkType(entry.treatmentType);
    // For a framework type (מסגרת, e.g. ליווי יומי בקהילה) Yarden sets WHERE it
    // happens, not a therapist. The current location is read from the stored slots.
    var control;
    if (framework) {
      var curLoc = (Recurring.parseSlots(a.slots)[0] || {}).location || '';
      control = '<select class="a-location">' + locationOptions(curLoc) + '</select>' +
        '<span class="a-framework-tag">מסגרת — ללא מטפל/ת</span>';
    } else {
      control = '<select class="a-therapist">' + optionList(activeTherapistNames(), a.therapist || '') + '</select>';
    }
    return '<div class="assignment-row" data-aid="' + escapeHtml(a.id || '') + '" data-type="' + escapeHtml(entry.treatmentType || '') + '" data-slots="' + slotsAttr + '" data-framework="' + (framework ? '1' : '0') + '">' +
      '<div class="assignment-head">' +
        control +
        '<span class="a-plan-lock" title="נקבע בתוכנית הטיפול המאושרת (קריאה בלבד)">' +
          '<span class="a-type-lock">' + escapeHtml(svc(entry.treatmentType) || '—') + '</span>' +
          '<span class="a-freq-lock">' + escapeHtml(freqText) + '</span>' +
        '</span>' +
      '</div>' +
      '</div>';
  }
  function openAssignmentsModal(phone) {
    var p = patientByPhone(phone);
    if (!p) { toast('מטופל/ת לא נמצא', true); return; }
    // The approved plan is the SINGLE authority: it dictates EXACTLY which types
    // (and frequencies) this patient has — one locked row per type, no free-add.
    var types = planForPhone(p.phone);
    assignmentsCtx = { phone: p.phone, removed: [], types: types };
    $('#assignmentsPatientName').textContent = p.name;
    var save = $('#assignmentsSave');
    // BLOCK (never fail open) when there is no single approved plan to read.
    var blockMsg = planBlockMessage(types);
    if (blockMsg) {
      $('#assignmentRows').innerHTML = '<div class="gate-flag assignment-block">' + escapeHtml(blockMsg) + '</div>';
      if (save) save.disabled = true;
      $('#assignmentsModal').hidden = false;
      return;
    }
    if (save) save.disabled = false;
    // One row PER plan type. Pre-fill therapist + slots from the existing
    // assignment whose treatmentType matches this plan type; unassigned types
    // render empty. Rows are EXACTLY the plan's types — no add/remove.
    var rows = types.map(function (t) {
      var existing = p.assignments.filter(function (a) { return a.treatmentType === t.treatmentType; })[0] || {};
      return assignmentRowHtml(existing, t);
    });
    $('#assignmentRows').innerHTML = rows.join('');
    $('#assignmentsModal').hidden = false;
  }
  function closeAssignmentsModal() { $('#assignmentsModal').hidden = true; }

  // --- Therapist weekly fixed schedule (tab 3) -------------------------------
  // The therapist sets the recurring weekly slots (day/time/location/room) for
  // their OWN assignment(s) on this patient, sized to the approved plan frequency.
  // On save, a patient-collision check blocks any slot that lands on a weekday+time
  // already taken by ANOTHER of the patient's assignments (can't be in two places
  // at once). Slots are stored on the assignment; the recurring engine turns them
  // into occurrences. Single-session postpone remains available via «עריכה» on a
  // materialized occurrence in the list below.
  var weeklyCtx = null;
  function openWeeklyModal(phone) {
    var p = patientByPhone(phone);
    if (!p) { toast('מטופל/ת לא נמצא', true); return; }
    // Only the signed-in therapist's own assignments are editable here.
    var mine = (p.assignments || []).filter(function (a) { return a.therapist === state.therapist; });
    if (!mine.length) { toast('אין לך טיפולים משובצים למטופל/ת זה', true); return; }
    weeklyCtx = { phone: p.phone };
    $('#weeklyPatientName').textContent = p.name;
    var rows = mine.map(function (a) {
      return '<div class="weekly-type-block" data-aid="' + escapeHtml(a.id) + '" data-type="' + escapeHtml(a.treatmentType) + '">' +
        '<div class="weekly-type-title">' + escapeHtml(svc(a.treatmentType)) +
          (a.frequencyPerWeek ? ' · ' + a.frequencyPerWeek + '× בשבוע' : '') + '</div>' +
        '<div class="a-slots">' + slotsEditorHtml(a.slots, a.frequencyPerWeek) + '</div>' +
        '</div>';
    });
    $('#weeklyRows').innerHTML = rows.join('');
    $('#weeklyModal').hidden = false;
  }
  function closeWeeklyModal() { $('#weeklyModal').hidden = true; weeklyCtx = null; }
  function saveWeekly() {
    var btn = $('#weeklySave'); if (!weeklyCtx || (btn && btn.disabled)) return;
    var phone = weeklyCtx.phone;
    var p = patientByPhone(phone);
    if (!p) { toast('מטופל/ת לא נמצא', true); return; }
    var blocks = $$('.weekly-type-block', $('#weeklyRows'));
    var toSave = [];
    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i];
      var aid = el.getAttribute('data-aid');
      var typeName = el.getAttribute('data-type');
      var existing = p.assignments.filter(function (a) { return a.id === aid; })[0] || {};
      var planFreq = String(existing.frequencyPerWeek || '');
      var filled = readSlotRows(el.querySelector('.a-slots')).filter(function (s) {
        return s.weekday !== '' || s.time || s.location || s.room;
      });
      var slotsJson = '';
      if (filled.length) {
        var v = Recurring.validateSlots(filled, planFreq);
        if (!v.ok) { toast(svc(typeName) + ': ' + v.error, true); return; }
        // Patient collision: compare against the patient's OTHER assignments.
        var others = p.assignments.filter(function (a) { return a.id !== aid; });
        var c = Recurring.patientSlotConflict({ candidateSlots: v.slots, otherAssignments: others });
        if (!c.ok) { toast(svc(typeName) + ': ' + c.error, true); return; }
        slotsJson = JSON.stringify(v.slots);
      }
      toSave.push(Plan.assignmentPayload({
        entry: { treatmentType: existing.treatmentType, frequencyPerWeek: existing.frequencyPerWeek },
        id: aid, patientPhone: phone, therapist: existing.therapist,
        slots: slotsJson, updatedBy: state.therapist || 'עורך'
      }));
    }
    if (btn) btn.disabled = true;
    Promise.all(toSave.map(function (a) { return apiSaveAssignment(a); }))
      .then(function () { closeWeeklyModal(); return loadOwn(); })
      .then(function () { toast('הלוז השבועי נשמר'); })
      .catch(function () { toast('שמירה נכשלה', true); })
      .then(function () { if (btn) btn.disabled = false; });
  }
  function saveAssignments() {
    var btn = $('#assignmentsSave');
    if (btn.disabled) return;
    var phone = assignmentsCtx.phone;
    // The plan is the ONLY authority for type+freq. Re-check on save (defensive —
    // the modal already blocked on open) so a stale/disappeared plan never saves.
    var types = assignmentsCtx.types;
    var blockMsg = planBlockMessage(types);
    if (blockMsg) { toast(blockMsg, true); return; }
    var rows = $$('#assignmentRows .assignment-row');
    var toSave = [];
    var keptIds = {};
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var typeName = el.getAttribute('data-type') || '';
      var entry = types.filter(function (t) { return t.treatmentType === typeName; })[0] ||
                  { treatmentType: typeName, frequencyPerWeek: 0 };
      var isFw = el.getAttribute('data-framework') === '1';
      var aid = el.getAttribute('data-aid') || '';
      var slotsJson = el.getAttribute('data-slots') || '';

      if (isFw) {
        // Framework (מסגרת): no therapist. Yarden picks WHERE it happens; store it
        // as the location on a single slot so the card can show it. The row is kept
        // even with no location (it's a real plan type), so the patient isn't
        // mis-flagged as needing assignment.
        var loc = (el.querySelector('.a-location') ? el.querySelector('.a-location').value : '').trim();
        var fwSlots = loc ? JSON.stringify([{ weekday: '', time: '', location: loc, room: '' }]) : slotsJson;
        if (aid) keptIds[aid] = true;
        toSave.push(Plan.assignmentPayload({
          entry: entry, id: aid || uid(), patientPhone: phone, therapist: '',
          slots: fwSlots, updatedBy: state.therapist || 'עורך'
        }));
        continue;
      }

      var ther = (el.querySelector('.a-therapist') ? el.querySelector('.a-therapist').value : '').trim();
      if (!ther) continue;                               // type left unassigned -> skip (removes existing)
      if (aid) keptIds[aid] = true;
      toSave.push(Plan.assignmentPayload({
        entry: entry, id: aid || uid(), patientPhone: phone, therapist: ther,
        slots: slotsJson, updatedBy: state.therapist || 'עורך'
      }));
    }
    // Existing assignments whose row was deleted -> remove.
    var existing = (patientByPhone(phone) || { assignments: [] }).assignments;
    var toRemove = existing.filter(function (a) { return a.id && !keptIds[a.id]; }).map(function (a) { return a.id; });

    btn.disabled = true;
    // Collect any billing-type sync warnings across the saved rows. The saves
    // succeed regardless; a warning means the assignment stuck locally but the
    // outpatient billing-type sync didn't — surfaced, never swallowed.
    var syncWarnings = [];
    var chain = Promise.resolve();
    toSave.forEach(function (a) {
      chain = chain.then(function () {
        return apiSaveAssignment(a).then(function (data) {
          var w = clinicalSyncWarning(data);
          if (w) syncWarnings.push(svc(a.treatmentType) + ': ' + w);
        });
      });
    });
    toRemove.forEach(function (id) { chain = chain.then(function () { return apiRemoveAssignment(id); }); });
    chain
      .then(function () { return loadOwn(); })
      .then(function () {
        closeAssignmentsModal();
        if (syncWarnings.length) {
          toast('השיבוצים נשמרו, אך סנכרון סוג החיוב נכשל — ' + syncWarnings.join(' · '), true);
        } else {
          toast('השיבוצים נשמרו');
        }
      })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { btn.disabled = false; });
  }

  // Scheduling/reporting need a therapist name picked in tab 3 first.
  function ensureTherapist() {
    if (hasTherapist()) return true;
    toast('יש לבחור שם מטפל/ת בלשונית «המטופלים שלי»', true); return false;
  }

  // --- view switching (no roles; all tabs always visible) ----------------
  function setView(view) {
    if (!Access.isTab(view)) view = Access.defaultView();
    state.view = view;
    document.body.classList.remove('view-dashboard', 'view-workflow', 'view-mine');
    document.body.classList.add('view-' + view);
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    // Opening «עצירת טיפול» re-pulls the alerts so the list + badge are current
    // (alerts are raised by the outpatient app between loads). Best-effort.
    if (view === 'stopAlerts' && state.loaded) {
      loadStopAlerts().then(renderStopAlerts).catch(function () {});
    }
  }

  function on(sel, ev, fn) {
    var el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) { console.warn('[ezone-therapists] missing element for', sel); return; }
    el.addEventListener(ev, fn);
  }

  function wireEvents() {
    // Shared password gate (verified server-side; correct → reveal the app).
    on('#gateSubmit', 'click', function () {
      var pw = ($('#gateInput').value || '');
      apiGateVerify(pw)
        .then(function (d) { if (d && d.ok) startApp(); else { var e = $('#gateError'); if (e) e.hidden = false; } })
        .catch(function () { var e = $('#gateError'); if (e) e.hidden = false; });
    });
    on('#gateInput', 'keydown', function (e) {
      var err = $('#gateError'); if (err) err.hidden = true;
      if (e.key === 'Enter') { e.preventDefault(); $('#gateSubmit').click(); }
    });

    // Tab-3 name picker — sets the runtime therapist identity (not persisted).
    on('#mineTherapist', 'change', function (e) {
      state.therapist = (e.target.value || '').trim();
      renderMine();
    });

    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { setView(t.dataset.view); }); });
    on('#refreshBtn', 'click', function () { loadAll().then(function () { toast('רועננו'); }).catch(function () {}); });

    on('#dashboardSearch', 'input', function (e) { state.dashboardSearch = e.target.value; renderDashboard(); });
    on('#workflowSearch', 'input', function (e) { state.workflowSearch = e.target.value; renderSchedule(); });

    on('#newPatientBtn', 'click', openNewPatient);          // Vered (שיבוץ)
    on('#mineScheduleBtn', 'click', function () { openScheduleModal(); }); // therapist (מ)
    on('#mineExportBtn', 'click', exportMyPatients);

    // Delegated patient actions — shared by the dashboard list and the שיבוץ
    // assign list (so a newly registered patient is actionable in both).
    function onPatientListClick(e) {
      var ep = e.target.closest('[data-edit-patient]');
      if (ep) { openPatientModal(ep.getAttribute('data-edit-patient')); return; }
      var ap = e.target.closest('[data-assignments-patient]');
      if (ap) { openAssignmentsModal(ap.getAttribute('data-assignments-patient')); return; }
      var stp = e.target.closest('[data-stop-patient]');
      if (stp) { markPatientStopped(stp.getAttribute('data-stop-patient')); return; }
      var sp = e.target.closest('[data-schedule-patient]');
      if (sp) {
        var rec = patientByPhone(sp.getAttribute('data-schedule-patient'));
        // Prefer the assignment for the scheduling therapist (state.therapist) so
        // the locked type is the specific plan type THEY are working; fall back to
        // the patient's first assignment.
        var pick = rec && (rec.assignments.filter(function (a) { return a.therapist === state.therapist; })[0] || rec.assignments[0]);
        openScheduleModal(rec ? { name: rec.name, phone: rec.phone, treatmentType: pick ? pick.treatmentType : '', therapist: pick ? pick.therapist : '' } : null);
      }
    }
    on('#patientsList', 'click', onPatientListClick);  // Vered dashboard (no actions)
    on('#assignList', 'click', onPatientListClick);    // Vered שיבוץ (register/assign)

    // Stopped / discharged list — restore (undo a pending stop) and delete (test
    // cleanup). By phone, so an orphaned flag with no active match still works.
    on('#stoppedList', 'click', function (e) {
      var rp = e.target.closest('[data-restore-patient]');
      if (rp) { restorePatient(rp.getAttribute('data-restore-patient')); return; }
      var dp = e.target.closest('[data-delete-patient]');
      if (dp) { removePatient(dp.getAttribute('data-delete-patient')); return; }
    });

    // המטופלים שלי (therapist): schedule + report did-it-happen on their patients.
    on('#mineSearch', 'input', function (e) { state.mineSearch = e.target.value; renderMine(); });
    on('#view-mine', 'click', function (e) {
      var dn = e.target.closest('[data-dismiss-notif]');
      if (dn) {
        var nid = dn.getAttribute('data-dismiss-notif');
        dn.disabled = true;
        apiDismissNotification(nid)
          .then(function () {
            var n = (state.notifications || []).filter(function (x) { return x.id === nid; })[0];
            if (n) n.dismissed = 'true';
            renderNotifications();
          })
          .catch(function () { dn.disabled = false; toast('הפעולה נכשלה', true); });
        return;
      }
      var wk = e.target.closest('[data-weekly-patient]');
      if (wk) { openWeeklyModal(wk.getAttribute('data-weekly-patient')); return; }
      var stp = e.target.closest('[data-stop-patient]');
      if (stp) { onPatientListClick(e); return; }
      var sp = e.target.closest('[data-schedule-patient]');
      if (sp) { onPatientListClick(e); return; }
      var eb = e.target.closest('[data-edit-booking]');
      if (eb) { openBookingEdit(eb.getAttribute('data-edit-booking')); return; }
      var cb = e.target.closest('[data-cancel-booking]');
      if (cb) { cancelBooking(cb.getAttribute('data-cancel-booking')); return; }
      var ob = e.target.closest('[data-mine-outcome]');
      if (ob) { markOutcome(ob.getAttribute('data-id'), ob.getAttribute('data-mine-outcome')); return; }
      // Legacy binary mark (kept for step 3 wiring; no longer surfaced in the UI).
      var b = e.target.closest('[data-mine-att]');
      if (b) { markAttendance(b.getAttribute('data-id'), b.getAttribute('data-mine-att')); return; }
      if (e.target.closest('#syncNowBtn')) syncNow();
    });
    on('#workflowTherapistFilter', 'change', function (e) {
      state.workflowTherapist = e.target.value || '';
      renderAssign(); renderSchedule();
    });

    // «עצירת טיפול»: «נקראה» (mark one read) in the unread group, and «החזר ללא
    // נקראה» (return one to unread) in the read group — a reversible mark-read.
    on('#stopAlertsUnread', 'click', function (e) {
      var b = e.target.closest('[data-stop-alert-read]');
      if (b) markStopAlertRead(b.getAttribute('data-stop-alert-read'));
    });
    on('#stopAlertsRead', 'click', function (e) {
      var b = e.target.closest('[data-stop-alert-unread]');
      if (b) markStopAlertUnread(b.getAttribute('data-stop-alert-unread'));
    });

    // Schedule modal: group toggle, add/remove patients.
    on('#scheduleType', 'change', updateGroupUi);
    on('#addPatientRowBtn', 'click', function () { addPatientRow(); updateGroupUi(); });
    on('#patientRows', 'click', function (e) {
      var rm = e.target.closest('.remove-patient');
      if (rm) {
        var row = rm.closest('.patient-row');
        if ($$('#patientRows .patient-row').length > 1) { row.remove(); refreshTypeLock(); }
      }
    });
    // Editing a patient identity invalidates a pending gate result AND re-applies
    // the type lock to whoever is now named in the row.
    on('#patientRows', 'input', function () { if (pendingPatients) resetGateResults(); refreshTypeLock(); });
    // Picking an assigned patient by name fills their phone (so the gate + the
    // assigned-only check key off the right record), then re-locks the type.
    on('#patientRows', 'change', function (e) {
      if (e.target.classList && e.target.classList.contains('patient-name')) {
        var row = e.target.closest('.patient-row');
        var phoneEl = row.querySelector('.patient-phone');
        var name = (e.target.value || '').trim();
        if (name && !(phoneEl.value || '').trim()) {
          var hit = assignedPatients().filter(function (p) { return p.name === name; });
          if (hit.length === 1) phoneEl.value = hit[0].phone;
        }
      }
      refreshTypeLock();
    });

    on('#stillAdmitted', 'change', function (e) { $('#admittedDetails').hidden = !e.target.checked; });

    // Assignments modal: rows are EXACTLY the approved plan's types (locked type +
    // frequency) — there is no add/remove and no editable frequency, so the only
    // wiring is save.
    on('#assignmentsSave', 'click', saveAssignments);
    on('#weeklySave', 'click', saveWeekly);

    on('#reportSave', 'click', saveReport);
    on('#bookingForm', 'submit', function (e) { e.preventDefault(); saveBooking(); });
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeScheduleModal(); closePatientModal(); closeAssignmentsModal(); closeReportModal(); closeBookingModal(); closeWeeklyModal(); });
    });

    on('#scheduleForm', 'submit', function (e) { e.preventDefault(); handleScheduleSubmit(); });
    on('#patientForm', 'submit', function (e) { e.preventDefault(); handlePatientSubmit(); });
  }

  // --- shared password gate (UI only; verified server-side, never persisted) --
  async function apiGateStatus() {
    var r = await fetch('/api/gate', { cache: 'no-store' });
    return r.json();
  }
  async function apiGateVerify(password) {
    var r = await fetch('/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    });
    return r.json();
  }
  function showGate() {
    $('#gateScreen').hidden = false;
    $('#app').hidden = true;
    var i = $('#gateInput'); i.value = ''; i.focus();
  }
  // Reveal the app and run the normal direct-open flow (dashboard + load).
  function startApp() {
    $('#gateScreen').hidden = true;
    $('#app').hidden = false;
    // The tab-3 therapist pick is a fresh runtime choice each open (not stored).
    setView('dashboard');
    loadAll().catch(function () {});
  }

  function init() {
    try { wireEvents(); } catch (e) { console.error('[ezone-therapists] wireEvents failed', e); }
    // Decide the gate first — re-prompted every open, nothing persisted. If the
    // status check fails (the page itself came from this server, so this is rare)
    // we open rather than lock anyone out of a UI-only gate.
    apiGateStatus()
      .then(function (d) { if (d && d.required) showGate(); else startApp(); })
      .catch(function () { startApp(); });
  }

  function bootWhenReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  bootWhenReady();
})();
