// Lakeshore County Family Services (fictional demo site for Gator Hack V). Plain JavaScript, no network.
// Query flags: ?timeout=0 hides the session warning, ?survey=0 hides the survey popup,
// ?minutes=N starts the countdown at N minutes (default 5).
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------------------------------------------------------- session-timeout warning */
  var backdrop = $('[data-timeout]');
  var dialog = backdrop ? $('[role="alertdialog"]', backdrop) : null;
  var countdown = $('[data-countdown]');
  var timer = 0;
  var lastFocus = null;

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function focusables(root) {
    return $all('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])', root)
      .filter(function (el) { return el.offsetParent !== null; });
  }
  function closeWarning() {
    clearInterval(timer);
    backdrop.hidden = true;
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) lastFocus.focus();
  }
  function signedOut(reason) {
    clearInterval(timer);
    $('[data-timeout-title]').textContent = reason === 'expired' ? 'Your session ended' : "You're signed out";
    $('[data-timeout-desc]').textContent = 'Your answers up to the last save are kept. This is a demo, so signing back in just reloads the page.';
    var actions = $('[data-timeout-actions]');
    actions.innerHTML = '';
    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn btn-primary';
    again.textContent = 'Sign back in';
    again.addEventListener('click', function () { location.reload(); });
    actions.appendChild(again);
    again.focus();
  }

  if (backdrop) {
    if (params.get('timeout') === '0') {
      backdrop.hidden = true;
    } else {
      var minutes = Math.max(1, Math.min(30, Number(params.get('minutes')) || 5));
      var left = minutes * 60 - 1;
      countdown.textContent = fmt(left);
      timer = setInterval(function () {
        left -= 1;
        if (left <= 0) { countdown.textContent = '0:00'; signedOut('expired'); return; }
        countdown.textContent = fmt(left);
      }, 1000);
      lastFocus = document.activeElement;
      var stay = $('[data-stay]');
      stay.addEventListener('click', closeWarning);
      $('[data-signout]').addEventListener('click', function () { signedOut('manual'); });
      // Keep Tab inside the dialog while it is open (wraps at the ends only).
      dialog.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var f = focusables(dialog);
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      stay.focus();
    }
  }

  /* ---------------------------------------------------------------- survey popup */
  var survey = $('[data-survey]');
  if (survey) {
    if (params.get('survey') === '0') survey.hidden = true;
    $all('[data-survey-close]', survey).forEach(function (b) {
      b.addEventListener('click', function () { survey.hidden = true; });
    });
  }

  /* ---------------------------------------------------------------- form validation */
  var form = $('[data-app-form]');
  if (form) {
    var summary = $('[data-errors]');
    var list = $('[data-error-list]');
    var NAMES = {
      first: 'Enter your first name', last: 'Enter your last name', 'dob-month': 'Select the month you were born',
      'dob-day': 'Enter the day you were born', 'dob-year': 'Enter the year you were born', phone: 'Enter a phone number',
      street: 'Enter your street address', city: 'Enter your city', zip: 'Enter a 5-digit ZIP code',
      household: 'Select how many people live with you', loss: 'Answer the food-loss question',
      certify: 'Confirm that the information is true',
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var problems = [];
      $all('[required]', form).forEach(function (el) {
        var ok = el.type === 'checkbox' ? el.checked : String(el.value || '').trim() !== '';
        if (el.name === 'zip' && ok) ok = /^\d{5}$/.test(el.value.trim());
        if (el.type !== 'checkbox') el.setAttribute('aria-invalid', ok ? 'false' : 'true');
        if (!ok) problems.push(el);
      });
      if (!form.querySelector('input[name="loss"]:checked')) problems.push({ name: 'loss', id: 'loss-q' });
      list.innerHTML = '';
      if (problems.length) {
        problems.forEach(function (p) {
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.href = '#' + (p.id || '');
          a.textContent = NAMES[p.name] || 'Complete this field';
          a.addEventListener('click', function (ev) {
            ev.preventDefault();
            var target = p.focus ? p : form.querySelector('input[name="loss"]');
            if (target) target.focus();
          });
          li.appendChild(a);
          list.appendChild(li);
        });
        summary.hidden = false;
        summary.focus();
        return;
      }
      summary.hidden = true;
      $('[data-actions]').hidden = true;
      $('[data-saved]').hidden = false;
    });
  }
})();
