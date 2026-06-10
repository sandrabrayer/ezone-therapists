/* E-ZONE Therapists — frontend */
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

  var HOUSE_LABELS = {
    raanana: 'רעננה אשר', ramot: 'רמות השבים', efroni: 'קיסריה עפרוני',
    rehab: 'קיסריה ריהאב', external: 'חיצוני'
  };
  function houseLabel(v) {
    var s = String(v == null ? '' : v).trim();
    return HOUSE_LABELS[s] || s || '';
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
    view: 'outpatient',
    treatments: [],
    approvals: [],
    debtRoster: [],
    debtRosterOk: false,
    plans: [],
    plansOk: false,
    admitted: [],
    admittedOk: false,
    outpatientSearch: '',
    inpatientSearch: '',
    plansSearch: '',
    loaded: false
  };

  // Gate decision pending in the outpatient modal (null until first check).
  var pendingGate = null;

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
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function () { t.hidden = true; }, 2800);
  }

  // --- API ---------------------------------------------------------------
  async function apiLoad() {
    var r = await fetch('/api/sheets', { cache: 'no-store' });
    var data = await r.json();
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiSaveTreatment(treatment) {
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveTreatment', treatment: treatment })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  // Live read — never cached. Returns { ok, clients } or throws.
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
  async function apiAdmitted() {
    var r = await fetch('/api/admitted', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  function normalizeTreatmentFromSheet(row) {
    return {
      id: row.id || uid(),
      kind: row.kind || 'outpatient',
      therapist: row.therapist || '',
      patientName: row.patientName || '',
      patientPhone: row.patientPhone || '',
      serviceType: row.serviceType || '',
      treatmentDate: fmtDate(row.treatmentDate),
      note: row.note || '',
      gateStatus: row.gateStatus || '',
      gateReason: row.gateReason || '',
      amountOwed: Number(row.amountOwed) || 0,
      house: row.house || '',
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
      state.treatments = (data.treatments || []).map(normalizeTreatmentFromSheet);
      state.approvals = data.approvals || [];
      state.loaded = true;
    } catch (e) {
      toast('שגיאה בטעינת הנתונים: ' + e.message, true);
      throw e;
    }
    // Cross-app reads are best-effort and independent; never block the app.
    await Promise.all([loadDebtRoster(), loadPlans(), loadAdmitted()]);
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
  async function loadAdmitted() {
    try {
      var d = await apiAdmitted();
      state.admitted = Array.isArray(d.patients) ? d.patients : (Array.isArray(d.clients) ? d.clients : []);
      state.admittedOk = true;
    } catch (e) {
      console.warn('[ezone-therapists] admitted roster unavailable:', e.message);
      state.admitted = []; state.admittedOk = false;
    }
  }

  // Always re-check debt live just before saving an outpatient log.
  async function refreshDebtRoster() {
    await loadDebtRoster();
    return { roster: state.debtRoster, rosterOk: state.debtRosterOk };
  }

  // --- render ------------------------------------------------------------
  function render() {
    renderOutpatient();
    renderInpatient();
    renderPlans();
    syncDatalists();
  }

  function matchSearch(t, q) {
    if (!q) return true;
    return String(t.patientName || '').toLowerCase().indexOf(q.toLowerCase()) !== -1;
  }

  function gateChip(t) {
    if (t.gateStatus === 'clear') return '<span class="chip chip-paid">ללא חוב</span>';
    if (t.gateStatus === 'approved') return '<span class="chip chip-partial">אושר למרות חוב (' + money(t.amountOwed) + ')</span>';
    if (t.gateStatus === 'flagged') return '<span class="chip chip-unpaid">לבירור</span>';
    return '';
  }

  function treatmentRow(t, opts) {
    opts = opts || {};
    var parts = [];
    parts.push('<div class="p-name">' + escapeHtml(t.patientName) + '</div>');
    parts.push('<div><span class="p-label">טלפון</span><span class="p-val">' + escapeHtml(t.patientPhone) + '</span></div>');
    parts.push('<div><span class="p-label">טיפול</span><span class="p-val">' + escapeHtml(t.serviceType) + '</span></div>');
    parts.push('<div><span class="p-label">תאריך</span><span class="p-val">' + escapeHtml(displayDate(t.treatmentDate)) + '</span></div>');
    parts.push('<div><span class="p-label">מטפל/ת</span><span class="p-val">' + escapeHtml(t.therapist) + '</span></div>');
    if (opts.house) parts.push('<div><span class="p-label">בית</span><span class="p-val">' + escapeHtml(houseLabel(t.house)) + '</span></div>');
    if (opts.gate) parts.push('<div>' + gateChip(t) + '</div>');
    return '<div class="billing-row">' + parts.join('') + '</div>';
  }

  function renderOutpatient() {
    var list = state.treatments.filter(function (t) { return t.kind === 'outpatient'; });
    var flagged = list.filter(function (t) { return t.gateStatus === 'flagged'; }).length;
    var approved = list.filter(function (t) { return t.gateStatus === 'approved'; }).length;
    $('#kpiOutCount').textContent = list.length;
    $('#kpiOutFlagged').textContent = flagged;
    $('#kpiOutApproved').textContent = approved;

    var rows = list
      .filter(function (t) { return matchSearch(t, state.outpatientSearch); })
      .sort(function (a, b) { return (b.treatmentDate || '').localeCompare(a.treatmentDate || ''); })
      .map(function (t) { return treatmentRow(t, { gate: true }); });
    $('#outpatientList').innerHTML = rows.length
      ? rows.join('')
      : '<div class="billing-empty">אין רישומים</div>';
  }

  function renderInpatient() {
    var list = state.treatments.filter(function (t) { return t.kind === 'inpatient'; });
    $('#kpiInCount').textContent = list.length;
    $('#kpiInRoster').textContent = state.admittedOk ? state.admitted.length : '—';

    var rows = list
      .filter(function (t) { return matchSearch(t, state.inpatientSearch); })
      .sort(function (a, b) { return (b.treatmentDate || '').localeCompare(a.treatmentDate || ''); })
      .map(function (t) { return treatmentRow(t, { house: true }); });
    $('#inpatientList').innerHTML = rows.length
      ? rows.join('')
      : '<div class="billing-empty">אין רישומים</div>';
  }

  function planSessionsText(p) {
    var s = p.sessions || p.sessionsPerWeek;
    if (s == null || s === '') return '';
    if (typeof s === 'object') {
      try {
        return Object.keys(s).map(function (k) { return k + ': ' + s[k]; }).join(', ');
      } catch (_) { return ''; }
    }
    return String(s);
  }

  function renderPlans() {
    var notice = $('#plansNotice');
    if (!state.plansOk) {
      notice.hidden = false;
      notice.textContent = 'תוכניות הטיפול אינן זמינות כרגע (תלוי בפריסת נקודת הקצה getTreatmentPlans בצד מטופלי החוץ).';
    } else {
      notice.hidden = true;
    }
    var q = state.plansSearch;
    var cards = (state.plans || [])
      .filter(function (p) { return !q || String(p.name || '').toLowerCase().indexOf(q.toLowerCase()) !== -1; })
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

  function syncDatalists() {
    var outNames = (state.debtRoster || []).map(function (c) { return c.name; }).filter(Boolean);
    $('#outpatientNames').innerHTML = outNames.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    var inNames = (state.admitted || []).map(function (p) { return p.name; }).filter(Boolean);
    $('#inpatientNames').innerHTML = inNames.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
  }

  // --- outpatient gate flow ---------------------------------------------
  function resetGateUi() {
    pendingGate = null;
    var banner = $('#gateBanner');
    banner.hidden = true; banner.className = 'wide'; banner.innerHTML = '';
    $('#approvalSection').hidden = true;
    var sub = $('#outpatientSubmit');
    sub.textContent = 'בדוק ושמור';
  }

  function showGateBanner(kind, html) {
    var banner = $('#gateBanner');
    banner.hidden = false;
    banner.innerHTML = html;
    // Reuse the renewals banner styles for a colored, prominent box.
    banner.className = 'wide card-banner ' + (kind === 'block' ? 'card-banner-stop' : 'card-banner-warn');
    banner.style.margin = '6px 0';
  }

  // Build the treatment object for an outpatient log given the gate result.
  function buildOutpatientTreatment(fields, gate, approvalStamp) {
    var t = {
      id: uid(),
      kind: 'outpatient',
      therapist: state.therapist,
      patientName: fields.patientName,
      patientPhone: fields.patientPhone,
      serviceType: fields.serviceType,
      treatmentDate: fields.treatmentDate,
      note: fields.note,
      gateStatus: '',
      gateReason: gate ? gate.reason : '',
      amountOwed: gate ? (gate.amountOwed || 0) : 0,
      house: '',
      approverId: '', approverName: '', approvalNote: '', approvedAt: '',
      created: today()
    };
    if (gate && gate.decision === 'allow') t.gateStatus = 'clear';
    else if (gate && gate.decision === 'flag') t.gateStatus = 'flagged';
    else if (approvalStamp) {
      t.gateStatus = 'approved';
      t.approverId = approvalStamp.approverId;
      t.approverName = approvalStamp.approverName;
      t.approvalNote = approvalStamp.note;
      t.approvedAt = approvalStamp.approvedAt;
      t.amountOwed = approvalStamp.amountOwed;
    }
    return t;
  }

  function persistTreatment(t, okMsg) {
    var sub = $('#outpatientSubmit');
    state.treatments.push(t);
    render();
    apiSaveTreatment(t)
      .then(function () { toast(okMsg); closeOutpatientModal(); })
      .catch(function (err) {
        state.treatments = state.treatments.filter(function (x) { return x.id !== t.id; });
        render();
        toast('שגיאה: ' + err.message, true);
        sub.disabled = false;
      });
  }

  function readOutpatientFields() {
    var form = $('#outpatientForm');
    var fd = new FormData(form);
    return {
      patientName: (fd.get('patientName') || '').trim(),
      patientPhone: (fd.get('patientPhone') || '').trim(),
      serviceType: (fd.get('serviceType') || '').trim(),
      treatmentDate: fd.get('treatmentDate') || '',
      note: (fd.get('note') || '').trim(),
      approver: (fd.get('approver') || '').trim(),
      approvalNote: (fd.get('approvalNote') || '').trim()
    };
  }

  async function handleOutpatientSubmit() {
    var sub = $('#outpatientSubmit');
    if (sub.disabled) return;
    var f = readOutpatientFields();

    // Phase 2 — the gate already ran and is waiting for the user's decision.
    if (pendingGate) {
      if (pendingGate.decision === 'block') {
        var stamp = Approval.buildApproval({
          approver: f.approver,
          patientName: f.patientName,
          patientPhone: f.patientPhone,
          therapist: state.therapist,
          note: f.approvalNote,
          amountOwed: pendingGate.amountOwed
        });
        if (!stamp.ok) { toast(stamp.error, true); return; }
        sub.disabled = true;
        persistTreatment(buildOutpatientTreatment(f, pendingGate, stamp.approval), 'נשמר עם אישור');
        return;
      }
      if (pendingGate.decision === 'flag') {
        sub.disabled = true;
        persistTreatment(buildOutpatientTreatment(f, pendingGate, null), 'נשמר לבירור');
        return;
      }
    }

    // Phase 1 — validate, then run the live debt gate.
    if (!f.patientName) { toast('חסר שם מטופל', true); return; }
    var pv = Phone.validateCanonical(f.patientPhone);
    if (!pv.ok) { toast(pv.error, true); return; }
    if (!f.serviceType) { toast('יש לבחור סוג טיפול', true); return; }
    if (!f.treatmentDate) { toast('יש לבחור תאריך', true); return; }
    if (!state.therapist) { toast('חסר שם מטפל/ת', true); openTherapistModal(); return; }

    sub.disabled = true;
    sub.textContent = 'בודק חוב…';
    var roster;
    try { roster = await refreshDebtRoster(); }
    catch (e) { roster = { roster: [], rosterOk: false }; }

    var gate = DebtGate.evaluate({ phone: pv.value, roster: roster.roster, rosterOk: roster.rosterOk });
    sub.disabled = false;

    if (gate.decision === 'allow') {
      sub.disabled = true;
      persistTreatment(buildOutpatientTreatment(f, gate, null), 'נשמר — ללא חוב');
      return;
    }
    if (gate.decision === 'block') {
      pendingGate = gate;
      showGateBanner('block', '⛔ חוב פתוח של ' + money(gate.amountOwed) +
        '. אסור להמשיך טיפול ללא אישור של רון או סנדרה.');
      $('#approvalSection').hidden = false;
      sub.textContent = 'אשר ושמור';
      return;
    }
    // flag
    pendingGate = gate;
    showGateBanner('flag', '⚠️ ' + (FLAG_TEXT[gate.reason] || 'דרוש בירור ידני.') +
      '<br>ניתן לשמור לבירור — הרישום לא ייחשב כמאומת.');
    $('#approvalSection').hidden = true;
    sub.textContent = (gate.reason === 'lookup_failed') ? 'נסה שוב' : 'שמור לבירור';
    // On lookup failure, the next click should re-run the gate, not save blind.
    if (gate.reason === 'lookup_failed') pendingGate = null;
  }

  // --- inpatient flow ----------------------------------------------------
  function handleInpatientSubmit() {
    var sub = $('#inpatientSubmit');
    if (sub.disabled) return;
    var fd = new FormData($('#inpatientForm'));
    var patientName = (fd.get('patientName') || '').trim();
    var patientPhone = (fd.get('patientPhone') || '').trim();
    var serviceType = (fd.get('serviceType') || '').trim();
    var treatmentDate = fd.get('treatmentDate') || '';
    if (!patientName) { toast('חסר שם מטופל', true); return; }
    var pv = Phone.validateCanonical(patientPhone);
    if (!pv.ok) { toast(pv.error, true); return; }
    if (!serviceType) { toast('יש לבחור סוג טיפול', true); return; }
    if (!treatmentDate) { toast('יש לבחור תאריך', true); return; }
    if (!state.therapist) { toast('חסר שם מטפל/ת', true); openTherapistModal(); return; }

    var t = {
      id: uid(), kind: 'inpatient', therapist: state.therapist,
      patientName: patientName, patientPhone: pv.value, serviceType: serviceType,
      treatmentDate: treatmentDate, note: (fd.get('note') || '').trim(),
      gateStatus: '', gateReason: '', amountOwed: 0,
      house: (fd.get('house') || '').trim(),
      approverId: '', approverName: '', approvalNote: '', approvedAt: '',
      created: today()
    };
    sub.disabled = true;
    state.treatments.push(t);
    render();
    apiSaveTreatment(t)
      .then(function () { toast('נשמר'); closeInpatientModal(); })
      .catch(function (err) {
        state.treatments = state.treatments.filter(function (x) { return x.id !== t.id; });
        render();
        toast('שגיאה: ' + err.message, true);
      })
      .finally(function () { sub.disabled = false; });
  }

  // --- modals ------------------------------------------------------------
  function openOutpatientModal() {
    if (!state.therapist) { openTherapistModal(); return; }
    var form = $('#outpatientForm');
    form.reset();
    form.querySelector('[name="treatmentDate"]').value = today();
    resetGateUi();
    $('#outpatientModal').hidden = false;
  }
  function closeOutpatientModal() { $('#outpatientModal').hidden = true; resetGateUi(); }

  function openInpatientModal() {
    if (!state.therapist) { openTherapistModal(); return; }
    var form = $('#inpatientForm');
    form.reset();
    form.querySelector('[name="treatmentDate"]').value = today();
    $('#inpatientModal').hidden = false;
  }
  function closeInpatientModal() { $('#inpatientModal').hidden = true; }

  function openTherapistModal() { $('#therapistModal').hidden = false; var i = $('#therapistForm [name="therapist"]'); i.value = state.therapist || ''; i.focus(); }
  function closeTherapistModal() { $('#therapistModal').hidden = true; }

  // --- auth / role -------------------------------------------------------
  function applyRole() {
    document.body.classList.toggle('viewer', state.role !== 'editor');
    var badge = $('#roleBadge');
    badge.textContent = state.role === 'editor' ? 'עורך' : 'צופה';
    badge.classList.toggle('editor', state.role === 'editor');
  }
  function applyTherapist() {
    var chip = $('#therapistChip');
    chip.textContent = state.therapist || '—';
  }
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
    setView('outpatient');
    // Editors must identify themselves before logging.
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

    on('#outpatientSearch', 'input', function (e) { state.outpatientSearch = e.target.value; renderOutpatient(); });
    on('#inpatientSearch', 'input', function (e) { state.inpatientSearch = e.target.value; renderInpatient(); });
    on('#plansSearch', 'input', function (e) { state.plansSearch = e.target.value; renderPlans(); });

    on('#addOutpatientBtn', 'click', openOutpatientModal);
    on('#addInpatientBtn', 'click', openInpatientModal);
    on('#therapistChip', 'click', function () { if (state.role === 'editor') openTherapistModal(); });

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeOutpatientModal(); closeInpatientModal(); });
    });

    // Editing the patient identity invalidates a pending gate result.
    ['patientName', 'patientPhone'].forEach(function (name) {
      var el = $('#outpatientForm [name="' + name + '"]');
      if (el) el.addEventListener('input', function () { if (pendingGate || $('#gateBanner').hidden === false) resetGateUi(); });
    });

    on('#outpatientForm', 'submit', function (e) { e.preventDefault(); handleOutpatientSubmit(); });
    on('#inpatientForm', 'submit', function (e) { e.preventDefault(); handleInpatientSubmit(); });

    on('#therapistForm', 'submit', function (e) {
      e.preventDefault();
      var v = ($('#therapistForm [name="therapist"]').value || '').trim();
      if (!v) { toast('יש להזין שם', true); return; }
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
