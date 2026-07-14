/* ============================================================
   Presence — CaptchaOS listens for you.

   The cozy music follows your mouse: move and it plays, go still
   for 3s and it fades into a muffled hush. CaptchaOS quietly counts
   every second of that silence, and once 5 minutes have piled up it
   stops trusting that a human is still in the chair — so it pops an
   "Audio Activity Check": prove you're alive, and the music comes back.
   ============================================================ */
(function (global) {
  const now = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---- tuning (query-overridable for testing) ---- */
  let MOVE_IDLE_MS   = 3000;          // stillness before the music fades
  let IDLE_BUDGET_MS = 5 * 60 * 1000; // accumulated silence before a check
  const POLL_MS = 200;

  /* ---- state ---- */
  let lastMove = now();
  let idleAccum = 0;
  let musicOn = true;                 // matches ambientStart()'s full level
  let checkOpen = false;
  let energy = 0;                     // 0..1 smoothed motion energy (drives the meter)
  let lastPt = null, lastPtT = 0;
  let lastPoll = now();
  let started = false;

  /* ---- motion energy: feeds the liveliness meter ---- */
  function feedMove(x, y) {
    const t = now();
    lastMove = t;
    if (lastPt) {
      const dt = Math.max(16, t - lastPtT);
      const d = Math.hypot(x - lastPt[0], y - lastPt[1]);
      const target = clamp((d / dt) / 1.6, 0, 1);   // ~1.6 px/ms saturates
      energy += (target - energy) * 0.4;
    }
    lastPt = [x, y]; lastPtT = t;
  }
  function onMove(e) { feedMove(e.clientX, e.clientY); }
  function bump(v) { energy = clamp(energy + v, 0, 1); }
  function decay() { energy *= 0.86; if (energy < 0.001) energy = 0; }

  /* ---- the idle heartbeat ---- */
  function poll() {
    const t = now();
    const dt = t - lastPoll; lastPoll = t;
    decay();
    if (checkOpen) return;                       // the check drives its own loop
    const still = t - lastMove;
    if (still >= MOVE_IDLE_MS) {
      if (musicOn) { musicOn = false; try { Sound.presence(false, 2.4); } catch (e) {} }
      idleAccum += dt;                            // count only the silent seconds
      if (idleAccum >= IDLE_BUDGET_MS) { idleAccum = 0; openCheck(); }
    } else if (!musicOn) {
      musicOn = true; try { Sound.presence(true, 1.3); } catch (e) {}
    }
  }

  function start(opts) {
    if (started) return; started = true;
    opts = opts || {};
    const q = (global.location && global.location.search) || "";
    if (opts.fast || /[?&]idle=fast/.test(q)) { MOVE_IDLE_MS = 1500; IDLE_BUDGET_MS = 20000; }
    lastMove = lastPoll = now(); musicOn = true;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    setInterval(poll, POLL_MS);
    if (opts.immediate || /[?&]audiocheck/.test(q)) setTimeout(openCheck, 500);
  }

  /* ============================================================
     The Audio Activity Check window
     ============================================================ */
  const SUS = [
    "No movement detected. Suspicious.",
    "Stillness is not proof of life.",
    "We heard silence. We do not trust silence.",
    "Presence unconfirmed. The room is too quiet.",
    "Still there? The cursor says otherwise."
  ];

  function centroid(pts) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p[0]; sy += p[1]; }
    return [sx / pts.length, sy / pts.length];
  }

  function openCheck() {
    if (checkOpen) return;
    checkOpen = true;
    try { Sound.presence(false, 1.2); } catch (e) {}   // hold the music silent
    try { Sound.eerie(); } catch (e) {}

    const host = document.createElement("div");
    host.className = "aac";
    host.innerHTML =
      '<div class="aac-scope">' +
        '<div class="aac-bars"></div>' +
        '<div class="aac-read"><span class="lab">PRESENCE</span>' +
        '<span class="aac-score">00</span></div>' +
        '<div class="aac-peak">peak 0</div>' +
      '</div>' +
      '<div class="aac-task">' +
        '<div class="aac-eyebrow">CHECK 1 / 3</div>' +
        '<div class="aac-instru">Confirm a human is present</div>' +
        '<div class="aac-stage"></div>' +
        '<div class="aac-status">Awaiting a sign of life…</div>' +
      '</div>';

    const win = WM.open({
      title: "Audio Activity Check", icon: "🎧", width: 384,
      content: host, resizable: false, buttons: false, silent: true,
      className: "appwin aac-win"
    });

    const barsEl   = host.querySelector(".aac-bars");
    const scoreEl  = host.querySelector(".aac-score");
    const peakEl   = host.querySelector(".aac-peak");
    const eyebrow  = host.querySelector(".aac-eyebrow");
    const instru   = host.querySelector(".aac-instru");
    const stage    = host.querySelector(".aac-stage");
    const status   = host.querySelector(".aac-status");

    const NBARS = 18, bars = [];
    for (let i = 0; i < NBARS; i++) {
      const b = document.createElement("i");
      barsEl.appendChild(b); bars.push(b);
    }

    /* --- the live PRESENCE scope + liveliness score --- */
    let peak = 0, raf = 0;
    function scope() {
      if (!checkOpen) return;
      decay();
      const lvl = energy;
      const mid = (NBARS - 1) / 2;
      for (let i = 0; i < NBARS; i++) {
        const edge = Math.abs(i - mid) / mid;                    // 0 centre .. 1 edge
        const h = 5 + lvl * 46 * (1 - edge * 0.5) * (0.55 + Math.random() * 0.7);
        bars[i].style.height = h.toFixed(1) + "px";
      }
      const score = Math.round(clamp(lvl * 112, 0, 100));
      peak = Math.max(peak * 0.996, score);
      scoreEl.textContent = String(score).padStart(2, "0");
      scoreEl.style.color = score > 66 ? "#8fe0a0" : score > 33 ? "#ffd591" : "#e0657f";
      peakEl.textContent = "peak " + Math.round(peak);
      raf = requestAnimationFrame(scope);
    }
    raf = requestAnimationFrame(scope);

    /* --- eerie watchdog: nag when the user stalls mid-task --- */
    function mkWatch() {
      let timer = null, si = 0;
      function arm() {
        clearTimeout(timer);
        timer = setTimeout(() => {
          status.textContent = SUS[si++ % SUS.length];
          status.className = "aac-status bad";
          try { Sound.bad(); } catch (e) {}
          arm();
        }, 3500);
      }
      arm();
      return { kick() { arm(); }, stop() { clearTimeout(timer); } };
    }

    /* --- task 1: trace a smooth circle --- */
    function circleTask(done) {
      instru.textContent = "Move your cursor in a smooth circle";
      stage.innerHTML =
        '<div class="aac-demo circle"><div class="guide"></div>' +
        '<div class="prog" style="--p:0"></div>' +
        '<div class="orbit"><div class="dot"></div></div></div>' +
        '<div class="aac-hint">Trace the ring. Keep it round.</div>';
      const prog = stage.querySelector(".prog");
      const w = mkWatch();
      let pts = [], swept = 0, lastAng = null;
      function onp(e) {
        w.kick(); bump(0.12);
        const x = e.clientX, y = e.clientY;
        pts.push([x, y]); if (pts.length > 44) pts.shift();
        if (pts.length < 6) return;
        const c = centroid(pts);
        const ang = Math.atan2(y - c[1], x - c[0]);
        if (lastAng != null) {
          let d = ang - lastAng;
          while (d >  Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          swept += d;
        }
        lastAng = ang;
        const deg = clamp(Math.abs(swept) * 180 / Math.PI, 0, 360);
        prog.style.setProperty("--p", (deg / 3.6).toFixed(1));
        status.textContent = "Sweep " + Math.round(deg) + "° / 360°";
        status.className = "aac-status";
        if (deg >= 340) { cleanup(); done(); }
      }
      function cleanup() { window.removeEventListener("pointermove", onp); w.stop(); }
      window.addEventListener("pointermove", onp, { passive: true });
    }

    /* --- task 2: wiggle back and forth --- */
    function wiggleTask(done) {
      instru.textContent = "Wiggle the mouse to prove presence";
      stage.innerHTML =
        '<div class="aac-demo wiggle"><div class="cur">🖱️</div></div>' +
        '<div class="aac-fill"><i></i></div>' +
        '<div class="aac-hint">Shake left and right — quickly.</div>';
      const fill = stage.querySelector(".aac-fill > i");
      const w = mkWatch();
      const need = 10; let lastX = null, dir = 0, reversals = 0;
      function onp(e) {
        w.kick();
        const x = e.clientX;
        if (lastX != null) {
          const dx = x - lastX;
          bump(Math.min(0.4, Math.abs(dx) / 60));
          const nd = dx > 2 ? 1 : dx < -2 ? -1 : dir;
          if (nd !== 0 && nd !== dir) { dir = nd; reversals++; }
        }
        lastX = x;
        const p = clamp(reversals / need * 100, 0, 100);
        fill.style.width = p + "%";
        status.textContent = "Presence " + Math.round(p) + "%";
        status.className = "aac-status";
        if (reversals >= need) { cleanup(); done(); }
      }
      function cleanup() { window.removeEventListener("pointermove", onp); w.stop(); }
      window.addEventListener("pointermove", onp, { passive: true });
    }

    /* --- task 3: click on the (near-invisible) beat --- */
    function rhythmTask(done) {
      instru.textContent = "Click in rhythm with invisible beats";
      stage.innerHTML =
        '<div class="aac-demo rhythm"><div class="aac-beat"><span>TAP</span>' +
        '<div class="pulse"></div></div></div>' +
        '<div class="aac-hint">Click the moment each pulse blooms.</div>';
      const demo = stage.querySelector(".aac-demo.rhythm");
      const beat = stage.querySelector(".aac-beat");
      const w = mkWatch();
      const period = 600, need = 5, tol = 140;   // 100 BPM, generous window
      let hits = 0, startT = now();
      const beatTimer = setInterval(() => {
        beat.classList.remove("hit"); void beat.offsetWidth; beat.classList.add("hit");
        try { Sound.beat(); } catch (e) {}
      }, period);
      function offset() {
        const phase = (now() - startT) % period;
        return Math.min(phase, period - phase);
      }
      demo.addEventListener("click", (e) => {
        e.stopPropagation(); w.kick(); bump(0.5);
        const off = offset(), good = off < tol;
        if (good) { hits++; try { Sound.good(); } catch (e2) {} }
        else { hits = Math.max(0, hits - 1); try { Sound.bad(); } catch (e2) {} }
        status.textContent = good
          ? "On beat (" + Math.round(off) + "ms) · " + hits + "/" + need
          : "Off beat (" + Math.round(off) + "ms)";
        status.className = "aac-status" + (good ? "" : " bad");
        if (hits >= need) { cleanup(); done(); }
      });
      function cleanup() { clearInterval(beatTimer); w.stop(); }
    }

    /* --- task runner --- */
    const TASKS = [circleTask, wiggleTask, rhythmTask];
    let ti = 0;
    function runTask() {
      if (ti >= TASKS.length) return finish();
      eyebrow.textContent = "CHECK " + (ti + 1) + " / " + TASKS.length;
      TASKS[ti](() => {
        status.textContent = "Signal accepted.";
        status.className = "aac-status ok";
        try { Sound.good(); } catch (e) {}
        ti++;
        setTimeout(runTask, 750);
      });
    }
    function finish() {
      cancelAnimationFrame(raf);
      checkOpen = false;
      lastMove = now(); idleAccum = 0; musicOn = true;
      try { Sound.levelup(); } catch (e) {}
      try { Sound.presence(true, 1.8); } catch (e) {}   // the cozy music returns
      eyebrow.textContent = "VERIFIED";
      instru.textContent = "Presence confirmed. Welcome back.";
      status.textContent = "Audio restored.";
      status.className = "aac-status ok";
      stage.innerHTML = '<div class="aac-done">✓</div>';
      setTimeout(() => { try { win.close(); } catch (e) {} }, 1500);
    }
    runTask();
  }

  global.Presence = { start, check: openCheck };
})(window);
