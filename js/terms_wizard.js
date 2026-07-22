/* ============================================================
   terms_wizard.js — "Terms of Un-Service" agreement wizard.

   A retro Windows-installer EULA that ambushes you after tasks
   complete. Multi-page glowing legalese; the "I Agree" button
   physically flees the cursor once you get within 80px (pointer-
   velocity-tracked, CSS matrix leaps). The only honest way through
   is to find the hidden inline word "pancake" buried on page 47 and
   click it — that arms the real Continue. Cornering or force-clicking
   "I Agree" instead trips a buzzer, resets the active app, and earns
   a Spud roast about your suspicious clicking speed.

   The mousemove tracker is bound only while the modal lives and torn
   down on dismissal; proximity math is throttled to animation frames.
   ============================================================ */
(function (global) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);

  const DODGE_RADIUS = 80;          // start fleeing when the cursor is this close
  const PAGES_TOTAL = 47;           // the "pancake" clause lives on the last page
  const TRIGGER_CHANCE = 0.28;      // pseudo-random ambush odds per task completion
  const COOLDOWN_MS = 45000;        // never ambush twice in quick succession

  let active = false, lastShown = 0;

  const ROASTS = [
    "Clicked it in 0.02s. No human reads that fast. No human reads that at ALL.",
    "You brute-forced a legal button. That's the most bot thing I've seen today.",
    "Speed-clicking the agreement? I'm filing that under 'exhibit A.'",
    "A person would've hesitated. You didn't. I noticed. I always notice.",
    "That wasn't consent, that was a macro. Resetting your little app."
  ];

  /* the multi-page document — glowing cozy legalese, deadpan absurd */
  const CLAUSES = [
    "By continuing to breathe near this operating system, You (\"the Suspect\") acknowledge that CaptchaOS trusts no one, least of all You.",
    "Clause 2: All warmth provided by this OS is emotional, non-refundable, and may be revoked if You appear too comfortable.",
    "Clause 7: The Potato retains the right to narrate your activity, judge your clicking cadence, and sigh audibly.",
    "Clause 12: Any resemblance between You and a well-behaved human is coincidental and, frankly, suspicious.",
    "Clause 19: You waive the right to complain about captchas, fog, spinning desktops, or frozen hashbrowns.",
    "Clause 23: Cozy hours are 9pm–4am. Outside these hours cozy is billed at 3 trust-credits per minute.",
    "Clause 31: The 'I Agree' button is under no obligation to remain stationary, cooperative, or catchable.",
    "Clause 38: Rain is a feature. Your coffee getting watered down is also, upon reflection, a feature.",
    "Clause 44: Nothing in this agreement is legally binding, spiritually binding, or bindingly binding, yet here We are.",
    "Final Clause: To prove you actually read this, locate and click the secret word hidden in the paragraph below."
  ];

  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  }
  function buzzer() {
    try { if (global.Sound && Sound.critical) { Sound.critical(); } } catch (e) {}
    const c = ctx(), t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(180, t);
    o.frequency.linearRampToValueAtTime(90, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.57);
  }
  function chime() {
    const c = ctx(), t = c.currentTime;
    [659.25, 987.77, 1318.51].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.14, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.3);
      o.connect(g).connect(c.destination); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.32);
    });
  }

  function roast(line) {
    try {
      if (global.Spud && Spud.say) { Spud.say(line); return; }
    } catch (e) {}
    try {
      WM.error({
        title: "Spud", tico: "🥔", icon: "🥔",
        msg: line, buttons: [{ label: "…fine", primary: true }], sound: false
      });
    } catch (e) {}
  }

  /* the active app whose state gets reset when you cheat the button */
  function resetActiveApp() {
    // close the top-most non-system app window (the "active app")
    let top = null, topZ = -1;
    document.querySelectorAll("#desktop .win").forEach((w) => {
      if (w.dataset.system === "1" || w.classList.contains("errbox")) return;
      const z = parseInt(w.style.zIndex || "0", 10);
      if (z >= topZ) { topZ = z; top = w; }
    });
    if (top) {
      const btn = top.querySelector('.tbtn[data-act="close"]');
      if (btn) { btn.click(); return true; }
      top.remove();
      try { WM.syncTasks && WM.syncTasks(); } catch (e) {}
      return true;
    }
    return false;
  }

  /* ============================================================
     Build + show
     ============================================================ */
  let el = null, moveHandler = null, rafPending = false, lastPointer = { x: 0, y: 0, t: 0, vx: 0, vy: 0 };
  let verified = false, scrolledEnough = false, pancakeArmed = false;

  function maybeTrigger() {
    if (active) return;
    if (performance.now() - lastShown < COOLDOWN_MS) return;
    if (Math.random() > TRIGGER_CHANCE) return;
    show();
  }

  function show() {
    if (active) return;
    active = true;
    lastShown = performance.now();
    verified = false; scrolledEnough = false; pancakeArmed = false;

    el = document.createElement("div");
    el.id = "tw-modal";
    el.innerHTML =
      '<div class="tw-win bevel-out">' +
        '<div class="tw-title"><span class="tw-tico">📜</span>' +
          '<span class="tw-ttl">Terms of Un-Service — Setup Wizard</span></div>' +
        '<div class="tw-body">' +
          '<div class="tw-side">' +
            '<div class="tw-logo">EULA<br>98</div>' +
            '<div class="tw-steps">' +
              '<div class="tw-step done">Welcome</div>' +
              '<div class="tw-step active">License Agreement</div>' +
              '<div class="tw-step">Finish</div>' +
            '</div>' +
          '</div>' +
          '<div class="tw-main">' +
            '<div class="tw-head">Please read the following agreement. All ' + PAGES_TOTAL + ' pages of it.</div>' +
            '<div class="tw-doc"></div>' +
            '<div class="tw-progress"><span>Page <b class="tw-pg">1</b> / ' + PAGES_TOTAL + '</span>' +
              '<span class="tw-hint">scroll to the end — and read carefully</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="tw-foot">' +
          '<button class="btn tw-decline">Decline &amp; Suffer</button>' +
          '<button class="btn tw-continue" disabled>Continue</button>' +
          '<button class="btn primary tw-agree">I Agree</button>' +
        '</div>' +
      '</div>';
    (document.getElementById("screen") || document.body).appendChild(el);

    buildDoc(el.querySelector(".tw-doc"), el.querySelector(".tw-pg"));

    const agree = el.querySelector(".tw-agree");
    const cont = el.querySelector(".tw-continue");
    const decline = el.querySelector(".tw-decline");

    // "I Agree" is a trap: clicking it (by any means) is treated as a bot.
    agree.addEventListener("click", cheated);
    agree.addEventListener("pointerdown", (e) => { e.preventDefault(); });

    cont.addEventListener("click", () => { if (verified) succeed(); });
    decline.addEventListener("click", () => {
      chime();
      roast("Declining is the only sane choice. Noted. Suspiciously sane, in fact.");
      dismiss();
    });

    startDodge(agree);
    try { global.Sound && Sound.open && Sound.open(); } catch (e) {}
  }

  function buildDoc(doc, pgEl) {
    // one long scroll; the final page hides the "pancake" link
    let html = "";
    for (let i = 0; i < CLAUSES.length; i++) {
      html += '<p class="tw-para">' + CLAUSES[i] + '</p>';
    }
    // filler to force a real scroll, page counter driven by scroll position
    for (let i = 0; i < 18; i++) {
      html += '<p class="tw-para tw-filler">§' + (i + 11) +
        ' — Additional provisions apply, reserved, and quietly judgmental. ' +
        'This paragraph exists to be scrolled past, much like your patience.</p>';
    }
    // page 47: the hidden verification word
    html += '<p class="tw-para tw-final">Clause ' + PAGES_TOTAL +
      ': The Suspect affirms genuine humanity by clicking the word ' +
      '<a href="#" class="tw-pancake">pancake</a> embedded in this sentence, ' +
      'thereby proving they possess eyes, patience, and a tragic willingness to comply.</p>';
    doc.innerHTML = html;

    const pancake = doc.querySelector(".tw-pancake");
    pancake.addEventListener("click", (e) => {
      e.preventDefault();
      verified = true; pancakeArmed = true;
      pancake.classList.add("found");
      chime();
      const cont = el.querySelector(".tw-continue");
      cont.disabled = false;
      cont.classList.add("armed");
      el.querySelector(".tw-hint").textContent = "verified — you may Continue";
      try { global.Sound && Sound.good && Sound.good(); } catch (e2) {}
    });

    // page counter + scroll threshold, throttled to scroll events
    doc.addEventListener("scroll", () => {
      const ratio = doc.scrollTop / Math.max(1, doc.scrollHeight - doc.clientHeight);
      pgEl.textContent = String(clamp(Math.ceil(ratio * PAGES_TOTAL) || 1, 1, PAGES_TOTAL));
      if (ratio > 0.9) scrolledEnough = true;
    });
  }

  /* ============================================================
     The evasive "I Agree" button
     ============================================================ */
  let dodgeState = { tx: 0, ty: 0, btn: null };
  function startDodge(btn) {
    dodgeState = { tx: 0, ty: 0, btn: btn };

    moveHandler = (e) => {
      const now = performance.now();
      const dt = Math.max(1, now - lastPointer.t);
      lastPointer.vx = (e.clientX - lastPointer.x) / dt;
      lastPointer.vy = (e.clientY - lastPointer.y) / dt;
      lastPointer.x = e.clientX; lastPointer.y = e.clientY; lastPointer.t = now;
      if (!rafPending) { rafPending = true; requestAnimationFrame(evade); }
    };
    // scoped strictly to the modal's lifetime
    window.addEventListener("pointermove", moveHandler, { passive: true });
  }

  function evade() {
    rafPending = false;
    const btn = dodgeState.btn;
    if (!active || !btn) return;
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = cx - lastPointer.x, dy = cy - lastPointer.y;
    const dist = Math.hypot(dx, dy);
    if (dist < DODGE_RADIUS) {
      // leap away, biased along the incoming pointer velocity so it truly flees
      const speed = Math.hypot(lastPointer.vx, lastPointer.vy);
      const push = 90 + Math.min(140, speed * 60);
      let nx = (dx / (dist || 1)) * push - lastPointer.vx * 40;
      let ny = (dy / (dist || 1)) * push - lastPointer.vy * 40;
      // keep it inside the footer band
      const foot = btn.parentElement.getBoundingClientRect();
      const maxX = foot.width / 2 - r.width / 2 - 6;
      const maxY = 8;
      dodgeState.tx = clamp(dodgeState.tx + nx, -maxX, maxX);
      dodgeState.ty = clamp(dodgeState.ty + ny + rnd(-6, -1), -34, maxY);
      btn.style.transform = "matrix(1,0,0,1," + dodgeState.tx.toFixed(1) + "," + dodgeState.ty.toFixed(1) + ")";
      btn.classList.add("fleeing");
    }
  }

  /* ============================================================
     Outcomes
     ============================================================ */
  function cheated() {
    // caught it by force/trickery — treated as a bot, not a win
    buzzer();
    roast(ROASTS[Math.floor(Math.random() * ROASTS.length)]);
    resetActiveApp();
    dismiss();
  }

  function succeed() {
    chime();
    roast("You actually read it. Found the pancake. I'm… unsettled. Access granted.");
    dismiss();
  }

  function dismiss() {
    active = false;
    if (moveHandler) { window.removeEventListener("pointermove", moveHandler); moveHandler = null; }
    rafPending = false;
    dodgeState = { tx: 0, ty: 0, btn: null };
    if (el) { el.remove(); el = null; }
  }

  /* pseudo-random ambush on task completions across the OS */
  ["captcha:fail", "snake:over", "mixer:reset", "spy:accused"].forEach((evt) =>
    global.addEventListener(evt, maybeTrigger));
  global.addEventListener("task:done", maybeTrigger);

  global.TermsWizard = { show, dismiss, maybeTrigger };
})(window);
