/* ============================================================
   Window Draft — per-window condensation physics.

   Every ordinary app window slowly fogs over. The frost is a small
   canvas layered above the window's content; a CSS backdrop-filter
   blur (driven off the same coverage number) blurs the text/CAPTCHA
   underneath it in step. Drag a finger across the glass and it wipes
   clear via destination-out compositing — leave it alone and it
   creeps back. Trace a right-angled loop or a circuit-like path
   while wiping and the window slams shut for 10 seconds:
   "[SECURITY] Non-organic geometric pattern detected on glass.
   Window isolated." — every listener is bound to that window's own
   canvas, so nothing here ever touches global mouse state, and the
   render loop only exists while that window actually has fog on it.
   ============================================================ */
(function (global) {
  const BACKING_MAX = 240;         // backing-store cap (perf, and a pixelated look)
  const BACKING_SCALE = 0.55;
  const MAX_BLUR = 7;              // px, at 100% coverage
  const FOG_TICK_MS = 950;         // how often an ambient frost pass runs
  const AMBIENT_ALPHA = 0.03;      // per-tick frost gain — gentle, but still visibly accumulates
  const WIPE_GRACE_MS = 1200;      // no re-fogging for a beat after you stop wiping
  const SAMPLE_MS = 160;           // throttle for the coverage readback
  const LOCK_MS = 10000;
  const WIPE_R = 38;               // wipe brush radius, backing px — generous eraser

  /* Window Draft is a bounded challenge, not an endless grind: once the
     glass gets bad enough, the system flags it, gives you one real
     10-second shot to wipe it back under CLEAR_TARGET, and if you make
     it the window is IMMUNE for good — no more fog, ever, this session.
     Miss the window and it just quietly tries again later. */
  const CHALLENGE_TRIGGER = 55;    // coverage% that raises the alarm
  const CHALLENGE_MS = 10000;      // the 10 seconds you get to clear it
  const CHALLENGE_CLEAR_TARGET = 35; // must be AT OR BELOW this coverage% when time's up
  const CHALLENGE_COOLDOWN_MS = 6000; // breathing room after a failed attempt

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  }

  /* a short synthesized alert stinger for a lockout — native Web Audio, no assets */
  function lockStinger() {
    try {
      if (global.Sound && Sound.critical) { Sound.critical(); return; }
    } catch (e) {}
    try {
      const c = ctx(), t0 = c.currentTime;
      [740, 494, 740].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = "square"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.1);
        g.gain.linearRampToValueAtTime(0.2, t0 + i * 0.1 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.1 + 0.1);
        o.connect(g).connect(c.destination);
        o.start(t0 + i * 0.1); o.stop(t0 + i * 0.1 + 0.11);
      });
    } catch (e) {}
  }

  /* ---------------- per-window state registry ---------------- */
  const registry = new Map();       // win element -> state

  function attach(win) {
    if (registry.has(win)) return;
    const body = win.querySelector(".body");
    if (!body) return;

    const blur = document.createElement("div");
    blur.className = "wfog-blur";
    const canvas = document.createElement("canvas");
    canvas.className = "wfog-canvas";
    const hint = document.createElement("div");
    hint.className = "wfog-hint";
    hint.textContent = "condensation — wipe the glass";
    const lockOv = document.createElement("div");
    lockOv.className = "wfog-lock";
    lockOv.innerHTML =
      '<div class="wfog-lock-msg">[SECURITY] Non-organic geometric pattern detected on glass.<br>Window isolated.</div>' +
      '<div class="wfog-lock-timer"></div>';
    const warn = document.createElement("div");
    warn.className = "wfog-warn";

    body.appendChild(blur);
    body.appendChild(canvas);
    body.appendChild(hint);
    body.appendChild(warn);
    body.appendChild(lockOv);

    const st = {
      win, body, canvas, g: canvas.getContext("2d"), blur, hint, lockOv, warn,
      coverage: 0,                 // 0..100, single source of truth — sampled, never guessed
      wiping: false, last: null, stroke: [], lastWipeEnd: 0,
      locked: false, lockTimer: null, lockTick: null,
      fogTimer: null, raf: null, lastSample: 0,
      wipedOnce: false, ro: null,
      immune: false,                          // permanently cleared for this session
      challengeActive: false, challengeTimer: null, warnTick: null,
      challengeCooldownUntil: 0
    };
    registry.set(win, st);

    resize(st);
    st.ro = new ResizeObserver(() => resize(st));
    st.ro.observe(body);

    /* pointer handling — scoped entirely to this canvas, nothing global */
    canvas.addEventListener("pointerdown", (e) => onDown(st, e));
    canvas.addEventListener("pointermove", (e) => onMove(st, e));
    canvas.addEventListener("pointerup", (e) => onUp(st, e));
    canvas.addEventListener("pointercancel", (e) => onUp(st, e));

    st.fogTimer = setInterval(() => growFog(st), FOG_TICK_MS);
  }

  function detach(win) {
    const st = registry.get(win);
    if (!st) return;
    clearInterval(st.fogTimer);
    clearTimeout(st.lockTimer);
    clearInterval(st.lockTick);
    clearTimeout(st.challengeTimer);
    clearInterval(st.warnTick);
    if (st.raf) cancelAnimationFrame(st.raf);
    if (st.ro) st.ro.disconnect();
    registry.delete(win);
  }

  function resize(st) {
    const w = Math.max(1, st.body.clientWidth), h = Math.max(1, st.body.clientHeight);
    const bw = Math.min(BACKING_MAX, Math.round(w * BACKING_SCALE));
    const bh = Math.min(BACKING_MAX, Math.round(h * BACKING_SCALE));
    if (st.canvas.width !== bw || st.canvas.height !== bh) {
      st.canvas.width = bw; st.canvas.height = bh;
      // resizing clears the backing store — repaint at whatever coverage the
      // window already had (0 on first mount, so new windows start clean)
      if (st.coverage > 0) frostFill(st, clamp(st.coverage / 100, 0, 1));
      kickstart(st);
    }
  }

  /* ---------------- frost painting ---------------- */
  function frostFill(st, alphaScale) {
    const g = st.g, w = st.canvas.width, h = st.canvas.height;
    g.globalCompositeOperation = "source-over";
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(220,231,238," + (0.9 * alphaScale).toFixed(3) + ")");
    grad.addColorStop(1, "rgba(196,213,224," + (0.94 * alphaScale).toFixed(3) + ")");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255," + (0.12 * alphaScale).toFixed(3) + ")";
    const n = Math.max(4, Math.round((w * h) / 900));
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * (w * 0.14);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }

  function paintFullFrost(st) { frostFill(st, 1); }

  /* the tick that slowly re-fogs the glass. Deliberately gentle: a single,
     near-invisible source-over pass per tick, so a window you just wiped
     clear stays readable for a good while instead of the condensation
     engine fighting you for it. Coverage itself is never hand-incremented
     here — the real getImageData sample (below) is the only source of
     truth, so the blur always tracks what's actually still fogged. */
  function growFog(st) {
    if (st.immune || st.locked || st.wiping || st.challengeActive) return;
    if (performance.now() - st.lastWipeEnd < WIPE_GRACE_MS) return;
    if (st.coverage >= 97) return;
    const g = st.g, w = st.canvas.width, h = st.canvas.height;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgba(220,230,240," + AMBIENT_ALPHA + ")";
    g.fillRect(0, 0, w, h);
    kickstart(st);           // wake the sampler so the new coverage is picked up
  }

  /* ---------------- the 10-second clearing challenge ---------------- */
  function showWarn(st, text, withCountdown) {
    st.warn.innerHTML = '<div class="wfog-warn-msg">' + text + '</div>' +
      (withCountdown ? '<div class="wfog-warn-timer"></div>' : '');
    st.warn.classList.add("show");
    clearInterval(st.warnTick);
    if (withCountdown) {
      let remain = Math.round(CHALLENGE_MS / 1000);
      const timerEl = st.warn.querySelector(".wfog-warn-timer");
      const paint = () => { if (timerEl) timerEl.textContent = Math.max(0, remain) + "s to clear " + (100 - CHALLENGE_CLEAR_TARGET) + "%+"; };
      paint();
      st.warnTick = setInterval(() => { remain--; paint(); if (remain <= 0) clearInterval(st.warnTick); }, 1000);
    }
  }
  function hideWarn(st) { st.warn.classList.remove("show"); clearInterval(st.warnTick); }

  function maybeTriggerChallenge(st) {
    if (st.immune || st.locked || st.challengeActive) return;
    if (st.coverage < CHALLENGE_TRIGGER) return;
    if (performance.now() < st.challengeCooldownUntil) return;
    st.challengeActive = true;
    if (st.fogTimer) { clearInterval(st.fogTimer); st.fogTimer = null; }  // a fair, bounded shot
    showWarn(st, "[SYSTEM] Glass behaving unusually — clear the condensation.", true);
    try { global.Sound && Sound.error && Sound.error(); } catch (e) {}
    st.challengeTimer = setTimeout(() => resolveChallenge(st), CHALLENGE_MS);
  }

  function resolveChallenge(st) {
    st.challengeActive = false;
    st.challengeTimer = null;
    if (st.coverage <= CHALLENGE_CLEAR_TARGET) {
      st.immune = true;                       // won — no more fog, ever, this session
      // clearRect, not a destination-out fillRect: fillRect would erase using
      // whatever fillStyle/alpha was left over from the last frost or shimmer
      // pass (sometimes near-invisible), so the "clear" silently did almost
      // nothing and the glass still read as foggy. clearRect always wipes
      // the rectangle to fully transparent, no matter what state g is in.
      st.g.clearRect(0, 0, st.canvas.width, st.canvas.height);
      st.coverage = 0;
      applyCoverage(st);
      try { global.Sound && Sound.levelup && Sound.levelup(); } catch (e) {}
      showWarn(st, "[SYSTEM] Glass stabilized. Condensation control disengaged.", false);
      setTimeout(() => hideWarn(st), 2600);
    } else {
      st.challengeCooldownUntil = performance.now() + CHALLENGE_COOLDOWN_MS;
      try { global.Sound && Sound.bad && Sound.bad(); } catch (e) {}
      showWarn(st, "[SYSTEM] Insufficient clearing. Condensation resumes.", false);
      setTimeout(() => hideWarn(st), 2200);
      if (!st.fogTimer) st.fogTimer = setInterval(() => growFog(st), FOG_TICK_MS);
      kickstart(st);
    }
  }

  function applyCoverage(st) {
    // clear glass means NO blur — remove the filter outright rather than
    // leaving a stale blur(0px) that some engines still composite as a layer
    if (st.coverage <= 1) {
      st.blur.style.backdropFilter = "none";
      st.blur.style.webkitBackdropFilter = "none";
    } else {
      const px = (st.coverage / 100) * MAX_BLUR;
      st.blur.style.backdropFilter = "blur(" + px.toFixed(2) + "px)";
      st.blur.style.webkitBackdropFilter = "blur(" + px.toFixed(2) + "px)";
    }
    st.blur.style.opacity = st.coverage > 1 ? "1" : "0";
    st.canvas.style.opacity = st.coverage > 1 ? "1" : "0";
    // only the fogged glass should intercept clicks — clear glass must let
    // every click/keystroke straight through to the window's real content
    st.canvas.style.pointerEvents = st.coverage > 1 ? "auto" : "none";
    st.hint.classList.toggle("show", st.coverage > 30 && !st.wipedOnce);
  }

  /* coarse alpha-coverage readback — a CONTINUOUS average over a stride
     grid, throttled. A uniform ambient pass raises every sampled pixel's
     alpha together, so a binary "past this cutoff" count would sit at 0%
     for a long stretch and then jump to ~100% in a single tick; averaging
     the raw alpha gives a smooth, honestly-progressive percentage instead. */
  function sampleCoverage(st) {
    const g = st.g, w = st.canvas.width, h = st.canvas.height, step = 6;
    let total = 0, sum = 0;
    let data;
    try { data = g.getImageData(0, 0, w, h).data; } catch (e) { return st.coverage; }
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        total++;
        sum += data[(y * w + x) * 4 + 3];
      }
    }
    return total ? Math.round((sum / total / 255) * 100) : 0;
  }

  /* ---------------- the render loop — only alive while there's fog ---------------- */
  function kickstart(st) {
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => frame(st));
  }

  function frame(st, ts) {
    st.raf = null;
    const now = ts || performance.now();
    // a minimized/backgrounded window does no sampling or shimmer work — but
    // the loop is kept alive (while there's still fog) so it resumes on show
    const visible = !document.hidden && st.body.offsetParent !== null;
    if (visible) {
      if (now - st.lastSample > SAMPLE_MS) {
        st.lastSample = now;
        st.coverage = sampleCoverage(st);
        applyCoverage(st);
        maybeTriggerChallenge(st);
      }
      // a faint drifting shimmer keeps the glass feeling alive — cheap, few rects
      if (st.coverage > 0 && !st.locked) {
        const g = st.g, w = st.canvas.width, h = st.canvas.height;
        const t = now * 0.0009;
        g.globalCompositeOperation = "source-over";
        g.fillStyle = "rgba(255,255,255,0.015)";
        g.fillRect((Math.sin(t) * 0.5 + 0.5) * w * 0.6, (Math.cos(t * 0.7) * 0.5 + 0.5) * h * 0.6,
          w * 0.35, h * 0.35);
      }
    }
    if (st.coverage > 0 || st.wiping) {
      st.raf = requestAnimationFrame((ts2) => frame(st, ts2));
    }
  }

  /* ---------------- wiping ---------------- */
  function toBacking(st, e) {
    const r = st.canvas.getBoundingClientRect();
    const sx = st.canvas.width / Math.max(1, r.width);
    const sy = st.canvas.height / Math.max(1, r.height);
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  }

  function onDown(st, e) {
    if (st.locked) return;
    st.wiping = true;
    st.hint.classList.remove("show"); st.wipedOnce = true;
    st.last = toBacking(st, e);
    st.stroke = [[e.clientX, e.clientY]];
    try { st.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    wipe(st, st.last, st.last);
    kickstart(st);
  }
  function onMove(st, e) {
    if (st.locked || !st.wiping) return;
    const p = toBacking(st, e);
    wipe(st, st.last, p);
    st.last = p;
    st.stroke.push([e.clientX, e.clientY]);
  }
  function onUp(st, e) {
    if (!st.wiping) return;
    st.wiping = false;
    st.lastWipeEnd = performance.now();
    if (st.stroke.length > 4) analyzeStroke(st, st.stroke);
    st.stroke = []; st.last = null;
  }

  function wipe(st, a, b) {
    const g = st.g;
    g.globalCompositeOperation = "destination-out";
    g.strokeStyle = "rgba(0,0,0,1)"; g.fillStyle = "rgba(0,0,0,1)";
    g.lineWidth = WIPE_R * 2; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    g.beginPath(); g.arc(b[0], b[1], WIPE_R, 0, Math.PI * 2); g.fill();
  }

  /* ---------------- geometric-pattern detection ---------------- */
  function resample(pts) {
    const out = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc >= 18) { out.push(pts[i]); acc = 0; }
    }
    return out;
  }
  function rightAngleCount(r) {
    let n = 0;
    for (let i = 1; i < r.length - 1; i++) {
      const ax = r[i][0] - r[i - 1][0], ay = r[i][1] - r[i - 1][1];
      const bx = r[i + 1][0] - r[i][0], by = r[i + 1][1] - r[i][1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 6 || lb < 6) continue;
      const ang = Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1)) * 180 / Math.PI;
      if (ang > 60 && ang < 120) n++;
    }
    return n;
  }
  function axisFraction(r) {
    let axis = 0, tot = 0;
    for (let i = 1; i < r.length; i++) {
      const dx = Math.abs(r[i][0] - r[i - 1][0]), dy = Math.abs(r[i][1] - r[i - 1][1]);
      tot++; if (dx < 8 || dy < 8) axis++;
    }
    return tot ? axis / tot : 0;
  }

  function analyzeStroke(st, pts) {
    const n = pts.length;
    let len = 0, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i < n; i++) {
      const x = pts[i][0], y = pts[i][1];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    }
    if (len < 130) return;
    const span = Math.hypot(pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1]);
    const diag = Math.hypot(maxX - minX, maxY - minY);
    const r = resample(pts);
    const corners = rightAngleCount(r);
    const loopClosed = span < 42 && len > 200 && diag > 90;
    const circuitLike = axisFraction(r) > 0.65;

    if (corners >= 2 && (loopClosed || circuitLike)) lockWindow(st);
  }

  /* ---------------- lockout: isolated to this window only ---------------- */
  function lockWindow(st) {
    if (st.locked) return;
    st.locked = true;
    st.wiping = false;
    if (st.challengeActive) {
      clearTimeout(st.challengeTimer); st.challengeActive = false; hideWarn(st);
      if (!st.fogTimer && !st.immune) st.fogTimer = setInterval(() => growFog(st), FOG_TICK_MS);
    }
    st.lockOv.classList.add("show");
    lockStinger();

    let remaining = LOCK_MS / 1000;
    const timerEl = st.lockOv.querySelector(".wfog-lock-timer");
    timerEl.textContent = remaining + "s";
    st.lockTick = setInterval(() => {
      remaining--;
      timerEl.textContent = Math.max(0, remaining) + "s";
    }, 1000);

    st.lockTimer = setTimeout(() => {
      clearInterval(st.lockTick);
      st.locked = false;
      st.lockOv.classList.remove("show");
      try { global.Sound && Sound.unlock && Sound.unlock(); } catch (e) {}
      kickstart(st);
    }, LOCK_MS);
  }

  /* ---------------- desktop observer: attach/detach as windows come and go ---------------- */
  function eligible(node) {
    return node.nodeType === 1 && node.classList && node.classList.contains("win") &&
      !node.classList.contains("errbox") &&
      node.dataset.system !== "1" && node.dataset.nofog !== "1";
  }

  function watch() {
    const desktop = document.getElementById("desktop");
    if (!desktop) { setTimeout(watch, 200); return; }
    desktop.querySelectorAll(".win").forEach((w) => { if (eligible(w)) attach(w); });
    new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes.forEach((node) => { if (eligible(node)) attach(node); });
        m.removedNodes.forEach((node) => { if (node.nodeType === 1 && registry.has(node)) detach(node); });
      });
    }).observe(desktop, { childList: true });
  }
  watch();

  global.WindowFog = {
    coverageOf(win) { const st = registry.get(win); return st ? Math.round(st.coverage) : 0; }
  };
})(window);
