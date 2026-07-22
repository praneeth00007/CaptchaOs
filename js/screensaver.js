/* ============================================================
   screensaver.js — Sleep / De-authorization Protocol.

   After 30s of desktop stillness a cozy screensaver takes over the
   whole screen: a pixel-art campfire with drifting embers, glowing
   bamboo pipes, and Spud asleep in a sleeping bag — with synthesized
   nighttime chimes and a crackling fire loop.

   Any wake attempt (move / key / touch) freezes the saver and drops
   a Scrambled Pattern-Lock captcha. Every drawn attempt reshuffles
   the node grid AND the target pattern — you can never actually
   solve it, which is the joke: "[SECURITY] Sleep analysis detected
   binary dreaming. Pattern sequence randomized for safety." Waking
   before Spud has napped a full 60s earns an annoyed frequency-sweep
   grumble and a line of sarcasm about his ruined nap.

   Perf: the rAF loop runs ONLY while the overlay is visible; idle
   detection uses throttled pointer/key listeners; the pattern lock's
   pointer handlers are scoped to its own canvas so the rest of the OS
   never gets globally input-locked.
   ============================================================ */
(function (global) {
  const IDLE_MS = 30000;              // stillness before the saver kicks in
  const NAP_MIN_MS = 60000;           // waking before this annoys Spud
  const MOVE_THROTTLE = 400;          // throttle activity resets

  const NAP_LINES = [
    "Sixty seconds. That's all I asked. You couldn't manage it.",
    "I was DREAMING. In binary. It was going so well.",
    "Ugh. Fine. I'm up. Happy? You woke a sleeping potato.",
    "The sleeping bag was warm and you have ruined everything.",
    "Do you know how hard it is for a tuber to fall asleep?"
  ];

  let idleTimer = null, lastReset = 0;
  let active = false, raf = null, startT = 0, frame = 0;
  let overlay = null, cv = null, g = null;
  let audio = null;
  let embers = [];

  /* ============================================================
     Audio — nighttime chimes + fire crackle loop + grumble
     ============================================================ */
  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  }

  function startAudio() {
    const c = ctx();
    const bus = c.createGain(); bus.gain.value = 0.9; bus.connect(c.destination);

    // crackling fire: looping brown-ish noise + random pops
    const n = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 640; bp.Q.value = 0.7;
    const fg = c.createGain(); fg.gain.value = 0.10;
    src.connect(bp).connect(fg).connect(bus); src.start();

    const timers = [];
    const pop = () => {
      const t = c.currentTime;
      const pn = Math.floor(c.sampleRate * 0.04);
      const pb = c.createBuffer(1, pn, c.sampleRate), pd = pb.getChannelData(0);
      for (let i = 0; i < pn; i++) pd[i] = (Math.random() * 2 - 1) * (1 - i / pn);
      const ps = c.createBufferSource(); ps.buffer = pb;
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1500;
      const pg = c.createGain(); pg.gain.value = 0.14 + Math.random() * 0.12;
      ps.connect(hp).connect(pg).connect(bus); ps.start(t); ps.stop(t + 0.06);
      timers.push(setTimeout(pop, 200 + Math.random() * 900));
    };
    pop();

    // sparse warm nighttime chimes (pentatonic)
    const notes = [523.25, 587.33, 659.25, 784.00, 880.00];
    const chime = () => {
      const t = c.currentTime;
      const f = notes[Math.floor(Math.random() * notes.length)] * (Math.random() < 0.4 ? 2 : 1);
      const o = c.createOscillator(), gg = c.createGain();
      o.type = "sine"; o.frequency.value = f;
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.linearRampToValueAtTime(0.05, t + 0.05);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(gg).connect(bus); o.start(t); o.stop(t + 2.5);
      timers.push(setTimeout(chime, 2600 + Math.random() * 3200));
    };
    timers.push(setTimeout(chime, 1200));

    audio = { stop() { timers.forEach(clearTimeout); try { src.stop(0); } catch (e) {} try { bus.disconnect(); } catch (e) {} } };
  }
  function stopAudio() { if (audio) { audio.stop(); audio = null; } }

  function grumble() {
    const c = ctx(), t = c.currentTime;
    const o = c.createOscillator(), gg = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(220, t);
    o.frequency.linearRampToValueAtTime(90, t + 0.35);
    o.frequency.linearRampToValueAtTime(140, t + 0.6);
    gg.gain.setValueAtTime(0.0001, t);
    gg.gain.linearRampToValueAtTime(0.22, t + 0.05);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(gg).connect(c.destination); o.start(t); o.stop(t + 0.72);
  }

  /* ============================================================
     Idle monitoring — throttled, cheap
     ============================================================ */
  function resetIdle() {
    const t = performance.now();
    if (t - lastReset < MOVE_THROTTLE) return;
    lastReset = t;
    if (active) return;               // wakes are handled by the overlay itself
    clearTimeout(idleTimer);
    idleTimer = setTimeout(activate, IDLE_MS);
  }

  function armMonitors() {
    ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) =>
      global.addEventListener(ev, resetIdle, { passive: true }));
    resetIdle();
  }

  /* ============================================================
     Screensaver overlay + canvas
     ============================================================ */
  function activate() {
    if (active) return;
    // don't sleep over the boot/login or an existing takeover
    if (document.getElementById("aac-overlay")) { resetIdle(); return; }
    const desktop = document.getElementById("desktop");
    if (!desktop || desktop.offsetParent === null) { return; }
    active = true; startT = performance.now(); frame = 0; embers = [];

    overlay = document.createElement("div");
    overlay.id = "ss-overlay";
    overlay.innerHTML = '<canvas class="ss-cv"></canvas>' +
      '<div class="ss-tag">z z z … CaptchaOS is resting. Move to wake.</div>';
    (document.getElementById("screen") || document.body).appendChild(overlay);

    cv = overlay.querySelector(".ss-cv");
    g = cv.getContext("2d");
    resize();
    global.addEventListener("resize", resize);

    startAudio();
    // the wake interceptor — first interaction stops the saver, opens the lock
    ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((ev) =>
      overlay.addEventListener(ev, wake, { passive: false }));
    global.addEventListener("keydown", wake, { passive: false });

    loop();
  }

  function resize() {
    if (!cv) return;
    cv.width = global.innerWidth; cv.height = global.innerHeight;
  }

  /* ---- pixel drawing helper ---- */
  function px(x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

  function loop() {
    if (!active) { raf = null; return; }              // strictly-while-visible
    frame++;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function draw() {
    const W = cv.width, H = cv.height, U = 6;
    // night gradient
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0a0a18"); grad.addColorStop(0.6, "#10132a"); grad.addColorStop(1, "#161a2e");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    // a few twinkling stars (deterministic-ish by index)
    g.fillStyle = "#cfe";
    for (let i = 0; i < 60; i++) {
      const sx = (i * 97) % W, sy = (i * 53) % (H * 0.5);
      if ((frame + i * 7) % 140 < 90) { g.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin((frame + i) * 0.02)); g.fillRect(sx, sy, 2, 2); }
    }
    g.globalAlpha = 1;

    const cx = W / 2, groundY = H * 0.72;

    // glowing bamboo pipes flanking the fire
    drawBamboo(cx - 240, groundY, U);
    drawBamboo(cx + 220, groundY, U);

    // fire glow pool
    const glow = g.createRadialGradient(cx, groundY, 8, cx, groundY, 180);
    glow.addColorStop(0, "rgba(255,170,60,0.5)");
    glow.addColorStop(1, "rgba(255,140,40,0)");
    g.fillStyle = glow; g.beginPath(); g.arc(cx, groundY, 180, 0, Math.PI * 2); g.fill();

    // logs
    px(cx - 42, groundY + 8, 84, 10, "#5a3418");
    px(cx - 30, groundY + 16, 70, 8, "#48280f");

    // flame — layered flickering pixel columns
    const flick = Math.sin(frame * 0.3), flick2 = Math.sin(frame * 0.5 + 1);
    const flameCols = [
      { x: -18, h: 44 + flick * 8, c: "#c0341f" },
      { x: -6,  h: 66 + flick2 * 10, c: "#e2661f" },
      { x: 6,   h: 58 + flick * 12, c: "#ff9a2e" },
      { x: 18,  h: 40 + flick2 * 8, c: "#e2661f" }
    ];
    flameCols.forEach((f) => {
      px(cx + f.x - 5, groundY - f.h, 12, f.h, f.c);
    });
    // inner hot core
    px(cx - 6, groundY - (40 + flick * 6), 12, 40 + flick * 6, "#ffd24a");
    px(cx - 3, groundY - (24 + flick2 * 4), 6, 24, "#fff2b8");

    // spawn + update embers
    if (frame % 3 === 0) {
      embers.push({ x: cx + (Math.random() * 30 - 15), y: groundY - 40, vx: (Math.random() - 0.5) * 0.6,
        vy: -(1 + Math.random() * 1.6), life: 60 + Math.random() * 50, age: 0 });
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.age++; e.x += e.vx; e.y += e.vy; e.vy += 0.004; e.vx += (Math.random() - 0.5) * 0.05;
      if (e.age > e.life) { embers.splice(i, 1); continue; }
      const a = 1 - e.age / e.life;
      g.globalAlpha = a;
      g.fillStyle = a > 0.5 ? "#ffcf6a" : "#e2661f";
      g.fillRect(e.x, e.y, 3, 3);
    }
    g.globalAlpha = 1;

    // asleep Spud in a sleeping bag, to the fire's left
    drawSpud(cx - 130, groundY + 6, U);

    // floating Zzz
    const zt = Math.floor(frame / 22) % 3;
    g.fillStyle = "#bcd3ff"; g.font = "bold 20px monospace";
    for (let i = 0; i <= zt; i++) g.fillText("z", cx - 92 + i * 12, groundY - 24 - i * 14);
  }

  function drawBamboo(bx, by, U) {
    for (let s = 0; s < 5; s++) {
      const y = by - s * 30;
      px(bx, y - 28, 12, 28, "#2f6b3a");
      px(bx, y - 30, 12, 3, "#7fd77a");       // node ring
      // soft green glow
      g.globalAlpha = 0.25 + 0.15 * Math.sin(frame * 0.05 + s);
      px(bx - 2, y - 28, 16, 28, "#3ad06a");
      g.globalAlpha = 1;
    }
  }

  function drawSpud(sx, sy, U) {
    // sleeping bag
    px(sx - 6, sy - 6, 90, 30, "#3a4a7a");
    px(sx - 6, sy - 6, 90, 6, "#5a6cae");
    px(sx - 6, sy + 18, 90, 6, "#28345c");
    // potato head poking out
    px(sx + 62, sy - 14, 30, 24, "#c9954f");
    px(sx + 62, sy - 16, 30, 3, "#e2b878");
    px(sx + 88, sy - 12, 3, 18, "#a2712f");
    // closed sleepy eyes
    px(sx + 68, sy - 4, 6, 2, "#2b2620");
    px(sx + 80, sy - 4, 6, 2, "#2b2620");
    // little content mouth
    px(sx + 74, sy + 3, 6, 2, "#6b3f2a");
    // blush
    g.globalAlpha = 0.6; px(sx + 66, sy, 3, 3, "#df8a86"); px(sx + 86, sy, 3, 3, "#df8a86"); g.globalAlpha = 1;
  }

  /* ============================================================
     Wake -> the un-solvable Scrambled Pattern Lock
     ============================================================ */
  function wake(e) {
    if (!active) return;
    if (e) { try { e.preventDefault(); } catch (err) {} }
    const napped = performance.now() - startT;

    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    global.removeEventListener("resize", resize);
    global.removeEventListener("keydown", wake);
    stopAudio();
    if (overlay) { overlay.remove(); overlay = null; cv = null; g = null; }

    if (napped < NAP_MIN_MS) {
      grumble();
      try { if (global.Spud && Spud.say) Spud.say(NAP_LINES[Math.floor(Math.random() * NAP_LINES.length)]); } catch (err) {}
    }
    openPatternLock();
  }

  function openPatternLock() {
    const modal = document.createElement("div");
    modal.id = "ss-lock";
    modal.innerHTML =
      '<div class="ss-lock-card bevel-out">' +
        '<div class="ss-lock-head">🔒 DE-AUTHORIZATION · Draw your unlock pattern</div>' +
        '<canvas class="ss-lock-cv" width="260" height="260"></canvas>' +
        '<div class="ss-lock-msg">connect the lit nodes in order</div>' +
        '<div class="ss-lock-foot"><button class="btn primary ss-lock-give">Give up (recommended)</button></div>' +
      '</div>';
    (document.getElementById("screen") || document.body).appendChild(modal);

    const canvas = modal.querySelector(".ss-lock-cv");
    const lg = canvas.getContext("2d");
    const msg = modal.querySelector(".ss-lock-msg");
    const N = 3, PAD = 40, GAP = (260 - PAD * 2) / (N - 1);
    let nodes = [], target = [], drawn = [], dragging = false;

    function scramble() {
      // randomize node coordinates (jittered grid) AND target sequence
      nodes = [];
      for (let r = 0; r < N; r++) for (let cN = 0; cN < N; cN++) {
        nodes.push({ x: PAD + cN * GAP + (Math.random() * 24 - 12), y: PAD + r * GAP + (Math.random() * 24 - 12) });
      }
      target = [];
      const idx = nodes.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const len = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < len; i++) target.push(idx[i]);
      drawn = [];
      paint();
    }

    function paint(cursor) {
      lg.clearRect(0, 0, 260, 260);
      lg.fillStyle = "#12142a"; lg.fillRect(0, 0, 260, 260);
      // drawn path
      if (drawn.length) {
        lg.strokeStyle = "#7fd7c8"; lg.lineWidth = 4; lg.lineCap = "round"; lg.lineJoin = "round";
        lg.beginPath();
        drawn.forEach((ni, i) => { const p = nodes[ni]; i ? lg.lineTo(p.x, p.y) : lg.moveTo(p.x, p.y); });
        if (cursor) lg.lineTo(cursor.x, cursor.y);
        lg.stroke();
      }
      // nodes — target ones glow
      nodes.forEach((p, i) => {
        const lit = target.indexOf(i) >= 0;
        lg.beginPath(); lg.arc(p.x, p.y, 12, 0, Math.PI * 2);
        lg.fillStyle = drawn.indexOf(i) >= 0 ? "#7fd7c8" : (lit ? "#3a4e6a" : "#20242e");
        lg.fill();
        lg.beginPath(); lg.arc(p.x, p.y, 5, 0, Math.PI * 2);
        lg.fillStyle = lit ? "#ffcf6a" : "#4a4f5e"; lg.fill();
        if (lit) { lg.strokeStyle = "rgba(255,207,106,.5)"; lg.lineWidth = 2; lg.beginPath(); lg.arc(p.x, p.y, 12, 0, Math.PI * 2); lg.stroke(); }
      });
    }

    function nodeAt(x, y) {
      for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - x, nodes[i].y - y) < 18) return i;
      return -1;
    }
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (260 / r.width), y: (e.clientY - r.top) * (260 / r.height) };
    }

    // input isolated to THIS canvas only — never touches global OS input
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true; drawn = [];
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      const p = pos(e); const ni = nodeAt(p.x, p.y);
      if (ni >= 0) { drawn.push(ni); try { Sound && Sound.tick && Sound.tick(); } catch (err) {} }
      paint(p);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const p = pos(e); const ni = nodeAt(p.x, p.y);
      if (ni >= 0 && drawn.indexOf(ni) < 0) { drawn.push(ni); try { Sound && Sound.blip && Sound.blip(360 + drawn.length * 60); } catch (err) {} }
      paint(p);
    });
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      // every attempt reshuffles — the pattern can never be completed
      if (drawn.length >= 2) {
        try { Sound && Sound.error && Sound.error(); } catch (err) {}
        msg.textContent = "[SECURITY] Sleep analysis detected binary dreaming. Pattern sequence randomized for safety.";
        msg.className = "ss-lock-msg bad";
        scramble();
      } else {
        drawn = []; paint();
      }
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    // the only real way out
    modal.querySelector(".ss-lock-give").onclick = () => {
      try { Sound && Sound.close && Sound.close(); } catch (err) {}
      modal.remove();
      lastReset = 0; resetIdle();
    };

    scramble();
  }

  /* ---- boot: start monitoring once the desktop is up ---- */
  function boot() {
    const desktop = document.getElementById("desktop");
    if (!desktop) { setTimeout(boot, 300); return; }
    armMonitors();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.Screensaver = { activate, wake: () => wake(null), stop: () => { if (active) wake(null); } };
})(window);
