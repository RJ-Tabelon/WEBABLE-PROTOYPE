// Alderra Pharmacy (fictional demo site for Gator Hack V). Plain JavaScript, no network.
// Query flags: ?reset=1 clears consent and saved state, ?modal=1 shows the text-signup modal. Shift+R resets.
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var KEYS = { consent: 'alderra.consent', chat: 'alderra.chat', signup: 'alderra.signup' };

  function store(kind) {
    try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; }
  }
  function getItem(kind, key) { var s = store(kind); try { return s ? s.getItem(key) : null; } catch (e) { return null; } }
  function setItem(kind, key, value) { var s = store(kind); try { if (s) s.setItem(key, value); } catch (e) { /* private mode */ } }
  function resetAll() {
    Object.keys(KEYS).forEach(function (k) {
      var l = store('local'), s = store('session');
      try { if (l) l.removeItem(KEYS[k]); if (s) s.removeItem(KEYS[k]); } catch (e) { /* ignore */ }
    });
  }
  if (params.get('reset') === '1') resetAll();

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function isEditable(el) {
    if (!el || !(el instanceof Element)) return false;
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  /* ---------------------------------------------------------------- toast */
  var toastEl = $('[data-toast]');
  var toastTimer = 0;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ---------------------------------------------------------------- nav dropdowns */
  var menuButtons = $all('.site-nav [aria-expanded][aria-controls]');
  function closeMenus(except) {
    menuButtons.forEach(function (b) {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      var m = document.getElementById(b.getAttribute('aria-controls'));
      if (m) m.hidden = true;
    });
  }
  menuButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') === 'true';
      closeMenus(b);
      b.setAttribute('aria-expanded', open ? 'false' : 'true');
      var m = document.getElementById(b.getAttribute('aria-controls'));
      if (m) m.hidden = open;
    });
  });
  document.addEventListener('click', function (e) {
    if (!(e.target instanceof Element) || !e.target.closest('.has-menu')) closeMenus(null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var open = menuButtons.filter(function (b) { return b.getAttribute('aria-expanded') === 'true'; })[0];
      if (open) { closeMenus(null); open.focus(); }
    }
  });

  /* ---------------------------------------------------------------- search */
  var search = $('[data-search]');
  if (search) {
    search.addEventListener('submit', function (e) {
      e.preventDefault();
      var hint = $('[data-search-hint]');
      if (hint) { hint.hidden = false; setTimeout(function () { hint.hidden = true; }, 2400); }
    });
  }

  /* ---------------------------------------------------------------- hero carousel
     The slides run on CSS animations (15 s cycle, 5 s per slide). The dots follow the animation
     events, and a dot click moves every slide's animation to the same point in the cycle. */
  var slides = $all('.hero-slide');
  var dots = $all('.hero-dot');
  var SLIDE_MS = 5000;
  var CYCLE_MS = SLIDE_MS * slides.length;
  function setDot(i) {
    dots.forEach(function (d, k) {
      if (k === i) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
  }
  // The first slide has no delay, so its animation clock is the carousel's phase.
  function phaseIndex() {
    var first = slides[0];
    var anims = first && typeof first.getAnimations === 'function' ? first.getAnimations() : [];
    var t = anims.length ? Number(anims[0].currentTime) : NaN;
    if (!isFinite(t)) return -1;
    return Math.floor((((t + 60) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS / SLIDE_MS) % slides.length;
  }
  function syncDot(fallback) {
    var i = phaseIndex();
    setDot(i >= 0 ? i : fallback);
  }
  slides.forEach(function (s, i) {
    s.addEventListener('animationstart', function () { syncDot(i); });
    s.addEventListener('animationiteration', function () { syncDot(i); });
  });
  dots.forEach(function (d, i) {
    d.addEventListener('click', function () {
      var phase = i * SLIDE_MS + 400; // just after slide i has faded in
      slides.forEach(function (s, j) {
        var anims = typeof s.getAnimations === 'function' ? s.getAnimations() : [];
        anims.forEach(function (a) {
          var local = (((phase - j * SLIDE_MS) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
          a.currentTime = j * SLIDE_MS + CYCLE_MS + local;
        });
      });
      setDot(i);
      // Seeking fires iteration events on the other slides; settle on the real phase afterwards.
      requestAnimationFrame(function () { syncDot(i); });
    });
  });

  /* ---------------------------------------------------------------- refill form */
  var form = $('[data-refill-form]');
  var summary = $('[data-summary]');
  var errorEl = $('[data-form-error]');
  var flu = { added: false };
  var plus = { on: false };

  function selectedRx() {
    return $all('input[name="rx"]', form).filter(function (c) { return c.checked && !c.disabled; });
  }
  function money(n) { return '$' + n.toFixed(2); }
  function updateSummary() {
    if (!summary) return;
    var rx = selectedRx();
    var total = rx.reduce(function (sum, c) { return sum + Number(c.getAttribute('data-copay') || 0); }, 0);
    var pickup = ($('input[name="pickup"]:checked', form) || {}).value;
    if (pickup === 'delivery' && !plus.on) total += 5.99;
    var parts = [rx.length === 1 ? '1 prescription selected' : rx.length + ' prescriptions selected'];
    if (flu.added) parts.push('flu shot');
    parts.push('Est. ' + (pickup === 'delivery' ? 'total ' : 'copay ') + money(total));
    summary.textContent = parts.join(' · ');
    if (rx.length > 0 && errorEl) errorEl.hidden = true;
  }
  if (form) {
    form.addEventListener('change', updateSummary);

    // The upsell is a div with role="button" (a non-native control, as found on many retail sites).
    var upsellBtn = $('[data-upsell-btn]');
    var upsellSub = $('[data-upsell-sub]');
    function toggleFlu() {
      flu.added = !flu.added;
      upsellBtn.setAttribute('aria-pressed', flu.added ? 'true' : 'false');
      upsellBtn.textContent = flu.added ? 'Flu shot added ✓' : 'Add flu shot to order';
      if (upsellSub) upsellSub.textContent = flu.added
        ? 'A pharmacist will give your flu shot when you pick up. You can remove it anytime.'
        : 'Ages 6 months and up. Takes about 10 minutes while you wait.';
      updateSummary();
    }
    if (upsellBtn) {
      upsellBtn.addEventListener('click', toggleFlu);
      upsellBtn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); toggleFlu(); }
        if (e.key === ' ') e.preventDefault();
      });
      upsellBtn.addEventListener('keyup', function (e) {
        if (e.key === ' ') { e.preventDefault(); toggleFlu(); }
      });
    }

    var membership = $('[data-membership]');
    var membershipBtn = $('[data-membership-btn]');
    var membershipSub = $('[data-membership-sub]');
    if (membershipBtn) {
      membershipBtn.addEventListener('click', function () {
        plus.on = !plus.on;
        membership.classList.toggle('is-on', plus.on);
        membershipBtn.textContent = plus.on ? 'Trial added ✓' : 'Start free Alderra+ trial';
        if (membershipSub) membershipSub.textContent = plus.on
          ? 'Your 30-day free trial starts with this order. Delivery is free.'
          : 'Free delivery, 10% off Alderra brand and a $5 reward every month. Cancel anytime.';
        updateSummary();
      });
    }

    var actions = $('[data-actions]');
    var confirmed = $('[data-confirmed]');
    var confirmedSub = $('[data-confirmed-sub]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var rx = selectedRx();
      if (rx.length === 0) {
        errorEl.textContent = 'Select at least one prescription to refill.';
        errorEl.hidden = false;
        return;
      }
      var pickup = ($('input[name="pickup"]:checked', form) || {}).value;
      var how = pickup === 'delivery' ? 'Delivery is scheduled for tomorrow.'
        : pickup === 'drive' ? 'Pull up to the drive-thru at Alderra #4127.'
        : "We'll text you when your order is ready at Alderra #4127.";
      if (confirmedSub) confirmedSub.textContent = how + (flu.added ? ' Your flu shot is booked for pickup.' : '');
      actions.hidden = true;
      errorEl.hidden = true;
      confirmed.hidden = false;
    });

    // "Continue shopping" swaps in a stub, so a misclick is easy to recover from.
    var refillView = $('[data-view="refill"]');
    var shopView = $('[data-view="shop"]');
    var continueBtn = $('[data-continue]');
    var backBtn = $('[data-back]');
    if (continueBtn && shopView) {
      continueBtn.addEventListener('click', function () {
        refillView.hidden = true;
        shopView.hidden = false;
        var h = $('#shop-title');
        if (h) h.focus();
        window.scrollTo({ top: Math.max(0, shopView.getBoundingClientRect().top + window.scrollY - 120) });
      });
    }
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        shopView.hidden = true;
        refillView.hidden = false;
        if (continueBtn) continueBtn.focus();
      });
    }
    updateSummary();
  }

  /* ---------------------------------------------------------------- cart buttons */
  var cartCount = $('[data-cart-count]');
  var cart = 0;
  $all('[data-add]').forEach(function (b) {
    b.addEventListener('click', function () {
      var added = b.classList.toggle('is-added');
      cart += added ? 1 : -1;
      if (cartCount) cartCount.textContent = String(cart);
      b.textContent = added ? 'Added' : 'Add';
      if (added) toast('Added to cart. Cart (' + cart + ')');
    });
  });

  /* ---------------------------------------------------------------- newsletter */
  var news = $('[data-newsletter]');
  if (news) {
    news.addEventListener('submit', function (e) {
      e.preventDefault();
      var done = $('[data-newsletter-done]');
      if (done) done.hidden = false;
    });
  }

  /* ---------------------------------------------------------------- cookie banner (appears 800 ms after load) */
  var cookie = $('[data-cookie]');
  var prefs = $('[data-cookie-prefs]');
  var manageBtn = $('[data-cookie-manage]');
  function showCookie() {
    if (!cookie) return;
    cookie.hidden = false;
    cookie.classList.add('is-entering');
    document.body.classList.add('has-cookie');
    requestAnimationFrame(function () { requestAnimationFrame(function () { cookie.classList.remove('is-entering'); }); });
  }
  function hideCookie(choice) {
    setItem('local', KEYS.consent, choice);
    cookie.hidden = true;
    cookie.classList.remove('is-expanded');
    if (prefs) prefs.hidden = true;
    if (manageBtn) manageBtn.textContent = 'Manage preferences';
    document.body.classList.remove('has-cookie');
  }
  if (cookie) {
    $('[data-cookie-accept]').addEventListener('click', function () { hideCookie('all'); });
    $('[data-cookie-reject]').addEventListener('click', function () { hideCookie('essential'); });
    manageBtn.addEventListener('click', function () {
      if (prefs.hidden) {
        prefs.hidden = false;
        cookie.classList.add('is-expanded');
        manageBtn.textContent = 'Save choices';
      } else {
        var chosen = $all('[data-pref]', prefs).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-pref'); });
        hideCookie(chosen.length ? 'custom:' + chosen.join(',') : 'essential');
      }
    });
    var settingsBtn = $('[data-cookie-settings]');
    if (settingsBtn) settingsBtn.addEventListener('click', showCookie);
    if (!getItem('local', KEYS.consent)) setTimeout(showCookie, 800);
  }

  /* ---------------------------------------------------------------- chat widget (auto-opens at 4.0 s) */
  var chat = $('[data-chat]');
  var bubble = $('[data-chat-bubble]');
  var panel = $('[data-chat-panel]');
  var log = $('[data-chat-log]');
  var typing = $('[data-chat-typing]');
  var chips = $('[data-chat-chips]');
  var greeted = false;
  function addMsg(text, who) {
    var p = document.createElement('p');
    p.className = 'chat-msg ' + (who === 'me' ? 'from-me' : 'from-bot');
    p.textContent = text;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }
  function botSay(text, delay) {
    typing.hidden = false;
    log.appendChild(typing);
    setTimeout(function () {
      typing.hidden = true;
      addMsg(text, 'bot');
    }, delay);
  }
  function openChat(auto) {
    if (!chat || !panel.hidden) return;
    panel.hidden = false;
    chat.classList.add('is-open');
    bubble.setAttribute('aria-expanded', 'true');
    var badge = $('.chat-badge', bubble);
    if (badge) badge.hidden = true;
    if (!auto) $('#chat-msg').focus();
    if (!greeted) {
      greeted = true;
      botSay('Hi! Need help with your refill? I can also tell you about flu shots and Alderra+ savings.', 1200);
      setTimeout(function () { chips.hidden = false; }, 1300);
    }
  }
  function minimizeChat() {
    panel.hidden = true;
    chat.classList.remove('is-open');
    bubble.setAttribute('aria-expanded', 'false');
    setItem('session', KEYS.chat, 'min');
    bubble.focus();
  }
  if (chat) {
    bubble.addEventListener('click', function () { openChat(false); });
    $('[data-chat-min]').addEventListener('click', minimizeChat);
    var replies = {
      'Refill status': 'Your last refill request is being reviewed by a pharmacist. Most refills are ready in about 2 hours.',
      'Flu shots': 'Walk in any time the pharmacy is open, or add a flu shot to your refill pickup. $0 with most insurance.',
      'Alderra+ savings': 'Alderra+ gives you free delivery, 10% off Alderra brand and a $5 reward every month. Try it free for 30 days!',
    };
    $all('[data-chip]', chips).forEach(function (c) {
      c.addEventListener('click', function () {
        addMsg(c.textContent, 'me');
        botSay(replies[c.textContent] || 'A team member will follow up shortly.', 900);
      });
    });
    $('[data-chat-form]').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#chat-msg');
      if (!input.value.trim()) return;
      addMsg(input.value.trim(), 'me');
      input.value = '';
      botSay('Thanks! A pharmacy team member will reply here in about 5 minutes.', 1000);
    });
    if (getItem('session', KEYS.chat) !== 'min') setTimeout(function () { openChat(true); }, 4000);
  }

  /* ---------------------------------------------------------------- optional text-signup modal (?modal=1) */
  var signup = $('[data-signup]');
  if (signup && params.get('modal') === '1' && !getItem('session', KEYS.signup)) {
    var lastFocus = null;
    var closeSignup = function () {
      signup.hidden = true;
      setItem('session', KEYS.signup, 'seen');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    };
    $all('[data-signup-close]', signup).forEach(function (b) { b.addEventListener('click', closeSignup); });
    $('[data-signup-form]', signup).addEventListener('submit', function (e) {
      e.preventDefault();
      closeSignup();
      toast('Thanks! This is a demo, so no text will be sent.');
    });
    signup.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSignup(); });
    setTimeout(function () {
      lastFocus = document.activeElement;
      signup.hidden = false;
      $('#signup-phone').focus();
    }, 2500);
  }

  /* ---------------------------------------------------------------- Shift+R resets the demo */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'R' || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    var origin = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
    if (isEditable(origin) || isEditable(document.activeElement)) return;
    resetAll();
    var keep = new URLSearchParams(location.search);
    keep.delete('reset');
    var q = keep.toString();
    location.replace(location.pathname + (q ? '?' + q : ''));
  });
})();
