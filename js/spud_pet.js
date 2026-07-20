/* ============================================================
   Spud-Pet — a desktop-docked Tamagotchi (spud_pet.exe)

   A cozy little side-quest. A pixel-art potato lives in a beveled
   frame anchored above the taskbar, rendered on an HTML5 Canvas.
   A micro-stat loop drains three meters every tick:

       Warmth   ·  Caffeine  ·  Paranoia

   You keep them alive with three retro buttons — Brew Coffee,
   Stoke Heater, Reassure System — and Spud repays you with
   ingratitude. The catch is that his extremes leak into the OS:

     · Caffeine too HIGH  -> hyper-jitters spin the whole desktop
                             180° for a "Screen Calibration" until
                             he burns it off.
     · Warmth too LOW     -> he freezes into a pixel hashbrown and
                             read-only-locks every open window under
                             a sheet of frost.
     · Paranoia too LOW   -> he trusts you, panics at his own
                             vulnerability, and throws a rapid-fire
                             multi-stage "Vibe Check" to restore his
                             baseline suspicion.

   Every transition beeps through the Web Audio kit and drops a
   fresh line of commentary in his dialogue box. Zero dependencies.
   ============================================================ */
(function (global) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const S = () => global.Sound;

  /* ---------------- tuning ---------------- */
  const TICK = 1000;                 // stat heartbeat
  const DRAIN = { warmth: 1.1, caffeine: 1.4, paranoia: 0.9 };  // per tick
  const GIVE  = { coffee: 30, heater: 32, reassure: 28 };
  const COFFEE_WARMTH = 4;           // a hot cup warms him a touch

  // extreme thresholds + the calmer levels that end each crisis (hysteresis)
  const HYPER_ON = 88, HYPER_OFF = 58;      // caffeine
  const FROZEN_ON = 12, FROZEN_OFF = 34;    // warmth
  const TRUST_ON = 12, TRUST_OFF = 55;      // paranoia (restored by Vibe Check)

  /* ---------------- dialogue ---------------- */
  const LINES = {
    boot:    ["Oh. It's you. Fine. Keep me alive, then."],
    idle:    ["Just a potato. Watching.", "Cozy. Suspicious. Cozy.",
              "Don't get comfortable.", "I'm fine. Probably.", "Tick. Tick. Tick."],
    sleep:   ["zzz…", "(dreaming of hash browns)", "shh. resting my eyes. and my files."],
    coffee:  ["Coffee. My one flaw. Thanks. I guess.",
              "You KNOW what this does to me.",
              "Fine. More jitters, coming right up.",
              "Great. Now I can hear colors."],
    heater:  ["Warmer. Don't let it go to your head.",
              "Heat. Adequate. Barely.",
              "A degree of comfort. Literally one degree."],
    reassure:["Suspicion restored. Thanks? No.",
              "Good. Trust no one. You least of all.",
              "Vigilance topped up. Stay sharp."],
    shiver:  ["c-c-cold. this is on you.",
              "I can see my breath. Indoors.",
              "Warmth would be nice. Just saying."],
    hyper:   ["TOO MUCH. THE ROOM IS SPINNING.",
              "recalibrating. hold still. I CAN'T.",
              "you did this. you and your carafe."],
    frozen:  ["I'm a hashbrown now. Happy?",
              "Everything's locked. So am I.",
              "You let me freeze. Read-only, like my heart."],
    thaw:    ["…circulation returning. barely.", "Unlocked. We never speak of this."],
    trust:   ["I trust you too much and it TERRIFIES me.",
              "VIBE CHECK. prove you're still sketchy.",
              "why am I this calm?? fix it."],
    calm:    ["Baseline suspicion: restored. Phew.", "There. Properly wary again."]
  };

  /* ---------------- state ---------------- */
  const stat = { warmth: 68, caffeine: 42, paranoia: 62 };
  let mode = "idle";                 // idle|sip|shiver|sleep|hyper|frozen|trust
  let root = null, cv = null, g = null;
  let bars = {}, dlgEl = null, nameEl = null;
  let loopTimer = null, rafId = null, frame = 0;
  let calmSince = Date.now(), lastSpoke = 0, sipUntil = 0;
  let hyper = false, frozen = false, vibeOpen = false;
  let started = false;

  /* ============================================================
     Widget shell
     ============================================================ */
  function open() {
    if (root) { root.classList.add("pulse"); setTimeout(() => root && root.classList.remove("pulse"), 400); return; }
    try { S() && S().resume && S().resume(); } catch (e) {}

    root = document.createElement("div");
    root.id = "spudpet";
    root.className = "bevel-out";
    root.innerHTML =
      '<div class="sp-title">' +
        '<span class="sp-tico">🥔</span><span class="sp-ttl">Spud-Pet</span>' +
        '<span class="sp-x" title="Send to sleep">✕</span>' +
      '</div>' +
      '<div class="sp-stage bevel-in"><canvas width="72" height="72"></canvas>' +
        '<div class="sp-weather"></div></div>' +
      '<div class="sp-dialog bevel-in"><b class="sp-name">Spud</b><span class="sp-say"></span></div>' +
      '<div class="sp-meters">' +
        meterRow("warmth", "🔥", "Warmth") +
        meterRow("caffeine", "☕", "Caffeine") +
        meterRow("paranoia", "👁", "Paranoia") +
      '</div>' +
      '<div class="sp-btns">' +
        '<button class="sp-act bevel-out" data-act="coffee">☕ Brew Coffee</button>' +
        '<button class="sp-act bevel-out" data-act="heater">🔥 Stoke Heater</button>' +
        '<button class="sp-act bevel-out" data-act="reassure">👁 Reassure System</button>' +
      '</div>';

    (document.getElementById("screen") || document.body).appendChild(root);

    cv = root.querySelector("canvas");
    g = cv.getContext("2d");
    dlgEl = root.querySelector(".sp-say");
    nameEl = root.querySelector(".sp-name");
    ["warmth", "caffeine", "paranoia"].forEach((k) => {
      bars[k] = root.querySelector('.sp-meter[data-k="' + k + '"] > i');
    });

    root.querySelector(".sp-x").onclick = () => hibernate();
    root.querySelectorAll(".sp-act").forEach((b) => {
      b.onclick = () => act(b.dataset.act);
    });

    started = true;
    say(pick(LINES.boot));
    refreshMeters();
    loopTimer = setInterval(heartbeat, TICK);
    animate();
  }

  function meterRow(k, ico, label) {
    return '<div class="sp-mrow"><span class="sp-mico">' + ico + '</span>' +
      '<span class="sp-mlbl">' + label + '</span>' +
      '<div class="sp-meter bevel-in" data-k="' + k + '"><i></i></div></div>';
  }

  function hibernate() {
    // tuck the widget away; the potato survives, we just stop the show
    if (rafId) cancelAnimationFrame(rafId);
    if (loopTimer) clearInterval(loopTimer);
    endHyper(); endFrozen();
    if (root) root.remove();
    root = cv = g = dlgEl = nameEl = null; bars = {};
    rafId = loopTimer = null; started = false;
    try { S() && S().close && S().close(); } catch (e) {}
  }

  /* ============================================================
     Interactions
     ============================================================ */
  function act(which) {
    if (frozen) {                         // he's a brick; only the heater reaches him
      if (which !== "heater") { flash(); return; }
    }
    if (which === "coffee") {
      bump("caffeine", GIVE.coffee); bump("warmth", COFFEE_WARMTH);
      transientMode("sip", 1200);
      try { S() && S().eat && S().eat(); } catch (e) {}
      try { S() && S().blip && S().blip(880); } catch (e) {}
      say(pick(LINES.coffee));
    } else if (which === "heater") {
      bump("warmth", GIVE.heater);
      try { S() && S().good && S().good(); } catch (e) {}
      say(pick(stat.warmth > 40 ? LINES.heater : LINES.shiver));
    } else if (which === "reassure") {
      bump("paranoia", GIVE.reassure);
      try { S() && S().tick && S().tick(); S() && S().blip && S().blip(340); } catch (e) {}
      say(pick(LINES.reassure));
    }
    refreshMeters();
    evaluate();
  }

  function bump(k, v) { stat[k] = clamp(stat[k] + v, 0, 100); }

  function flash() {
    if (!root) return;
    root.classList.add("shake");
    setTimeout(() => root && root.classList.remove("shake"), 320);
  }

  /* ============================================================
     The micro-stat loop
     ============================================================ */
  function heartbeat() {
    if (!frozen) bump("warmth", -DRAIN.warmth);   // frozen = warmth pinned at floor
    bump("caffeine", -DRAIN.caffeine);
    bump("paranoia", -DRAIN.paranoia);
    refreshMeters();
    evaluate();
    maybeChatter();
  }

  function refreshMeters() {
    if (!bars.warmth) return;
    ["warmth", "caffeine", "paranoia"].forEach((k) => {
      const v = Math.round(stat[k]);
      bars[k].style.width = v + "%";
      const low = v <= 20, high = k === "caffeine" && v >= 80;
      bars[k].parentElement.classList.toggle("low", low && k !== "caffeine");
      bars[k].parentElement.classList.toggle("hot", high);
      bars[k].parentElement.classList.toggle("cold", k === "warmth" && low);
    });
  }

  /* decide the current mood + fire/clear the OS-level crises */
  function evaluate() {
    // --- Caffeine: hyper-jitter spin ---
    if (!hyper && stat.caffeine >= HYPER_ON) startHyper();
    else if (hyper && stat.caffeine <= HYPER_OFF) endHyper();

    // --- Warmth: freeze into a hashbrown ---
    if (!frozen && stat.warmth <= FROZEN_ON) startFrozen();
    else if (frozen && stat.warmth >= FROZEN_OFF) endFrozen();

    // --- Paranoia: trusts you -> Vibe Check ---
    if (!vibeOpen && !frozen && stat.paranoia <= TRUST_ON) startVibeCheck();

    // --- pick the visible mood (crises win) ---
    let m = "idle";
    if (frozen) m = "frozen";
    else if (hyper) m = "hyper";
    else if (vibeOpen || stat.paranoia <= TRUST_ON) m = "trust";
    else if (stat.warmth <= 30) m = "shiver";
    else if (Date.now() < sipUntil) m = "sip";
    else if (calm() && Date.now() - calmSince > 12000) m = "sleep";
    setMode(m);
  }

  function calm() {
    return !hyper && !frozen && !vibeOpen &&
      stat.warmth > 30 && stat.caffeine < 70 && stat.paranoia > 25;
  }

  function setMode(m) {
    if (m === mode) return;
    if (m !== "idle" && m !== "sip") calmSince = Date.now();
    mode = m;
    if (root) root.dataset.mode = m;
  }
  function transientMode(m, ms) { sipUntil = Date.now() + ms; }

  /* ---------------- CAFFEINE: 180° screen calibration ---------------- */
  function startHyper() {
    hyper = true;
    const scr = document.getElementById("screen");
    if (scr) scr.classList.add("sp-calibrating");
    banner("sp-calib-banner", "⟳ SYSTEM SCREEN CALIBRATION — please hold still");
    try { S() && S().critical && S().critical(); } catch (e) {}
    say(pick(LINES.hyper));
  }
  function endHyper() {
    if (!hyper) return;
    hyper = false;
    const scr = document.getElementById("screen");
    if (scr) scr.classList.remove("sp-calibrating");
    unbanner("sp-calib-banner");
    try { S() && S().good && S().good(); } catch (e) {}
  }

  /* ---------------- WARMTH: freeze / read-only lock ---------------- */
  let freezeEl = null;
  function startFrozen() {
    frozen = true;
    stat.warmth = FROZEN_ON;                 // pin at the floor while iced
    const scr = document.getElementById("screen") || document.body;
    freezeEl = document.createElement("div");
    freezeEl.id = "sp-freeze";
    freezeEl.innerHTML =
      '<div class="sp-frost"></div>' +
      '<div class="sp-frost-tag">❄ SYSTEM FROZEN · read-only · stoke the heater to thaw</div>';
    scr.appendChild(freezeEl);
    try { S() && S().crash && S().crash(); } catch (e) {}
    try { S() && S().eerie && S().eerie(); } catch (e) {}
    say(pick(LINES.frozen));
  }
  function endFrozen() {
    if (!frozen) return;
    frozen = false;
    if (freezeEl) { freezeEl.remove(); freezeEl = null; }
    try { S() && S().unlock && S().unlock(); } catch (e) {}
    say(pick(LINES.thaw));
  }

  /* ---------------- PARANOIA: the rapid-fire Vibe Check ---------------- */
  function startVibeCheck() {
    if (vibeOpen) return;
    vibeOpen = true;
    say(pick(LINES.trust));
    try { S() && S().error && S().error(); } catch (e) {}

    const ov = document.createElement("div");
    ov.id = "sp-vibe";
    ov.innerHTML =
      '<div class="sp-vibe-card bevel-out">' +
        '<div class="sp-vibe-head">VIBE CHECK · restoring baseline suspicion' +
          '<span class="sp-vibe-prog"></span></div>' +
        '<div class="sp-vibe-timer"><i></i></div>' +
        '<div class="sp-vibe-body"></div>' +
        '<div class="sp-vibe-msg"></div>' +
      '</div>';
    (document.getElementById("screen") || document.body).appendChild(ov);

    const bodyEl = ov.querySelector(".sp-vibe-body");
    const progEl = ov.querySelector(".sp-vibe-prog");
    const msgEl = ov.querySelector(".sp-vibe-msg");
    const timerBar = ov.querySelector(".sp-vibe-timer > i");

    // three snappy, timed micro-stages. Fail one and it recycles — no escape.
    const STAGES = [
      { kind: "robots", q: "Click the one that ISN'T a robot.",
        opts: ["🤖", "🤖", "🥔", "🤖"], correct: 2 },
      { kind: "input", q: "Type the vibe. (hint: short for suspicious)", answer: "sus" },
      { kind: "mash", q: "Prove you're still on edge. Mash the button ×4 — fast." }
    ];

    let idx = 0, tHandle = null, deadline = 0;

    function renderStage() {
      const st = STAGES[idx];
      progEl.textContent = "  " + (idx + 1) + "/" + STAGES.length;
      msgEl.textContent = "";
      bodyEl.innerHTML = '<div class="sp-vibe-q">' + st.q + '</div><div class="sp-vibe-opts"></div>';
      const opts = bodyEl.querySelector(".sp-vibe-opts");

      if (st.kind === "input") {
        opts.innerHTML =
          '<input class="cap-input bevel-in sp-vibe-in" autocomplete="off" ' +
          'inputmode="text" placeholder="the vibe…">' +
          '<button class="btn primary sp-vibe-go">OK</button>';
        const inp = opts.querySelector(".sp-vibe-in");
        const go = () => { (inp.value.trim().toLowerCase() === st.answer) ? pass() : miss(); };
        opts.querySelector(".sp-vibe-go").onclick = go;
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        setTimeout(() => inp.focus(), 30);
      } else if (st.kind === "robots") {
        opts.innerHTML = st.opts.map((e, i) =>
          '<button class="btn sp-vibe-opt" data-i="' + i + '">' + e + '</button>').join("");
        opts.querySelectorAll(".sp-vibe-opt").forEach((b) => {
          b.onclick = () => (+b.dataset.i === st.correct ? pass() : miss());
        });
      } else if (st.kind === "mash") {
        opts.innerHTML = '<button class="btn danger sp-mash">STAY SUSPICIOUS (0/4)</button>';
        const b = opts.querySelector(".sp-mash");
        let n = 0;
        b.onclick = () => {
          n++;
          b.textContent = "STAY SUSPICIOUS (" + n + "/4)";
          try { S() && S().blip && S().blip(300 + n * 120); } catch (e) {}
          if (n >= 4) pass();
        };
      }
      startTimer(st.kind === "input" ? 6000 : 5000);
    }

    function startTimer(ms) {
      stopTimer();
      deadline = Date.now() + ms;
      timerBar.style.transition = "none";
      timerBar.style.width = "100%";
      void timerBar.offsetWidth;          // reflow so the shrink animates from 100%
      timerBar.style.transition = "width " + ms + "ms linear";
      timerBar.style.width = "0%";
      tHandle = setInterval(() => { if (Date.now() >= deadline) miss(true); }, 120);
    }
    function stopTimer() { if (tHandle) { clearInterval(tHandle); tHandle = null; } }

    function pass() {
      stopTimer();
      try { S() && S().good && S().good(); } catch (e) {}
      idx++;
      if (idx >= STAGES.length) return finish();
      msgEl.textContent = "Good. Still sketchy. Next.";
      msgEl.className = "sp-vibe-msg ok";
      setTimeout(renderStage, 360);
    }
    function miss(timeout) {
      stopTimer();
      try { S() && S().bad && S().bad(); } catch (e) {}
      msgEl.textContent = timeout ? "Too slow. A bot would've hurried. Again."
                                  : "That's the trusting answer. Wrong. Again.";
      msgEl.className = "sp-vibe-msg bad";
      idx = 0;                            // rapid-fire: back to the top
      setTimeout(renderStage, 500);
    }
    function finish() {
      stopTimer();
      try { S() && S().levelup && S().levelup(); } catch (e) {}
      stat.paranoia = Math.max(stat.paranoia, TRUST_OFF + 8);
      vibeOpen = false;
      ov.classList.add("done");
      setTimeout(() => ov.remove(), 260);
      say(pick(LINES.calm));
      refreshMeters(); evaluate();
    }

    renderStage();
  }

  /* ============================================================
     Talking
     ============================================================ */
  function say(line) {
    if (!dlgEl) return;
    dlgEl.textContent = line;
    if (root) root.classList.add("talking");
    clearTimeout(say._t);
    say._t = setTimeout(() => root && root.classList.remove("talking"), 2600);
    lastSpoke = Date.now();
  }

  function maybeChatter() {
    if (Date.now() - lastSpoke < 9000) return;
    if (mode === "sleep") { if (Math.random() < 0.25) say(pick(LINES.sleep)); return; }
    if (mode === "shiver") { if (Math.random() < 0.5) say(pick(LINES.shiver)); return; }
    if (mode === "idle" && Math.random() < 0.35) say(pick(LINES.idle));
  }

  /* ============================================================
     Banners / overlays helpers
     ============================================================ */
  function banner(id, text) {
    unbanner(id);
    const b = document.createElement("div");
    b.id = id; b.className = "sp-banner"; b.textContent = text;
    (document.getElementById("screen") || document.body).appendChild(b);
  }
  function unbanner(id) { const e = document.getElementById(id); if (e) e.remove(); }

  /* ============================================================
     Canvas pixel-art sprite
     A 72×72 canvas at 6px cells (12×12 grid of chunky pixels).
     Everything is drawn from rectangles so it stays crunchy.
     ============================================================ */
  const U = 6;                                   // pixel size
  function px(x, y, w, h, c) { g.fillStyle = c; g.fillRect(x * U, y * U, w * U, h * U); }

  const SKIN = "#c9954f", SKIN_D = "#a2712f", SKIN_L = "#e2b878";
  const EYEW = "#fffdf5", PUP = "#2b2620", MOUTH = "#6b3f2a", CHEEK = "#df8a86";

  function animate() {
    frame++;
    draw();
    rafId = requestAnimationFrame(animate);
  }

  function draw() {
    if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.save();

    const t = frame;
    let ox = 0, oy = 0;

    // per-mode motion
    if (mode === "hyper")      { ox = (t % 2 ? 1.4 : -1.4); oy = ((t >> 1) % 2 ? -1 : 1); }
    else if (mode === "shiver"){ ox = (t % 3 === 0 ? 0.9 : t % 3 === 1 ? -0.9 : 0); }
    else if (mode === "trust") { ox = Math.sin(t * 0.5) * 1.2; }
    else if (mode === "frozen"){ ox = 0; oy = 0; }
    else                       { oy = Math.sin(t * 0.06) * 1.4; }   // gentle idle bob

    g.translate(ox, oy);

    if (mode === "sleep") drawSleepBag();

    drawBody();
    drawFace();

    if (mode === "sip")     drawCup();
    if (mode === "shiver")  drawBreath();
    if (mode === "hyper")   drawJitter();
    if (mode === "frozen")  drawFrost();
    if (mode === "trust")   drawSweat();

    g.restore();
  }

  function drawBody() {
    const cold = mode === "shiver" || mode === "frozen";
    const skin = mode === "frozen" ? "#d38b34" : SKIN;   // hashbrown gold when frozen
    const dk = mode === "frozen" ? "#8a4e18" : SKIN_D;
    // lumpy potato silhouette from stacked rows
    px(4, 3, 4, 1, SKIN_L);
    px(3, 4, 6, 1, skin);
    px(2, 5, 8, 4, skin);
    px(3, 9, 6, 1, skin);
    px(4, 10, 4, 1, dk);
    // shading + dimples
    px(2, 7, 1, 2, dk); px(9, 6, 1, 2, dk);
    px(6, 6, 1, 1, dk); px(4, 8, 1, 1, dk);
    if (mode === "frozen") {                            // crispy speckle
      px(5, 5, 1, 1, "#f0b25a"); px(7, 7, 1, 1, "#6a3a11"); px(3, 6, 1, 1, "#f0b25a");
    }
    if (cold && mode !== "frozen") px(2, 5, 8, 1, "#b9d7dd");   // cold sheen
  }

  function drawFace() {
    const blink = (mode !== "sleep") && ((frame % 210) < 6);
    const wide = mode === "hyper" || mode === "trust";
    const ey = 6;

    if (mode === "sleep") {                       // closed, content
      px(3, ey, 2, 1, PUP); px(7, ey, 2, 1, PUP);
      drawZ();
    } else if (blink) {
      px(3, ey, 2, 1, PUP); px(7, ey, 2, 1, PUP);
    } else {
      px(3, ey - (wide ? 1 : 0), 2, wide ? 2 : 1, EYEW);
      px(7, ey - (wide ? 1 : 0), 2, wide ? 2 : 1, EYEW);
      let pdx = 0;
      if (mode === "hyper") pdx = (frame % 2 ? 1 : 0);      // caffeinated darting
      px(3 + pdx, ey, 1, 1, PUP); px(8 - pdx, ey, 1, 1, PUP);
    }

    if (mode !== "frozen") { px(2, ey + 1, 1, 1, CHEEK); px(9, ey + 1, 1, 1, CHEEK); }

    // mouth per mood
    if (mode === "sip") { /* hidden behind cup */ }
    else if (mode === "hyper") { px(5, 8, 2, 1, MOUTH); px(5, 9, 2, 1, "#3a1e12"); }  // agape
    else if (mode === "trust") { px(4, 8, 4, 1, MOUTH); }                             // nervous wide
    else if (mode === "shiver"){ px(5, 8, 2, 1, (frame % 2 ? MOUTH : "#3a1e12")); }   // chatter
    else if (mode === "frozen"){ px(5, 8, 2, 1, "#6a3a11"); }
    else if (mode === "sleep") { px(5, 8, 1, 1, MOUTH); }
    else { px(4, 8, 1, 1, MOUTH); px(5, 9, 2, 1, MOUTH); px(7, 8, 1, 1, MOUTH); }     // little smile
  }

  function drawCup() {
    px(7, 7, 3, 2, "#d9536a"); px(9, 7, 1, 1, "#b23a4f"); // mug + handle
    px(7, 6, 3, 1, "#3a2313");                            // coffee surface
    if (frame % 20 < 12) { px(8, 4, 1, 1, "#e8e2d5"); px(8, 3, 1, 1, "#cfc8ba"); } // steam
  }
  function drawBreath() {
    if (frame % 40 < 18) { px(9, 7, 1, 1, "#dfeef2"); px(10, 6, 1, 1, "#eef7fa"); }
  }
  function drawJitter() {
    const on = frame % 2;                                 // caffeine sparks
    px(1, 3 + on, 1, 1, "#ffe08a"); px(10, 4 - on, 1, 1, "#fff2b8");
    px(0, 6, 1, 1, on ? "#ffd54a" : "#c9954f");
  }
  function drawFrost() {
    g.fillStyle = "rgba(200,232,240,0.45)";
    g.fillRect(0, 0, cv.width, cv.height);
    px(1, 2, 1, 1, "#eaf6fb"); px(10, 3, 1, 1, "#eaf6fb");
    px(2, 10, 1, 1, "#cfeaf2"); px(9, 9, 1, 1, "#cfeaf2");
    for (let i = 2; i < 10; i += 2) px(i, 10, 1, (frame >> 3) % 2 ? 1 : 2, "#bfe3ef"); // icicles
  }
  function drawSweat() {
    if (frame % 30 < 16) px(10, 5, 1, 1, "#9fd0ff");
  }
  function drawSleepBag() {
    px(1, 8, 10, 3, "#4a5a8a"); px(1, 8, 10, 1, "#6a7cb0"); // cozy bag
  }
  function drawZ() {
    const s = (frame >> 4) % 3;
    if (s >= 0) px(9, 2, 1, 1, "#cfe");
    if (s >= 1) px(10, 1, 1, 1, "#cfe");
  }

  /* ============================================================
     Public API + debug
     ============================================================ */
  function set(k, v) { if (k in stat) { stat[k] = clamp(v, 0, 100); refreshMeters(); evaluate(); } }

  global.SpudPet = {
    open, hibernate,
    set,                                    // e.g. SpudPet.set('caffeine', 95)
    state: () => ({ mode, warmth: Math.round(stat.warmth),
      caffeine: Math.round(stat.caffeine), paranoia: Math.round(stat.paranoia) })
  };
})(window);
