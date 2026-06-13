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

  // Scheduling LOCATIONS are a fixed code list (id stored, Hebrew shown). This
  // is the therapist's scheduling choice — independent of any roster house.
  var LOCATIONS = [
    { id: 'ramot',   he: 'רמות השבים' },
    { id: 'raanana', he: 'רעננה' },
    { id: 'asher',   he: 'אשר' },
    { id: 'arfoni',  he: 'קיסריה ערפוני' },
    { id: 'rehab',   he: 'קיסריה ריהאב' }
  ];
  function locationLabel(v) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < LOCATIONS.length; i++) if (LOCATIONS[i].id === s) return LOCATIONS[i].he;
    return s;
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

  // --- access: name-pick roles, no password, no edit mode ----------------
  // A user is Vered (the office) or a THERAPIST (picked by name). Vered registers
  // + assigns; therapists see only their own patients and schedule/report.
  // Actions are always visible and scoped by role + tab (see public/access.js).
  // Identity is self-asserted — the real controls are the outpatient debt gate
  // and the Ron/Sandra approval audit.
  function isVered() { return state.role === 'vered'; }
  function isTherapist() { return state.role === 'therapist'; }

  // Hebrew copy for each gate flag reason (stable ids come from debt-gate.js).
  var FLAG_TEXT = {
    no_payment_record: 'אין רישום תשלומים עבור מטופל זה — לא ניתן לקבוע חוב. דרוש בירור ידני.',
    no_record: 'הטלפון אינו תואם לאף מטופל חוץ. דרוש בירור ידני.',
    ambiguous: 'הטלפון תואם ליותר ממטופל אחד. דרוש בירור ידני.',
    lookup_failed: 'בדיקת החוב נכשלה כרגע. לא ניתן לאשר טיפול ללא בדיקה — נסה שוב או פנה לבירור.'
  };

  // --- state -------------------------------------------------------------
  var state = {
    role: '',
    therapist: '',
    view: 'dashboard',
    schedule: [],
    approvals: [],
    patients: [],
    assignments: [],
    therapists: [],
    treatmentTypes: [],
    debtRoster: [], debtRosterOk: false,
    plans: [], plansOk: false,
    alerts: [],
    dashboardSearch: '',
    workflowSearch: '',
    workflowTherapist: '',
    mineSearch: '',
    loaded: false
  };

  // Per-patient gate decisions pending in the schedule modal (null until check).
  var pendingPatients = null;

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
  function apiMarkAttendance(id, attendance) { return apiPost({ action: 'markAttendance', id: id, attendance: attendance }); }
  function apiSyncPending() { return apiPost({ action: 'syncPending' }); }
  function apiSavePatient(patient) { return apiPost({ action: 'savePatient', patient: patient }); }
  function apiSaveAssignment(assignment) { return apiPost({ action: 'saveAssignment', assignment: assignment }); }
  function apiRemoveAssignment(id) { return apiPost({ action: 'removeAssignment', id: id }); }
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

  function normalizeScheduleRow(row) {
    return {
      id: row.id || uid(),
      sessionId: row.sessionId || '',
      therapist: row.therapist || '',
      treatmentType: row.treatmentType || '',
      location: row.location || '',
      scheduledDate: fmtDate(row.scheduledDate),
      patientName: row.patientName || '',
      patientPhone: row.patientPhone || '',
      attendance: row.attendance || '',
      attendanceMarkedAt: row.attendanceMarkedAt || '',
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
  async function loadAll() {
    try {
      var data = await apiLoad();
      state.schedule = (data.schedule || []).map(normalizeScheduleRow);
      state.approvals = data.approvals || [];
      state.patients = data.patients || [];
      state.assignments = data.assignments || [];
      state.therapists = data.therapists || [];
      state.treatmentTypes = data.treatmentTypes || [];
      state.loaded = true;
    } catch (e) {
      toast('שגיאה בטעינת הנתונים: ' + e.message, true);
      throw e;
    }
    // Cross-app reads are best-effort and independent; never block the app.
    await Promise.all([loadDebtRoster(), loadPlans()]);
    recomputeAlerts();
    render();
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
  function planSessionsText(s) {
    if (s == null || s === '') return '';
    if (typeof s === 'object') {
      try { return Object.keys(s).map(function (k) { return k + ': ' + s[k]; }).join(', '); }
      catch (_) { return ''; }
    }
    return String(s);
  }

  // Active outpatients come from the outpatient sibling roster (treatment plans
  // preferred, debt roster as a fallback/union), keyed by normalized phone, then
  // LEFT-JOINED with this app's local intake record. The dashboard's plan view
  // prefers Vered's locally-set main plan and falls back to the roster's.
  function activePatients() {
    var byPhone = {};
    function add(name, phone, serviceType, sessions) {
      var key = normPhone(phone);
      if (!key) return;
      if (!byPhone[key]) byPhone[key] = { name: name || '', phone: phone || '', serviceType: serviceType || '', sessions: sessions };
      else {
        if (!byPhone[key].name && name) byPhone[key].name = name;
        if (!byPhone[key].serviceType && serviceType) byPhone[key].serviceType = serviceType;
        if ((byPhone[key].sessions == null || byPhone[key].sessions === '') && sessions != null) byPhone[key].sessions = sessions;
      }
    }
    (state.plans || []).forEach(function (p) { add(p.name, p.phone, p.serviceType, p.sessions != null ? p.sessions : p.sessionsPerWeek); });
    (state.debtRoster || []).forEach(function (c) { add(c.name, c.phone); });

    // Locally-registered patients (Vered's intake) appear on the dashboard even
    // when they are not yet in the outpatient roster — they are a base source,
    // not only an overlay.
    var localByPhone = {};
    (state.patients || []).forEach(function (p) {
      var key = normPhone(p.phone);
      if (!key) return;
      localByPhone[key] = p;
      if (String(p.active) !== 'false') add(p.name, p.phone);
    });

    // A patient may have MULTIPLE active assignments (parallel treatments /
    // therapists) — collect them all per phone.
    var assignsByPhone = {};
    (state.assignments || []).forEach(function (a) {
      if (!a || String(a.active) === 'false') return;
      var key = normPhone(a.patientPhone);
      if (!key) return;
      (assignsByPhone[key] = assignsByPhone[key] || []).push({
        id: a.id, therapist: a.therapist || '', treatmentType: a.treatmentType || '',
        frequencyPerWeek: a.frequencyPerWeek != null ? String(a.frequencyPerWeek) : ''
      });
    });

    return Object.keys(byPhone).map(function (key) {
      var base = byPhone[key];
      var local = localByPhone[key] || {};
      var debt = debtEntryFor(base.phone);
      var assigns = assignsByPhone[key] || [];
      return {
        name: local.name || base.name,
        phone: base.phone,
        serviceType: base.serviceType,
        rosterSessions: planSessionsText(base.sessions),
        assignments: assigns,
        therapists: assigns.map(function (a) { return a.therapist; }).filter(Boolean),
        origin: local.origin || '',
        stillAdmitted: String(local.stillAdmitted || '') === 'true',
        admittedHouse: local.admittedHouse || '',
        debtStatus: debt ? String(debt.debtStatus || '').toLowerCase() : '',
        amountOwed: debt ? (Number(debt.amountOwed) || 0) : 0,
        key: key
      };
    });
  }
  // Short human label for a patient's assignments (multiple parallel plans).
  function assignmentSummary(p, withTherapist) {
    if (!p.assignments.length) {
      // Fall back to the outpatient roster's plan for display only.
      return p.serviceType ? svc(p.serviceType) + (p.rosterSessions ? ' · ' + p.rosterSessions + '×' : '') : '';
    }
    return p.assignments.map(function (a) {
      var bits = [svc(a.treatmentType) || '—'];
      if (a.frequencyPerWeek) bits.push(a.frequencyPerWeek + '× בשבוע');
      if (withTherapist && a.therapist) bits.unshift(a.therapist);
      return bits.join(' · ');
    }).join(' | ');
  }
  function debtEntryFor(phone) {
    var key = normPhone(phone);
    if (!key) return null;
    var hits = (state.debtRoster || []).filter(function (c) { return normPhone(c.phone) === key; });
    return hits.length === 1 ? hits[0] : null;
  }
  function patientByPhone(phone) {
    var key = normPhone(phone);
    return activePatients().filter(function (p) { return p.key === key; })[0] || null;
  }

  // --- render ------------------------------------------------------------
  function render() {
    syncDropdowns();
    renderDashboard();
    renderAssign();
    renderSchedule();
    renderMine();
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

  function patientUpcomingAlert(phone) {
    var key = normPhone(phone);
    for (var i = 0; i < state.alerts.length; i++) {
      if (normPhone(state.alerts[i].patientPhone) === key) return state.alerts[i];
    }
    return null;
  }

  function patientCard(p) {
    var badges = '';
    if (p.stillAdmitted) badges += ' <span class="chip chip-partial">עדיין מאושפז/ת' + (p.admittedHouse ? ' · ' + escapeHtml(houseLabel(p.admittedHouse)) : '') + '</span>';
    var parts = [];
    parts.push('<div class="p-name">' + escapeHtml(p.name) + badges + '</div>');
    parts.push('<div><span class="p-label">טלפון</span><span class="p-val">' + escapeHtml(p.phone) + '</span></div>');
    var thers = p.therapists.length ? escapeHtml(p.therapists.join(', ')) : '<em>לא שויך</em>';
    parts.push('<div><span class="p-label">מטפל/ת אחראי/ת</span><span class="p-val">' + thers + '</span></div>');
    var plan = assignmentSummary(p, false);
    parts.push('<div class="wide"><span class="p-label">תוכנית טיפול</span><span class="p-val">' + (plan ? escapeHtml(plan) : '—') + '</span></div>');
    if (p.origin) parts.push('<div><span class="p-label">מקור הגעה</span><span class="p-val">' + escapeHtml(p.origin) + '</span></div>');
    parts.push('<div>' + debtChip(p.debtStatus, p.amountOwed) + '</div>');
    var al = patientUpcomingAlert(p.phone);
    if (al) parts.push('<div class="wide alert-row">⚠️ נכנס/ה לחוב לאחר קביעת הטיפול (' + money(al.amountOwed) + ') — יש לבדוק טיפול עתידי</div>');
    // Dashboard is VIEW-ONLY for everyone — no edit/schedule actions here.
    return '<div class="billing-row">' + parts.join('') + '</div>';
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
  function gateChip(r) {
    if (r.gateStatus === 'approved') return '<span class="chip chip-partial">אושר למרות חוב (' + money(r.amountOwed) + ')</span>';
    if (r.gateStatus === 'flagged') return '<span class="chip chip-unpaid">לבירור</span>';
    if (r.gateStatus === 'clear') return '<span class="chip chip-paid">ללא חוב</span>';
    return '';
  }

  function patientLine(r) {
    var al = alertFor(r.id);
    var attBtns = '<span class="att-btns edit-only">' +
      '<button class="btn btn-ghost btn-sm" data-att="occurred" data-id="' + escapeHtml(r.id) + '">התקיים</button>' +
      '<button class="btn btn-ghost btn-sm" data-att="missed" data-id="' + escapeHtml(r.id) + '">לא התקיים</button>' +
      '</span>';
    return '<div class="sess-patient">' +
      '<span class="sess-pname">' + escapeHtml(r.patientName) + '</span> ' +
      gateChip(r) + ' ' + attendanceChip(r) + syncBadge(r) + ' ' + attBtns +
      (al ? '<div class="alert-row">⚠️ נכנס/ה לחוב לאחר קביעת הטיפול (' + money(al.amountOwed) + ')</div>' : '') +
      '</div>';
  }

  function sessionCard(rows) {
    var head = rows[0];
    var isGroup = rows.length > 1;
    var parts = [];
    parts.push('<div class="sess-head">' +
      '<span class="sess-date">' + escapeHtml(displayDate(head.scheduledDate)) + '</span>' +
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
  function renderAssign() {
    var list = activePatients().filter(function (p) {
      // Filter by therapist (matches ANY of the patient's assigned therapists) AND name.
      var byTher = !state.workflowTherapist || p.therapists.indexOf(state.workflowTherapist) !== -1;
      return byTher && matchName(p.name, state.workflowSearch);
    }).sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); });
    var rows = list.map(function (p) {
      var thers = p.therapists.length ? escapeHtml(p.therapists.join(', ')) : '<em>לא שויך</em>';
      return '<div class="assign-row">' +
        '<span class="assign-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="assign-ther">' + thers + '</span>' +
        '<span class="assign-type">' + (assignmentSummary(p, false) ? escapeHtml(assignmentSummary(p, false)) : '—') + '</span>' +
        '<span class="assign-actions edit-only">' +
          '<button class="btn btn-ghost btn-sm" data-edit-patient="' + escapeHtml(p.phone) + '">פרטים</button>' +
          '<button class="btn btn-ghost btn-sm" data-assignments-patient="' + escapeHtml(p.phone) + '">שיבוץ ותוכנית</button>' +
          '<button class="btn btn-primary btn-sm" data-schedule-patient="' + escapeHtml(p.phone) + '">+ קביעת טיפול</button>' +
        '</span>' +
        '</div>';
    });
    $('#assignList').innerHTML = rows.length ? rows.join('') : '<div class="billing-empty">אין מטופלים</div>';
  }

  // --- my treatments (tab 3) — friendly per-therapist did-it-happen view --
  function mineRow(r) {
    // Marking is the payment trigger, so it lives behind EDIT MODE: a therapist
    // picks their name (no personal PIN), turns on «עריכה», then marks. The
    // per-patient payment check + "no mark = no pay" deter false reporting.
    var attBtns = '<span class="att-btns edit-only">' +
      '<button class="btn btn-ghost btn-sm" data-mine-att="occurred" data-id="' + escapeHtml(r.id) + '">התקיים</button>' +
      '<button class="btn btn-ghost btn-sm" data-mine-att="missed" data-id="' + escapeHtml(r.id) + '">לא התקיים</button>' +
      '</span>';
    return '<div class="billing-row mine-row">' +
      '<div class="p-name">' + escapeHtml(r.patientName) + '</div>' +
      '<div><span class="p-label">תאריך</span><span class="p-val">' + escapeHtml(displayDate(r.scheduledDate)) + '</span></div>' +
      '<div><span class="p-label">טיפול</span><span class="p-val">' + escapeHtml(svc(r.treatmentType)) + '</span></div>' +
      '<div><span class="p-label">מיקום</span><span class="p-val">' + escapeHtml(locationLabel(r.location)) + '</span></div>' +
      '<div>' + attendanceChip(r) + syncBadge(r) + '</div>' +
      '<div class="row-actions">' + attBtns + '</div>' +
      '</div>';
  }

  function renderMine() {
    // Keep the picker in sync with the chosen identity.
    var sel = $('#myTherapist');
    if (sel && sel.value !== state.therapist) sel.value = state.therapist || '';

    var pending = pendingSyncCount();
    var banner = $('#syncBanner');
    if (banner) {
      if (pending > 0) {
        banner.hidden = false;
        banner.innerHTML = '⚠️ ' + pending + ' סימוני טיפול ממתינים לסנכרון למערכת התשלומים. ' +
          '<button id="syncNowBtn" class="btn btn-ghost btn-sm">סנכרן עכשיו</button>';
      } else { banner.hidden = true; banner.innerHTML = ''; }
    }

    var panels = ['#mineScheduledPanel', '#mineUpcomingPanel', '#minePerformedPanel', '#mineNotPerformedPanel'];
    var empty = $('#mineEmpty');
    if (!state.therapist) {
      empty.hidden = false;
      panels.forEach(function (s) { $(s).hidden = true; });
      return;
    }
    empty.hidden = true;

    // My treatments = treatments I perform; a patient may also have parallel
    // treatments with other therapists (those show in their own «המטופלים שלי»).
    var mine = state.schedule.filter(function (r) {
      return r.therapist === state.therapist && matchName(r.patientName, state.mineSearch);
    });
    var byDate = function (a, b) { return String(a.scheduledDate).localeCompare(String(b.scheduledDate)); };
    var b = Scheduling.bucketMine(mine, today());

    function fill(panelSel, listSel, rows) {
      $(panelSel).hidden = rows.length === 0;
      $(listSel).innerHTML = rows.sort(byDate).map(mineRow).join('');
    }
    fill('#mineScheduledPanel', '#mineScheduled', b.scheduled);
    fill('#mineUpcomingPanel', '#mineUpcoming', b.upcoming);
    fill('#minePerformedPanel', '#minePerformed', b.performed);
    fill('#mineNotPerformedPanel', '#mineNotPerformed', b.notPerformed);
  }

  function syncNow() {
    toast('מסנכרן…');
    apiSyncPending()
      .then(function () { return loadAll(); })
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
  // term shows directly). Fix: ליווי יומי בקהילה is now selectable/visible.
  function typeOptionList(selected) {
    return ['<option value="">—</option>'].concat(activeTypeNames().map(function (n) {
      var sel = (n === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(n) + '"' + sel + '>' + escapeHtml(svc(n)) + '</option>';
    })).join('');
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

  function syncDropdowns() {
    var tNames = activeTherapistNames();
    // The «המטופלים שלי» identity picker must include the saved name even if retired.
    var idNames = tNames.slice();
    if (state.therapist && idNames.indexOf(state.therapist) === -1) idNames.push(state.therapist);
    var st = $('#scheduleTherapist'); if (st) st.innerHTML = optionList(tNames, state.therapist);
    var pt = $('#patientTherapist'); if (pt) pt.innerHTML = '<option value="">— לא שויך —</option>' +
      tNames.map(function (n) { return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; }).join('');
    var sty = $('#scheduleType'); if (sty) { var styv = sty.value; sty.innerHTML = typeOptionList(); sty.value = styv; }
    var pty = $('#patientType'); if (pty) { var ptyv = pty.value; pty.innerHTML = typeOptionList(); pty.value = ptyv; }
    var sl = $('#scheduleLocation'); if (sl) sl.innerHTML = locationOptions();
    var ah = $('#admittedHouse'); if (ah) ah.innerHTML = houseOptions();
    // Identity-screen name picker + the tab-3 picker.
    var idt = $('#idTherapist'); if (idt) { var idv = idt.value; idt.innerHTML = optionList(tNames, idv); idt.value = idv; }
    var my = $('#myTherapist'); if (my) my.innerHTML = optionList(idNames, state.therapist);
    var wf = $('#workflowTherapistFilter'); if (wf) wf.innerHTML = '<option value="">כל המטפלים</option>' +
      tNames.map(function (n) { var s = (n === state.workflowTherapist) ? ' selected' : ''; return '<option value="' + escapeHtml(n) + '"' + s + '>' + escapeHtml(n) + '</option>'; }).join('');

    var roster = activePatients();
    var names = roster.map(function (p) { return p.name; }).filter(Boolean);
    var rn = $('#rosterNames');
    if (rn) rn.innerHTML = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    $$('.patient-name-dl').forEach(function (dl) {
      dl.innerHTML = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
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
      '<input class="patient-phone" name="pphone" inputmode="numeric" maxlength="10" placeholder="0501234567" value="' + escapeHtml(prefill.phone || '') + '" />' +
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

  function openScheduleModal(prefillPatient) {
    if (!ensureTherapist()) return;
    var form = $('#scheduleForm');
    form.reset();
    resetGateResults();
    form.querySelector('[name="scheduledDate"]').value = today();
    $('#patientRows').innerHTML = '';
    patientRowSeq = 0;
    addPatientRow(prefillPatient || {});
    // syncDropdowns ran inside addPatientRow; now apply defaults.
    $('#scheduleTherapist').value = (prefillPatient && prefillPatient.therapist) || state.therapist || '';
    if (prefillPatient && prefillPatient.treatmentType) $('#scheduleType').value = prefillPatient.treatmentType;
    updateGroupUi();
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
    return {
      therapist: (fd.get('therapist') || '').trim(),
      treatmentType: (fd.get('treatmentType') || '').trim(),
      location: (fd.get('location') || '').trim(),
      scheduledDate: fd.get('scheduledDate') || ''
    };
  }

  function renderGateResults() {
    var g = $('#gateResults');
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
      return '<div class="gate-patient">' +
        '<div class="gate-pname">' + escapeHtml(pp.name) + ' <span class="muted">' + escapeHtml(pp.phone) + '</span> ' + status + '</div>' +
        body + '</div>';
    }).join('');
    var anyBlock = pendingPatients.some(function (pp) { return pp.gate.decision === 'block'; });
    var anyLookupFail = pendingPatients.some(function (pp) { return pp.gate.reason === 'lookup_failed'; });
    g.hidden = false;
    g.innerHTML = '<div class="form-section-title">בדיקת חוב למטופלים</div>' + rowsHtml;
    $('#scheduleSubmit').textContent = anyLookupFail ? 'נסה שוב' : (anyBlock ? 'אשר ושמור' : 'שמור');
  }

  async function handleScheduleSubmit() {
    var sub = $('#scheduleSubmit');
    if (sub.disabled) return;
    var session = readSession();

    // Phase 2 — gate already ran, build rows from the resolved decisions.
    if (pendingPatients) {
      if (pendingPatients.some(function (pp) { return pp.gate.reason === 'lookup_failed'; })) {
        pendingPatients = null;   // re-run the gate, never save blind
      } else {
        return finalizeSchedule(session);
      }
    }

    // Phase 1 — validate session + patients, then run the gate per patient.
    var sv = Scheduling.validateSession(session);
    if (!sv.ok) { toast(sv.error, true); return; }
    var rawPatients = patientRowsData();
    if (!rawPatients.length) { toast('יש להזין מטופל/ת אחד לפחות', true); return; }
    var isGroup = Scheduling.isGroupType(session.treatmentType, state.treatmentTypes);
    if (!isGroup && rawPatients.length > 1) { toast('סוג טיפול זה מאפשר מטופל/ת אחד בלבד', true); return; }

    var patients = [];
    for (var i = 0; i < rawPatients.length; i++) {
      var rp = rawPatients[i];
      if (!rp.name) { toast('חסר שם מטופל/ת', true); return; }
      var pv = Phone.validateCanonical(rp.phone);
      if (!pv.ok) { toast(rp.name + ': ' + pv.error, true); return; }
      patients.push({ name: rp.name, phone: pv.value });
    }

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
        patients.push({ name: pp.name, phone: pp.phone, gateStatus: 'clear' });
      } else if (d === 'flag') {
        patients.push({ name: pp.name, phone: pp.phone, gateStatus: 'flagged', gateReason: pp.gate.reason });
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

    var rows = Scheduling.buildSessionRows(session, patients, {
      sessionId: 's_' + uid(), idFn: function () { return uid(); }, now: today()
    });
    var nameById = {};
    rows.forEach(function (r) { nameById[r.id] = r.patientName; });
    sub.disabled = true;
    apiSaveSession(rows)
      .then(function (res) {
        var failed = (res.results || []).filter(function (r) { return !r.ok; });
        if (failed.length) {
          var who = failed.map(function (f) { return (nameById[f.id] || '') + ' (' + saveErrorText(f.error) + ')'; });
          toast('חלק מהמטופלים לא נקבעו: ' + who.join('; '), true);
        } else {
          toast('הטיפול נקבע');
        }
        return loadAll();
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
    invalid_gate_status: 'סטטוס שער לא תקין'
  };
  function saveErrorText(code) { return SAVE_ERROR_TEXT[code] || code || 'נדחה'; }

  // --- attendance --------------------------------------------------------
  // The mark is the payment trigger (no mark = no pay) and triggers the
  // outpatient write-back server-side. Local state is the source of truth; the
  // returned syncStatus tells us whether the write-back reached outpatient.
  function markAttendance(id, value) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    var next = (row.attendance === value) ? '' : value;   // toggle off if re-clicked
    var prev = row.attendance;
    row.attendance = next;
    // The whole session is re-synced together; reflect optimistic "pending".
    state.schedule.forEach(function (r) { if (r.sessionId === row.sessionId) r.syncStatus = 'pending'; });
    recomputeAlerts();
    render();
    apiMarkAttendance(id, next)
      .then(function (res) {
        var status = res && res.syncStatus;
        if (status) state.schedule.forEach(function (r) { if (r.sessionId === row.sessionId) r.syncStatus = status; });
        render();
        var msg = next === 'occurred' ? 'סומן כהתקיים' : next === 'missed' ? 'סומן כלא התקיים' : 'הסימון בוטל';
        if (status === 'pending') msg += ' (ממתין לסנכרון)';
        toast(msg);
      })
      .catch(function (err) { row.attendance = prev; recomputeAlerts(); render(); toast('שגיאה: ' + err.message, true); });
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
  function openNewPatient() {
    if (!ensureVered()) return;
    $('#patientModalTitle').textContent = 'רישום מטופל חדש';
    fillPatientForm(null);
    $('#initialAssignmentSection').hidden = false;   // initial assignment only for new
    $('#patientForm [name="phone"]').readOnly = false;
    $('#patientModal').hidden = false;
  }
  function openPatientModal(phone) {
    if (!ensureVered()) return;
    var rec = patientByPhone(phone);
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
    var pv = Phone.validateCanonical((fd.get('phone') || '').trim());
    if (!pv.ok) { toast(pv.error, true); return; }
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
    apiSavePatient(patient)
      .then(function () {
        if (!wantInitial) return;
        return apiSaveAssignment({
          id: uid(), patientPhone: pv.value, therapist: initTher,
          treatmentType: initType, frequencyPerWeek: initFreq, updatedBy: state.therapist || 'עורך'
        });
      })
      .then(function () { toast('נשמר'); return loadAll(); })
      .then(function () { closePatientModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { sub.disabled = false; });
  }

  // --- assignments modal (multiple therapists/plans per patient) --------
  var assignmentsCtx = { phone: '', removed: [] };
  function assignmentRowHtml(a) {
    a = a || {};
    return '<div class="assignment-row" data-aid="' + escapeHtml(a.id || '') + '">' +
      '<select class="a-therapist">' + optionList(activeTherapistNames(), a.therapist || '') + '</select>' +
      '<select class="a-type">' + typeOptionList(resolveTypeOption(a.treatmentType || '')) + '</select>' +
      '<input class="a-freq" type="number" min="0" max="14" step="1" placeholder="תדירות" value="' + escapeHtml(a.frequencyPerWeek || '') + '" />' +
      '<button type="button" class="btn btn-ghost btn-sm remove-assignment" title="הסר">✕</button>' +
      '</div>';
  }
  function openAssignmentsModal(phone) {
    if (!ensureVered()) return;
    var p = patientByPhone(phone);
    if (!p) { toast('מטופל/ת לא נמצא', true); return; }
    assignmentsCtx = { phone: p.phone, removed: [] };
    $('#assignmentsPatientName').textContent = p.name;
    var rows = p.assignments.length ? p.assignments.map(assignmentRowHtml) : [assignmentRowHtml({})];
    $('#assignmentRows').innerHTML = rows.join('');
    $('#assignmentsModal').hidden = false;
  }
  function closeAssignmentsModal() { $('#assignmentsModal').hidden = true; }
  function addAssignmentRow() {
    var div = document.createElement('div');
    div.innerHTML = assignmentRowHtml({});
    $('#assignmentRows').appendChild(div.firstChild);
  }
  function saveAssignments() {
    var btn = $('#assignmentsSave');
    if (btn.disabled) return;
    var phone = assignmentsCtx.phone;
    var rows = $$('#assignmentRows .assignment-row');
    var toSave = [];
    var keptIds = {};
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var ther = (el.querySelector('.a-therapist').value || '').trim();
      var type = (el.querySelector('.a-type').value || '').trim();
      var freq = (el.querySelector('.a-freq').value || '').trim();
      if (!ther && !type) continue;                       // blank row -> skip
      if (!ther) { toast('יש לבחור מטפל/ת לכל שיבוץ', true); return; }
      var aid = el.getAttribute('data-aid') || '';
      if (aid) keptIds[aid] = true;
      toSave.push({ id: aid || uid(), patientPhone: phone, therapist: ther, treatmentType: type, frequencyPerWeek: freq, updatedBy: state.therapist || 'עורך' });
    }
    // Existing assignments whose row was deleted -> remove.
    var existing = (patientByPhone(phone) || { assignments: [] }).assignments;
    var toRemove = existing.filter(function (a) { return a.id && !keptIds[a.id]; }).map(function (a) { return a.id; });

    btn.disabled = true;
    var chain = Promise.resolve();
    toSave.forEach(function (a) { chain = chain.then(function () { return apiSaveAssignment(a); }); });
    toRemove.forEach(function (id) { chain = chain.then(function () { return apiRemoveAssignment(id); }); });
    chain
      .then(function () { toast('השיבוצים נשמרו'); return loadAll(); })
      .then(function () { closeAssignmentsModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { btn.disabled = false; });
  }

  function ensureVered() {
    if (isVered()) return true;
    toast('פעולה זו זמינה לורד (משרד) בלבד', true); return false;
  }
  function ensureTherapist() {
    if (isTherapist()) return true;
    toast('פעולה זו זמינה למטפל/ת בלבד', true); return false;
  }

  // --- auth / role / edit mode -------------------------------------------
  // Show only the current role's tabs; the badge shows who you are.
  function applyRole() {
    document.body.classList.remove('role-vered', 'role-therapist');
    if (state.role) document.body.classList.add('role-' + state.role);
    var badge = $('#whoami');
    if (badge) badge.textContent = isVered() ? 'ורד' : (state.therapist || '');
    $$('.tab').forEach(function (t) {
      t.hidden = !Access.canViewTab(state.role, t.dataset.view);
    });
  }
  function applyTherapist() { var s = $('#myTherapist'); if (s) s.value = state.therapist || ''; }

  function showIdentity() {
    $('#identityScreen').hidden = false;
    $('#app').hidden = true;
    syncDropdowns();   // populate the therapist picker if data is loaded
  }
  // Enter as a chosen role. For a therapist, `name` is their picked name.
  function enterApp(role, name) {
    state.role = role;
    state.therapist = (role === 'therapist') ? (name || '') : '';
    try { sessionStorage.setItem('ez_identity', JSON.stringify({ role: role, therapist: state.therapist })); } catch (_) {}
    $('#identityScreen').hidden = true;
    $('#app').hidden = false;
    applyRole();
    applyTherapist();
    setView(Access.defaultView(state.role) || 'dashboard');
  }

  function setView(view) {
    if (!Access.canViewTab(state.role, view)) view = Access.defaultView(state.role) || view;
    state.view = view;
    document.body.classList.remove('view-dashboard', 'view-workflow', 'view-mine');
    document.body.classList.add('view-' + view);
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
  }

  function on(sel, ev, fn) {
    var el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) { console.warn('[ezone-therapists] missing element for', sel); return; }
    el.addEventListener(ev, fn);
  }

  function wireEvents() {
    // Identity screen — pick who you are (no password).
    on('#idVered', 'click', function () { enterApp('vered'); });
    on('#idTherapistGo', 'click', function () {
      var name = ($('#idTherapist').value || '').trim();
      if (!name) { var e = $('#idError'); if (e) e.hidden = false; return; }
      enterApp('therapist', name);
    });
    on('#idTherapist', 'change', function () { var e = $('#idError'); if (e) e.hidden = true; });
    on('#logoutBtn', 'click', function () {
      try { sessionStorage.removeItem('ez_identity'); } catch (_) {}
      state.role = ''; state.therapist = '';
      showIdentity();
    });

    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { setView(t.dataset.view); }); });
    on('#refreshBtn', 'click', function () { loadAll().then(function () { toast('רועננו'); }).catch(function () {}); });

    on('#dashboardSearch', 'input', function (e) { state.dashboardSearch = e.target.value; renderDashboard(); });
    on('#workflowSearch', 'input', function (e) { state.workflowSearch = e.target.value; renderSchedule(); });

    on('#newPatientBtn', 'click', openNewPatient);   // dashboard only
    on('#addScheduleBtn', 'click', function () { openScheduleModal(); });

    // Delegated patient actions — shared by the dashboard list and the שיבוץ
    // assign list (so a newly registered patient is actionable in both).
    function onPatientListClick(e) {
      var ep = e.target.closest('[data-edit-patient]');
      if (ep) { openPatientModal(ep.getAttribute('data-edit-patient')); return; }
      var ap = e.target.closest('[data-assignments-patient]');
      if (ap) { openAssignmentsModal(ap.getAttribute('data-assignments-patient')); return; }
      var sp = e.target.closest('[data-schedule-patient]');
      if (sp) {
        var rec = patientByPhone(sp.getAttribute('data-schedule-patient'));
        var first = rec && rec.assignments[0];
        openScheduleModal(rec ? { name: rec.name, phone: rec.phone, treatmentType: first ? first.treatmentType : '', therapist: first ? first.therapist : '' } : null);
      }
    }
    on('#patientsList', 'click', onPatientListClick);
    on('#assignList', 'click', onPatientListClick);
    on('#scheduleList', 'click', function (e) {
      var b = e.target.closest('[data-att]');
      if (b) { if (!ensureTherapist()) return; markAttendance(b.getAttribute('data-id'), b.getAttribute('data-att')); }
    });

    // Tab 3 «המטפל שלי»: identity picker, search, mark (open to all, no PIN), sync.
    on('#myTherapist', 'change', function (e) {
      state.therapist = (e.target.value || '').trim();
      try { sessionStorage.setItem('ez_therapist', state.therapist); } catch (_) {}
      applyTherapist();
      renderMine();
    });
    on('#mineSearch', 'input', function (e) { state.mineSearch = e.target.value; renderMine(); });
    on('#view-mine', 'click', function (e) {
      var b = e.target.closest('[data-mine-att]');
      if (b) { markAttendance(b.getAttribute('data-id'), b.getAttribute('data-mine-att')); return; }
      if (e.target.closest('#syncNowBtn')) syncNow();
    });
    on('#workflowTherapistFilter', 'change', function (e) {
      state.workflowTherapist = e.target.value || '';
      renderAssign(); renderSchedule();
    });

    // Schedule modal: group toggle, add/remove patients.
    on('#scheduleType', 'change', updateGroupUi);
    on('#addPatientRowBtn', 'click', function () { addPatientRow(); updateGroupUi(); });
    on('#patientRows', 'click', function (e) {
      var rm = e.target.closest('.remove-patient');
      if (rm) { var row = rm.closest('.patient-row'); if ($$('#patientRows .patient-row').length > 1) row.remove(); }
    });
    // Editing a patient identity invalidates a pending gate result.
    on('#patientRows', 'input', function () { if (pendingPatients) resetGateResults(); });

    on('#stillAdmitted', 'change', function (e) { $('#admittedDetails').hidden = !e.target.checked; });

    // Assignments modal: add row, remove row, save.
    on('#addAssignmentRowBtn', 'click', addAssignmentRow);
    on('#assignmentRows', 'click', function (e) {
      var rm = e.target.closest('.remove-assignment');
      if (rm) rm.closest('.assignment-row').remove();
    });
    on('#assignmentsSave', 'click', saveAssignments);

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeScheduleModal(); closePatientModal(); closeAssignmentsModal(); });
    });

    on('#scheduleForm', 'submit', function (e) { e.preventDefault(); handleScheduleSubmit(); });
    on('#patientForm', 'submit', function (e) { e.preventDefault(); handlePatientSubmit(); });
  }

  function init() {
    try { wireEvents(); } catch (e) { console.error('[ezone-therapists] wireEvents failed', e); }
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('ez_identity') || 'null'); } catch (_) {}
    if (saved && Access.isRole(saved.role)) enterApp(saved.role, saved.therapist);
    else showIdentity();
    loadAll().catch(function () {});
  }

  function bootWhenReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  bootWhenReady();
})();
