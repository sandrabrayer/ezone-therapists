/* E-ZONE Therapists — frontend (iteration 2: scheduling) */
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

  // Scheduling LOCATIONS are a fixed code list (id stored, Hebrew shown). This
  // is the therapist's scheduling choice — independent of any roster house, and
  // 'raanana' here has no roster-house equivalent (expected).
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

  // Hebrew copy for each gate flag reason (stable ids come from debt-gate.js).
  var FLAG_TEXT = {
    no_payment_record: 'אין רישום תשלומים עבור מטופל זה — לא ניתן לקבוע חוב. דרוש בירור ידני.',
    no_record: 'הטלפון אינו תואם לאף מטופל חוץ. דרוש בירור ידני.',
    ambiguous: 'הטלפון תואם ליותר ממטופל אחד. דרוש בירור ידני.',
    lookup_failed: 'בדיקת החוב נכשלה כרגע. לא ניתן לאשר טיפול ללא בדיקה — נסה שוב או פנה לבירור.'
  };

  // --- state -------------------------------------------------------------
  var state = {
    role: 'viewer',
    therapist: '',
    view: 'patients',
    schedule: [],
    approvals: [],
    patients: [],
    therapists: [],
    treatmentTypes: [],
    debtRoster: [], debtRosterOk: false,
    plans: [], plansOk: false,
    admitted: [], admittedOk: false,
    alerts: [],
    patientsSearch: '',
    scheduleSearch: '',
    plansSearch: '',
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
  function apiSaveSession(rows) { return apiPost({ action: 'saveSession', rows: rows }); }
  function apiMarkAttendance(id, attendance) { return apiPost({ action: 'markAttendance', id: id, attendance: attendance }); }
  function apiSavePatient(patient) { return apiPost({ action: 'savePatient', patient: patient }); }
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
      created: row.created || ''
    };
  }

  // --- loading -----------------------------------------------------------
  async function loadAll() {
    try {
      var data = await apiLoad();
      state.schedule = (data.schedule || []).map(normalizeScheduleRow);
      state.approvals = data.approvals || [];
      state.patients = data.patients || [];
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
  // Active outpatients come from the outpatient sibling roster (treatment plans
  // preferred, debt roster as a fallback/union), keyed by normalized phone. We
  // then LEFT-JOIN this app's local Patients extras (assignment, inpatient flag).
  function activePatients() {
    var byPhone = {};
    function add(name, phone, serviceType) {
      var key = normPhone(phone);
      if (!key) return;
      if (!byPhone[key]) byPhone[key] = { name: name || '', phone: phone || '', serviceType: serviceType || '' };
      else if (!byPhone[key].name && name) byPhone[key].name = name;
    }
    (state.plans || []).forEach(function (p) { add(p.name, p.phone, p.serviceType); });
    (state.debtRoster || []).forEach(function (c) { add(c.name, c.phone); });

    var localByPhone = {};
    (state.patients || []).forEach(function (p) {
      var key = normPhone(p.phone);
      if (key) localByPhone[key] = p;
    });

    return Object.keys(byPhone).map(function (key) {
      var base = byPhone[key];
      var local = localByPhone[key] || {};
      var debt = debtEntryFor(base.phone);
      return {
        name: local.name || base.name,
        phone: base.phone,
        serviceType: base.serviceType,
        assignedTherapist: local.assignedTherapist || '',
        fromInpatient: String(local.fromInpatient || '') === 'true',
        admittedLocation: local.admittedLocation || '',
        outpatientStartDate: fmtDate(local.outpatientStartDate || ''),
        debtStatus: debt ? String(debt.debtStatus || '').toLowerCase() : '',
        amountOwed: debt ? (Number(debt.amountOwed) || 0) : 0,
        key: key
      };
    });
  }
  function debtEntryFor(phone) {
    var key = normPhone(phone);
    if (!key) return null;
    var hits = (state.debtRoster || []).filter(function (c) { return normPhone(c.phone) === key; });
    return hits.length === 1 ? hits[0] : null;
  }

  // --- render ------------------------------------------------------------
  function render() {
    renderPatients();
    renderSchedule();
    renderPlans();
    syncDropdowns();
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

  function renderPatients() {
    var list = activePatients();
    var assigned = list.filter(function (p) { return p.assignedTherapist; }).length;
    $('#kpiPatients').textContent = list.length;
    $('#kpiAssigned').textContent = assigned;
    $('#kpiAlerts').textContent = state.alerts.length;

    var notice = $('#patientsNotice');
    if (!state.plansOk && !state.debtRosterOk) {
      notice.hidden = false;
      notice.textContent = 'רשימת המטופלים הפעילים אינה זמינה כרגע (תלוי בנקודות הקצה של מטופלי החוץ).';
    } else { notice.hidden = true; }

    // Alert banner on the dashboard.
    renderAlertBanner($('#alertBanner'));

    var rows = list
      .filter(function (p) { return matchName(p.name, state.patientsSearch); })
      .sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); })
      .map(function (p) { return patientCard(p); });
    $('#patientsList').innerHTML = rows.length ? rows.join('') : '<div class="billing-empty">אין מטופלים פעילים</div>';
  }

  function patientUpcomingAlert(phone) {
    var key = normPhone(phone);
    for (var i = 0; i < state.alerts.length; i++) {
      if (normPhone(state.alerts[i].patientPhone) === key) return state.alerts[i];
    }
    return null;
  }

  function patientCard(p) {
    var parts = [];
    parts.push('<div class="p-name">' + escapeHtml(p.name) +
      (p.fromInpatient ? ' <span class="chip chip-partial">עבר/ה מאשפוז</span>' : '') + '</div>');
    parts.push('<div><span class="p-label">טלפון</span><span class="p-val">' + escapeHtml(p.phone) + '</span></div>');
    parts.push('<div><span class="p-label">מטפל/ת אחראי/ת</span><span class="p-val">' +
      (p.assignedTherapist ? escapeHtml(p.assignedTherapist) : '<em>לא שויך</em>') + '</span></div>');
    if (p.serviceType) parts.push('<div><span class="p-label">סוג</span><span class="p-val">' + escapeHtml(p.serviceType) + '</span></div>');
    if (p.fromInpatient && p.admittedLocation) parts.push('<div><span class="p-label">אושפז ב</span><span class="p-val">' + escapeHtml(p.admittedLocation) + '</span></div>');
    parts.push('<div>' + debtChip(p.debtStatus, p.amountOwed) + '</div>');
    var al = patientUpcomingAlert(p.phone);
    if (al) parts.push('<div class="wide alert-row">⚠️ נכנס/ה לחוב לאחר תזמון (' + money(al.amountOwed) + ') — יש לבדוק טיפול עתידי</div>');
    parts.push('<div class="row-actions edit-only">' +
      '<button class="btn btn-ghost btn-sm" data-edit-patient="' + escapeHtml(p.phone) + '">שיוך / עריכה</button>' +
      '<button class="btn btn-primary btn-sm" data-schedule-patient="' + escapeHtml(p.phone) + '">+ קביעת טיפול</button>' +
      '</div>');
    return '<div class="billing-row">' + parts.join('') + '</div>';
  }

  function renderAlertBanner(el) {
    if (!el) return;
    if (!state.alerts.length) { el.hidden = true; el.innerHTML = ''; return; }
    var names = state.alerts.map(function (a) { return escapeHtml(a.patientName) + ' (' + money(a.amountOwed) + ')'; });
    el.hidden = false;
    el.innerHTML = '⚠️ ' + state.alerts.length + ' מטופלים נכנסו לחוב לאחר תזמון טיפול: ' + names.join(', ') +
      '. יש לבדוק את הטיפולים הקרובים בלשונית «לוח טיפולים».';
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
      gateChip(r) + ' ' + attendanceChip(r) + ' ' + attBtns +
      (al ? '<div class="alert-row">⚠️ נכנס/ה לחוב לאחר תזמון (' + money(al.amountOwed) + ')</div>' : '') +
      '</div>';
  }

  function sessionCard(rows) {
    var head = rows[0];
    var isGroup = rows.length > 1;
    var parts = [];
    parts.push('<div class="sess-head">' +
      '<span class="sess-date">' + escapeHtml(displayDate(head.scheduledDate)) + '</span>' +
      '<span class="chip">' + escapeHtml(head.treatmentType) + (isGroup ? ' · ' + rows.length + ' מטופלים' : '') + '</span>' +
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
      return (r.attendance === '' ) && fmtDate(r.scheduledDate) >= t;
    }).length;
    $('#kpiUpcoming').textContent = upcoming;
    $('#kpiScheduleAlerts').textContent = state.alerts.length;

    var groups = sessionGroups().filter(function (rows) {
      return rows.some(function (r) { return matchName(r.patientName, state.scheduleSearch); });
    });
    groups.sort(function (a, b) { return String(b[0].scheduledDate || '').localeCompare(String(a[0].scheduledDate || '')); });
    var cards = groups.map(sessionCard);
    $('#scheduleList').innerHTML = cards.length ? cards.join('') : '<div class="billing-empty">לא תוזמנו טיפולים</div>';
  }

  function planSessionsText(p) {
    var s = p.sessions || p.sessionsPerWeek;
    if (s == null || s === '') return '';
    if (typeof s === 'object') {
      try { return Object.keys(s).map(function (k) { return k + ': ' + s[k]; }).join(', '); }
      catch (_) { return ''; }
    }
    return String(s);
  }

  function renderPlans() {
    var notice = $('#plansNotice');
    if (!state.plansOk) {
      notice.hidden = false;
      notice.textContent = 'תוכניות הטיפול אינן זמינות כרגע (תלוי בפריסת נקודת הקצה getTreatmentPlans בצד מטופלי החוץ).';
    } else { notice.hidden = true; }
    var q = state.plansSearch;
    var cards = (state.plans || [])
      .filter(function (p) { return matchName(p.name, q); })
      .map(function (p) {
        var sessions = planSessionsText(p);
        return '<div class="client-card">' +
          '<div class="client-head"><div class="client-name">' + escapeHtml(p.name || '') + '</div></div>' +
          '<div class="client-meta">' +
            '<span class="chip">' + escapeHtml(p.serviceType || '—') + '</span>' +
            (p.phone ? '<span class="chip">' + escapeHtml(p.phone) + '</span>' : '') +
          '</div>' +
          (sessions ? '<div class="client-stats">מפגשים: <b>' + escapeHtml(sessions) + '</b></div>' : '') +
        '</div>';
      });
    $('#plansList').innerHTML = cards.join('');
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
  function locationOptions(selected) {
    return ['<option value="">—</option>'].concat(LOCATIONS.map(function (l) {
      var sel = (l.id === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(l.id) + '"' + sel + '>' + escapeHtml(l.he) + '</option>';
    })).join('');
  }

  function syncDropdowns() {
    var tNames = activeTherapistNames();
    // Therapist identity picker (must include the saved name even if retired).
    var idNames = tNames.slice();
    if (state.therapist && idNames.indexOf(state.therapist) === -1) idNames.push(state.therapist);
    var ts = $('#therapistSelect'); if (ts) ts.innerHTML = optionList(idNames, state.therapist);
    var st = $('#scheduleTherapist'); if (st) st.innerHTML = optionList(tNames, state.therapist);
    var pt = $('#patientTherapist'); if (pt) pt.innerHTML = '<option value="">— לא שויך —</option>' +
      tNames.map(function (n) { return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; }).join('');
    var sty = $('#scheduleType'); if (sty) sty.innerHTML = optionList(activeTypeNames());
    var sl = $('#scheduleLocation'); if (sl) sl.innerHTML = locationOptions();
    var al = $('#admittedLocation'); if (al) al.innerHTML = locationOptions();

    var roster = activePatients();
    var names = roster.map(function (p) { return p.name; }).filter(Boolean);
    var rn = $('#rosterNames');
    if (rn) rn.innerHTML = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    $$('.patient-name-dl').forEach(function (dl) {
      dl.innerHTML = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    });
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
    $('#scheduleTherapist').value = state.therapist || '';
    form.querySelector('[name="scheduledDate"]').value = today();
    $('#patientRows').innerHTML = '';
    patientRowSeq = 0;
    addPatientRow(prefillPatient || {});
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
      // On a lookup failure, the next click must re-run the gate, not save blind.
      if (pendingPatients.some(function (pp) { return pp.gate.reason === 'lookup_failed'; })) {
        pendingPatients = null;
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
    sub.disabled = true;
    apiSaveSession(rows)
      .then(function (res) {
        var failed = (res.results || []).filter(function (r) { return !r.ok; });
        if (failed.length) toast('חלק מהרישומים נדחו: ' + failed.map(function (f) { return f.error; }).join(', '), true);
        else toast('הטיפול תוזמן');
        return loadAll();
      })
      .then(function () { closeScheduleModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); sub.disabled = false; });
  }

  // --- attendance --------------------------------------------------------
  function markAttendance(id, value) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    // Toggle off if clicking the same state again.
    var next = (row.attendance === value) ? '' : value;
    var prev = row.attendance;
    row.attendance = next;
    renderSchedule();
    apiMarkAttendance(id, next)
      .then(function () { toast(next === 'occurred' ? 'סומן כהתקיים' : next === 'missed' ? 'סומן כלא התקיים' : 'הסימון בוטל'); })
      .catch(function (err) { row.attendance = prev; renderSchedule(); toast('שגיאה: ' + err.message, true); });
  }

  // --- patient record modal ---------------------------------------------
  function openPatientModal(phone) {
    if (!ensureEditor()) return;
    var form = $('#patientForm');
    form.reset();
    syncDropdowns();
    var rec = activePatients().filter(function (p) { return normPhone(p.phone) === normPhone(phone); })[0];
    if (rec) {
      form.querySelector('[name="name"]').value = rec.name || '';
      form.querySelector('[name="phone"]').value = rec.phone || '';
      $('#patientTherapist').value = rec.assignedTherapist || '';
      $('#fromInpatient').checked = !!rec.fromInpatient;
      $('#admittedLocation').value = rec.admittedLocation || '';
      form.querySelector('[name="outpatientStartDate"]').value = rec.outpatientStartDate || '';
    }
    $('#inpatientDetails').hidden = !$('#fromInpatient').checked;
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
    var fromInp = !!fd.get('fromInpatient');
    var patient = {
      phone: pv.value, name: name,
      assignedTherapist: (fd.get('assignedTherapist') || '').trim(),
      fromInpatient: fromInp,
      admittedLocation: fromInp ? (fd.get('admittedLocation') || '').trim() : '',
      outpatientStartDate: fromInp ? (fd.get('outpatientStartDate') || '') : '',
      updatedBy: state.therapist || ''
    };
    sub.disabled = true;
    apiSavePatient(patient)
      .then(function () { toast('נשמר'); return loadAll(); })
      .then(function () { closePatientModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { sub.disabled = false; });
  }

  // --- therapist identity ------------------------------------------------
  function openTherapistModal() {
    syncDropdowns();
    $('#therapistSelect').value = state.therapist || '';
    $('#therapistModal').hidden = false;
  }
  function closeTherapistModal() { $('#therapistModal').hidden = true; }
  function ensureTherapist() {
    if (state.therapist) return true;
    toast('יש לבחור מטפל/ת', true); openTherapistModal(); return false;
  }
  function ensureEditor() {
    if (state.role === 'editor') return true;
    toast('פעולה זו זמינה לעורכים בלבד', true); return false;
  }

  // --- auth / role -------------------------------------------------------
  function applyRole() {
    document.body.classList.toggle('viewer', state.role !== 'editor');
    var badge = $('#roleBadge');
    badge.textContent = state.role === 'editor' ? 'עורך' : 'צופה';
    badge.classList.toggle('editor', state.role === 'editor');
  }
  function applyTherapist() { $('#therapistChip').textContent = state.therapist || '—'; }
  function showPin() {
    $('#pinScreen').hidden = false;
    $('#app').hidden = true;
    $('#pinInput').value = '';
    $('#pinInput').focus();
  }
  function enterApp() {
    $('#pinScreen').hidden = true;
    $('#app').hidden = false;
    applyRole();
    applyTherapist();
    setView('patients');
    if (state.role === 'editor' && !state.therapist) openTherapistModal();
  }

  function setView(view) {
    state.view = view;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
  }

  function on(sel, ev, fn) {
    var el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) { console.warn('[ezone-therapists] missing element for', sel); return; }
    el.addEventListener(ev, fn);
  }

  function wireEvents() {
    on('#pinSubmit', 'click', function () {
      var v = ($('#pinInput').value || '').trim();
      if (v === '5555') {
        try { sessionStorage.setItem('ez_role', 'editor'); } catch (_) {}
        state.role = 'editor';
        enterApp();
      } else {
        var err = $('#pinError'); if (err) err.hidden = false;
      }
    });
    on('#pinInput', 'keydown', function (e) {
      var err = $('#pinError'); if (err) err.hidden = true;
      if (e.key === 'Enter') { e.preventDefault(); $('#pinSubmit').click(); }
    });
    on('#pinViewer', 'click', function () {
      try { sessionStorage.setItem('ez_role', 'viewer'); } catch (_) {}
      state.role = 'viewer';
      enterApp();
    });
    on('#logoutBtn', 'click', function () {
      try { sessionStorage.removeItem('ez_role'); } catch (_) {}
      state.role = 'viewer';
      showPin();
    });

    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { setView(t.dataset.view); }); });
    on('#refreshBtn', 'click', function () { loadAll().then(function () { toast('רועננו'); }).catch(function () {}); });

    on('#patientsSearch', 'input', function (e) { state.patientsSearch = e.target.value; renderPatients(); });
    on('#scheduleSearch', 'input', function (e) { state.scheduleSearch = e.target.value; renderSchedule(); });
    on('#plansSearch', 'input', function (e) { state.plansSearch = e.target.value; renderPlans(); });

    on('#addScheduleBtn', 'click', function () { openScheduleModal(); });
    on('#schedulePatientBtn', 'click', function () { openScheduleModal(); });
    on('#therapistChip', 'click', function () { if (state.role === 'editor') openTherapistModal(); });

    // Delegated actions on the patients dashboard + schedule list.
    on('#patientsList', 'click', function (e) {
      var ep = e.target.closest('[data-edit-patient]');
      if (ep) { openPatientModal(ep.getAttribute('data-edit-patient')); return; }
      var sp = e.target.closest('[data-schedule-patient]');
      if (sp) {
        var rec = activePatients().filter(function (p) { return normPhone(p.phone) === normPhone(sp.getAttribute('data-schedule-patient')); })[0];
        openScheduleModal(rec ? { name: rec.name, phone: rec.phone } : null);
      }
    });
    on('#scheduleList', 'click', function (e) {
      var b = e.target.closest('[data-att]');
      if (b) { if (!ensureEditor()) return; markAttendance(b.getAttribute('data-id'), b.getAttribute('data-att')); }
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

    on('#fromInpatient', 'change', function (e) { $('#inpatientDetails').hidden = !e.target.checked; });

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeScheduleModal(); closePatientModal(); });
    });

    on('#scheduleForm', 'submit', function (e) { e.preventDefault(); handleScheduleSubmit(); });
    on('#patientForm', 'submit', function (e) { e.preventDefault(); handlePatientSubmit(); });
    on('#therapistForm', 'submit', function (e) {
      e.preventDefault();
      var v = ($('#therapistSelect').value || '').trim();
      if (!v) { toast('יש לבחור מטפל/ת', true); return; }
      state.therapist = v;
      try { sessionStorage.setItem('ez_therapist', v); } catch (_) {}
      applyTherapist();
      closeTherapistModal();
    });
  }

  function init() {
    try { wireEvents(); } catch (e) { console.error('[ezone-therapists] wireEvents failed', e); }
    try { state.therapist = sessionStorage.getItem('ez_therapist') || ''; } catch (_) {}
    var saved = null;
    try { saved = sessionStorage.getItem('ez_role'); } catch (_) {}
    if (saved === 'editor' || saved === 'viewer') { state.role = saved; enterApp(); }
    else { showPin(); }
    loadAll().catch(function () {});
  }

  function bootWhenReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  bootWhenReady();
})();
