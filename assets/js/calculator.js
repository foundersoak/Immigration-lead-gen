/* ============================================================
   GreenCardETA - calculators (green card wait + H-1B odds),
   email gate, lead capture, tabs.
   Shared state + loaders are declared ABOVE all callers so a
   load-order/hoisting bug can't kill the whole script.
   ============================================================ */
(function () {
  'use strict';

  var BASE = (document.querySelector('meta[name="vc-base"]') || {}).content || '';

  /* ---------- shared state (declared first) ---------- */
  var _bulletin = null;
  var _bulletinCbs = [];

  function loadBulletin(cb) {
    if (_bulletin) { cb(_bulletin); return; }
    _bulletinCbs.push(cb);
    if (_bulletinCbs.length > 1) return;
    fetch(BASE + 'assets/data/bulletin-index.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { _bulletin = d; flush(d); })
      .catch(function () { _bulletin = { finalActionDates: {}, countryLabels: {} }; flush(_bulletin); });
    function flush(d) { _bulletinCbs.forEach(function (f) { f(d); }); _bulletinCbs = []; }
  }

  /* ---------- unlock state (one-time per browser) ---------- */
  function isUnlocked() { try { return localStorage.getItem('vc_unlocked') === '1'; } catch (e) { return false; } }
  function setUnlocked() { try { localStorage.setItem('vc_unlocked', '1'); } catch (e) {} }

  /* ---------- date utils ---------- */
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function parseISO(d) { var p = String(d).split('-'); return new Date(Date.UTC(+p[0], (+p[1] || 1) - 1, +p[2] || 1)); }
  function ymToDate(ym) { var p = String(ym).split('-'); return new Date(Date.UTC(+p[0], (+p[1] || 1) - 1, 1)); }
  function fmtISO(d) { if (d === 'C') return 'Current'; if (d === 'U') return 'Unavailable'; var dt = parseISO(d); return MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate() + ', ' + dt.getUTCFullYear(); }
  function fmtMonthYear(date) { return MONTHS[date.getUTCMonth()] + ' ' + date.getUTCFullYear(); }
  function fmtBulletinMonth(ym) { var p = String(ym).split('-'); return MONTHS[(+p[1]) - 1] + ' ' + p[0]; }
  function addMonths(months) { var n = new Date(); var d = new Date(Date.UTC(n.getFullYear(), n.getMonth() + Math.round(months), 1)); return d; }
  function durationText(months) {
    if (months <= 0) return 'now';
    if (months > 600) return '50+ years';
    var y = Math.floor(months / 12), m = Math.round(months % 12);
    var parts = [];
    if (y) parts.push(y + ' year' + (y > 1 ? 's' : ''));
    if (m) parts.push(m + ' month' + (m > 1 ? 's' : ''));
    return parts.join(' ') || 'under a month';
  }

  /* ---------- AJAX email submit (falls back when endpoint is a placeholder) ---------- */
  function submitEmail(form, cb) {
    var action = form.getAttribute('action') || '';
    // Validate ALL required fields (name, email, country, consent, ...) natively,
    // since we preventDefault before the browser would otherwise check them.
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) { if (form.reportValidity) form.reportValidity(); return; }
    if (/your-form-id|XXXX/.test(action) || !action) { cb(); return; }
    var btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Sending…'; }
    fetch(action, { method: 'POST', headers: { 'Accept': 'application/json' }, body: new FormData(form) })
      .then(function () { cb(); }).catch(function () { cb(); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Submit'; } });
  }

  /* ============================================================
     GREEN CARD WAIT TOOL
     ============================================================ */
  function computeWait(data, category, country, pdYM) {
    var s = ((data.finalActionDates[category] || {})[country] || []).slice();
    if (!s.length) return { error: 'We do not have data for that selection yet.' };
    var latest = s[s.length - 1];
    var prev = s.length > 1 ? s[s.length - 2] : null;
    var res = {
      category: category, country: country, countryLabel: (data.countryLabels[country] || country),
      bulletinMonth: latest.bulletin, cutoff: latest.date, cutoffLabel: fmtISO(latest.date)
    };
    // recent movement (last step)
    if (prev && latest.date !== 'C' && latest.date !== 'U' && prev.date !== 'C' && prev.date !== 'U') {
      res.lastDeltaDays = Math.round((parseISO(latest.date) - parseISO(prev.date)) / 86400000);
    }
    // net pace over the window
    var real = s.filter(function (e) { return e.date !== 'C' && e.date !== 'U'; });
    if (real.length >= 2) {
      var spanMonths = monthsApart(real[0].bulletin, real[real.length - 1].bulletin);
      if (spanMonths > 0) res.paceDays = (parseISO(real[real.length - 1].date) - parseISO(real[0].date)) / 86400000 / spanMonths;
    }
    if (latest.date === 'C') { res.status = 'current'; return res; }
    if (latest.date === 'U') { res.status = 'unavailable'; return res; }
    var cutoffDate = parseISO(latest.date);
    var pdDate = ymToDate(pdYM);
    res.gapDays = (pdDate - cutoffDate) / 86400000;
    if (res.gapDays <= 0) { res.status = 'available'; return res; }       // your date is already past the cutoff
    if (res.paceDays == null || res.paceDays <= 0) { res.status = 'stuck'; return res; }
    var likely = res.gapDays / res.paceDays;
    var fast = res.gapDays / (res.paceDays * 1.6);
    var slow = res.gapDays / (res.paceDays * 0.5);
    res.status = 'projected';
    res.likelyMonths = likely; res.fastMonths = fast; res.slowMonths = slow;
    res.likelyDate = addMonths(likely); res.fastDate = addMonths(fast); res.slowDate = addMonths(slow);
    return res;
  }
  function monthsApart(a, b) { var x = a.split('-').map(Number), y = b.split('-').map(Number); return (y[0] - x[0]) * 12 + (y[1] - x[1]); }

  // Secondary context (the raw cutoff + last-month movement), shown smaller below the headline answer.
  function waitContextHTML(res) {
    var html = '<div class="gc-context"><div class="gc-ctx-row"><span>Current ' + res.category.replace('EB', 'EB-') + ' ' + res.countryLabel + ' cutoff (' + fmtBulletinMonth(res.bulletinMonth) + ')</span><strong>' + res.cutoffLabel + '</strong></div>';
    if (res.lastDeltaDays != null) {
      var dir = res.lastDeltaDays > 5 ? ('advanced ~' + Math.abs(Math.round(res.lastDeltaDays / 30)) + ' mo last month')
        : (res.lastDeltaDays < -5 ? ('⚠️ retrogressed ~' + Math.abs(Math.round(res.lastDeltaDays / 30)) + ' mo last month') : 'held steady last month');
      html += '<div class="gc-ctx-note">' + dir + '</div>';
    }
    return html + '</div>';
  }

  function waitRevealHTML(res) {
    if (res.status === 'available' || res.status === 'current') {
      return '<div class="gc-result good"><span class="gc-eyebrow">Your status</span>' +
        '<p class="gc-big">✓ Likely available now</p>' +
        '<p class="gc-sub">Based on the ' + fmtBulletinMonth(res.bulletinMonth) + ' Visa Bulletin, your priority date appears to be current. Confirm with an attorney before filing.</p>' +
        waitContextHTML(res) +
        '<a class="btn btn-primary" href="' + BASE + 'index.html#leadcta">Talk to an attorney about filing</a></div>';
    }
    if (res.status === 'stuck') {
      return '<div class="gc-result warn"><span class="gc-eyebrow">Your wait</span>' +
        '<p class="gc-big">Highly uncertain</p>' +
        '<p class="gc-sub">The ' + res.category.replace('EB', 'EB-') + ' ' + res.countryLabel + ' cutoff has shown little or no net forward movement recently (and sometimes moves backward), so we will not invent a date.</p>' +
        waitContextHTML(res) +
        '<a class="btn btn-primary" href="' + BASE + 'index.html#leadcta">Talk to an attorney</a></div>';
    }
    var retro = res.lastDeltaDays != null && res.lastDeltaDays < 0;
    return '<div class="gc-result">' +
      '<span class="gc-eyebrow">Your estimated wait</span>' +
      '<p class="gc-big">~' + durationText(res.likelyMonths) + '</p>' +
      '<p class="gc-sub">Likely current around <strong>' + fmtMonthYear(res.likelyDate) + '</strong>. Your priority date is about <strong>' + durationText(res.gapDays / 30.4) + '</strong> ahead of the current cutoff.</p>' +
      '<div class="gc-scenarios">' +
        '<div class="gc-scn"><span>Best case</span><strong>' + fmtMonthYear(res.fastDate) + '</strong><em>~' + durationText(res.fastMonths) + '</em></div>' +
        '<div class="gc-scn likely"><span>Likely</span><strong>' + fmtMonthYear(res.likelyDate) + '</strong><em>~' + durationText(res.likelyMonths) + '</em></div>' +
        '<div class="gc-scn"><span>Worst case</span><strong>' + fmtMonthYear(res.slowDate) + '</strong><em>~' + durationText(res.slowMonths) + '</em></div>' +
      '</div>' +
      '<p class="gc-basis">Based on the ' + fmtBulletinMonth(res.bulletinMonth) + ' Visa Bulletin and an average movement of about ' + Math.round(res.paceDays) + ' day(s) per month. ' +
      (retro ? '<strong>⚠️ This cutoff just retrogressed</strong> — projections can change sharply month to month. ' : '') +
      'An estimate, not a guarantee.</p>' +
      waitContextHTML(res) +
      '<a class="btn btn-primary" href="' + BASE + 'guides/eb2-vs-eb3-downgrade/index.html">What can move my date faster?</a>' +
      '</div>';
  }

  function renderWaitFull(el, res) { el.innerHTML = waitRevealHTML(res); }

  function fillWaitLead(tool, res) {
    function set(sel, v) { var el = tool.querySelector(sel); if (el) el.value = (v == null ? '' : v); }
    var est = res.status === 'projected' ? ('~' + fmtMonthYear(res.likelyDate) + ' (' + durationText(res.likelyMonths) + ')')
      : (res.status === 'available' || res.status === 'current' ? 'Likely current now' : (res.status === 'stuck' ? 'No reliable estimate (stalled/retrogressing)' : res.status));
    set('.gc-f-category', res.category);
    set('.gc-f-country', res.countryLabel);
    set('.gc-f-estimate', est);
    set('.gc-f-subject', 'GreenCardETA lead: ' + res.category.replace('EB', 'EB-') + ' ' + res.countryLabel + ' — ' + est);
    set('.gc-f-page', location.pathname);
  }

  function fillPdSelects(tool) {
    var m = tool.querySelector('.gc-in-pd-month'), y = tool.querySelector('.gc-in-pd-year');
    if (m && m.options.length <= 1) {
      var names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      for (var i = 0; i < 12; i++) { var o = document.createElement('option'); o.value = (i < 9 ? '0' : '') + (i + 1); o.textContent = names[i]; m.appendChild(o); }
    }
    if (y && y.options.length <= 1) {
      var now = new Date().getFullYear();
      for (var yr = now; yr >= 2000; yr--) { var oy = document.createElement('option'); oy.value = String(yr); oy.textContent = String(yr); y.appendChild(oy); }
    }
  }

  function wireWaitTool(tool) {
    var form = tool.querySelector('.gc-form');
    var pdMonth = tool.querySelector('.gc-in-pd-month');
    var pdYear = tool.querySelector('.gc-in-pd-year');
    var catSel = tool.querySelector('.gc-in-category');
    var countrySel = tool.querySelector('.gc-in-country');
    var out = tool.querySelector('.gc-out');
    var gate = tool.querySelector('.gc-gate');
    var reveal = tool.querySelector('.gc-reveal');
    var locked = tool.dataset.locked === 'true';
    var pending = null;
    fillPdSelects(tool);

    function category() { return locked ? tool.dataset.category : (catSel ? catSel.value : tool.dataset.category); }
    function country() { return locked ? tool.dataset.country : (countrySel ? countrySel.value : tool.dataset.country); }
    function pdValue() { return (pdMonth && pdYear && pdMonth.value && pdYear.value) ? (pdYear.value + '-' + pdMonth.value) : ''; }
    function revealResult() { reveal.hidden = false; gate.hidden = true; renderWaitFull(reveal, pending); }

    function show(res) {
      pending = res;
      out.hidden = false;
      if (res.error) { gate.hidden = true; reveal.hidden = false; reveal.innerHTML = '<p class="gc-status warn">' + res.error + '</p>'; return; }
      var pdEl = tool.querySelector('.gc-f-pd'); if (pdEl) pdEl.value = pdValue();
      fillWaitLead(tool, res);
      if (isUnlocked()) { revealResult(); }
      else { reveal.hidden = true; gate.hidden = false; }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pd = pdValue();
      if (!pd) { if (pdYear && pdYear.reportValidity) pdYear.reportValidity(); else if (pdMonth && pdMonth.reportValidity) pdMonth.reportValidity(); return; }
      loadBulletin(function (data) {
        show(computeWait(data, category(), country(), pd));
        if (out.scrollIntoView) out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    if (gate) gate.addEventListener('submit', function (e) {
      e.preventDefault();
      submitEmail(gate, function () { setUnlocked(); if (pending) revealResult(); });
    });
  }

  /* ============================================================
     H-1B ODDS TOOL (ungated public estimate + lead CTA)
     ============================================================ */
  // Modeled FY2027 wage-weighted selection rates (estimates; USCIS had not published actuals).
  var WAGE_BASE = { '1': 0.15, '2': 0.30, '3': 0.45, '4': 0.60 };
  function computeOdds(wageLevel, advancedDegree) {
    var base = WAGE_BASE[String(wageLevel)] != null ? WAGE_BASE[String(wageLevel)] : 0.30;
    // advanced US degree = a second draw (master's cap). Illustrative second-chance bump.
    var p = advancedDegree ? base + (1 - base) * 0.25 : base;
    return { base: base, p: Math.min(p, 0.95), wageLevel: wageLevel, advancedDegree: advancedDegree };
  }
  var ROMAN = ['I', 'II', 'III', 'IV'];
  function oddsResultHTML(r) {
    var pct = Math.round(r.p * 100);
    return '<div class="h1b-result"><span class="gc-eyebrow">Estimated FY2027 selection chance</span>' +
      '<p class="gc-big">~' + pct + '%</p>' +
      '<p class="gc-sub">Wage Level ' + ROMAN[(+r.wageLevel) - 1] + (r.advancedDegree ? ' · advanced U.S. degree (second draw)' : '') + '</p>' +
      '<p class="gc-basis">Modeled estimate based on the wage-weighted selection rule (Level IV is weighted highest). Actual odds depend on the full applicant pool and are not published in advance.</p>' +
      '<div class="h1b-plan"><strong>Not selected, or want a backup plan?</strong> Common alternatives include O-1, L-1, TN, cap-exempt H-1B, and (for the green card) EB-1A / EB-2 NIW self-petitions.</div>' +
      '<a class="btn btn-primary" href="' + BASE + 'index.html#leadcta">Talk to an attorney about your options</a></div>';
  }
  function wireOddsTool(tool) {
    var form = tool.querySelector('.h1b-form');
    var out = tool.querySelector('.h1b-out');
    var gate = tool.querySelector('.gc-gate');
    var reveal = tool.querySelector('.h1b-reveal');
    if (!form) return;
    var pending = null;

    function fillOddsLead(r) {
      function set(sel, v) { var el = tool.querySelector(sel); if (el) el.value = v; }
      var pct = Math.round(r.p * 100), lvl = ROMAN[(+r.wageLevel) - 1];
      set('.h1b-f-wage', 'Level ' + lvl);
      set('.h1b-f-degree', r.advancedDegree ? 'Yes' : 'No');
      set('.h1b-f-estimate', '~' + pct + '% (FY2027)');
      set('.h1b-f-subject', 'GreenCardETA lead: H-1B odds ~' + pct + '% (Level ' + lvl + ')');
      set('.gc-f-page', location.pathname);
    }
    function revealResult() { reveal.hidden = false; if (gate) gate.hidden = true; reveal.innerHTML = oddsResultHTML(pending); }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var wage = (tool.querySelector('.h1b-in-wage') || {}).value || '2';
      var adv = (tool.querySelector('.h1b-in-degree') || {}).checked;
      pending = computeOdds(wage, adv);
      fillOddsLead(pending);
      out.hidden = false;
      if (isUnlocked()) { revealResult(); }
      else { reveal.hidden = true; if (gate) gate.hidden = false; }
      if (out.scrollIntoView) out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    if (gate) gate.addEventListener('submit', function (e) {
      e.preventDefault();
      submitEmail(gate, function () { setUnlocked(); if (pending) revealResult(); });
    });
  }

  /* ============================================================
     Standalone lead forms (consultation requests)
     ============================================================ */
  function wireLeadForm(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitEmail(form, function () {
        var note = document.createElement('p');
        note.className = 'email-success';
        note.textContent = "✅ Thanks — we'll be in touch by email.";
        form.parentNode.replaceChild(note, form);
      });
    });
  }

  /* ---------- tabs (homepage) ---------- */
  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.calc-tab'), function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.calc-panel'), function (p) { p.hidden = p.dataset.panel !== name; });
  }

  /* ---------- init ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.gc-tool[data-tool="wait"]'), wireWaitTool);
  Array.prototype.forEach.call(document.querySelectorAll('.gc-tool[data-tool="odds"]'), wireOddsTool);
  Array.prototype.forEach.call(document.querySelectorAll('.lead-standalone'), wireLeadForm);
  Array.prototype.forEach.call(document.querySelectorAll('.calc-tab'), function (tab) {
    tab.addEventListener('click', function () { showTab(tab.dataset.tab); });
  });
  if (document.querySelector('.gc-tool')) loadBulletin(function () {});

  /* ---------- AdSense ---------- */
  try {
    var ads = document.querySelectorAll('.adsbygoogle');
    for (var i = 0; i < ads.length; i++) { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
  } catch (e) {}

  /* ---------- Consent: Google certified CMP (configured in AdSense) handles EEA/UK/CH.
     We do not render a second homemade banner to avoid a duplicate prompt. ---------- */

  /* Test hook: export pure compute fns when loaded under Node (no-op in browser). */
  if (typeof module !== 'undefined' && module.exports) { module.exports = { computeWait: computeWait, computeOdds: computeOdds }; }
})();
