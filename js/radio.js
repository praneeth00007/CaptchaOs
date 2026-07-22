/* ============================================================
   radio.exe — a retro lo-fi radio that mostly resents being on.

   Three fully-synthesized stations (no audio files, ever):
     · Soft Jazz    — mellow maj7 pad chords
     · Lo-Fi Piano  — pentatonic arpeggios through a warm lowpass
     · Synthwave    — sawtooth bassline + white-noise vinyl crackle

   A retro tuning knob picks the station. Every few minutes the
   signal DRIFTS: the music dissolves into white noise and the set
   locks until you realign it on the Frequency Alignment captcha
   (drag the TUNE + GAIN sliders so your sine wave overlaps the
   target's frequency and amplitude). And if you sit there listening
   for 15 minutes without touching anything, Spud pops a mandatory
   Vibe Check — answer wrong and it blasts a procedural dial-up
   modem screech and knocks the station out of alignment.

   Performance discipline, per the brief:
     · one shared AudioContext (Sound.ctx()) — every node lands on
       the same destination through a single master gain
     · switching stations stops the old engine's oscillators AT ONCE
     · the captcha canvas only runs its rAF loop while it's visible
     · all input listeners are scoped to the radio window container
   ============================================================ */
(function (global) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const DRIFT_MS = 120000;         // signal drifts every ~2 minutes
  const IDLE_MS = 900000;          // 15 minutes idle -> Vibe Check
  const ALIGN_TOL = 6;             // slider units within target that count as matched
  const ALIGN_HOLD_MS = 800;       // must stay aligned this long to pass

  let winApi = null;
  let ctx = null, master = null, stationGain = null, noiseGain = null, noiseSrc = null;
  let engine = null, curStation = -1;
  let root = null, body = null;
  let driftTimer = null, idleTimer = null;
  let locked = false;

  function AC() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  }

  /* ============================================================
     Station engines — each returns { stop() } and registers every
     oscillator it makes so a switch can silence them immediately.
     ============================================================ */
  function makeEngine(kind, out) {
    const c = ctx, timers = [], live = new Set();
    const track = (node) => { live.add(node); return node; };
    const stopAll = () => {
      timers.forEach(clearTimeout);
      live.forEach((n) => { try { n.stop(0); } catch (e) {} try { n.disconnect(); } catch (e) {} });
      live.clear();
    };

    if (kind === "jazz") {
      const chords = [
        [130.81, 164.81, 196.00, 246.94],   // Cmaj7
        [110.00, 146.83, 174.61, 220.00],   // Am7
        [ 87.31, 130.81, 174.61, 220.00],   // Fmaj7
        [ 98.00, 146.83, 196.00, 246.94]    // G
      ];
      let i = 0;
      const bar = () => {
        const t = c.currentTime, ch = chords[i++ % chords.length];
        ch.forEach((f, k) => {
          const o = track(c.createOscillator()), g = c.createGain();
          o.type = k === 0 ? "triangle" : "sine"; o.frequency.value = f;
          const peak = k === 0 ? 0.07 : 0.04;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.7);
          g.gain.linearRampToValueAtTime(peak * 0.8, t + 2.2);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
          o.connect(g).connect(out); o.start(t); o.stop(t + 3.7);
        });
        timers.push(setTimeout(bar, 3300));
      };
      bar();
    } else if (kind === "piano") {
      const scale = [261.63, 293.66, 329.63, 392.00, 440.00,     // C D E G A
                     523.25, 587.33, 659.25, 784.00, 880.00];
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200; lp.Q.value = 0.5;
      lp.connect(out);
      let step = 0;
      const note = () => {
        const t = c.currentTime;
        const f = scale[(step * 3 + (step % 2 ? 2 : 0)) % scale.length]; step++;
        const o = track(c.createOscillator()), g = c.createGain();
        o.type = "triangle"; o.frequency.value = f * (Math.random() < 0.15 ? 0.5 : 1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.10, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o.connect(g).connect(lp); o.start(t); o.stop(t + 1.15);
        timers.push(setTimeout(note, rnd(240, 340)));
      };
      note();
    } else if (kind === "synth") {
      // sawtooth bassline
      const bass = [55.00, 55.00, 82.41, 65.41, 73.42, 73.42, 98.00, 82.41];
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 6;
      lp.connect(out);
      let s = 0;
      const seq = () => {
        const t = c.currentTime, f = bass[s++ % bass.length];
        const o = track(c.createOscillator()), g = c.createGain();
        o.type = "sawtooth"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o.connect(g).connect(lp); o.start(t); o.stop(t + 0.36);
        timers.push(setTimeout(seq, 300));
      };
      seq();
      // vinyl crackle: looping filtered white noise + random pops
      const n = Math.floor(c.sampleRate * 2);
      const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = track(c.createBufferSource()); src.buffer = buf; src.loop = true;
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3000;
      const hg = c.createGain(); hg.gain.value = 0.05;
      src.connect(hp).connect(hg).connect(out); src.start();
      const pop = () => {
        const t = c.currentTime;
        const ps = track(c.createBufferSource()); ps.buffer = buf;
        const pf = c.createBiquadFilter(); pf.type = "bandpass"; pf.frequency.value = rnd(1500, 4000);
        const pg = c.createGain();
        pg.gain.setValueAtTime(rnd(0.1, 0.3), t);
        pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        ps.connect(pf).connect(pg).connect(out); ps.start(t); ps.stop(t + 0.05);
        timers.push(setTimeout(pop, rnd(120, 700)));
      };
      pop();
    }
    return { stop: stopAll };
  }

  const STATIONS = [
    { id: "jazz",  name: "Soft Jazz",     freq: "88.4" },
    { id: "piano", name: "Lo-Fi Piano",   freq: "92.1" },
    { id: "synth", name: "Synthwave",     freq: "99.7" }
  ];

  function switchStation(idx) {
    idx = clamp(idx | 0, 0, STATIONS.length - 1);
    if (idx === curStation) return;
    curStation = idx;
    if (engine) { engine.stop(); engine = null; }     // silence the old one AT ONCE
    engine = makeEngine(STATIONS[idx].id, stationGain);
    const st = STATIONS[idx];
    if (root) {
      root.querySelector(".rk-freq").textContent = st.freq;
      root.querySelector(".rk-name").textContent = st.name;
      root.querySelectorAll(".rk-tick").forEach((t, i) => t.classList.toggle("on", i === idx));
    }
  }

  /* ============================================================
     Signal drift + Frequency Alignment captcha
     ============================================================ */
  function scheduleDrift() {
    clearTimeout(driftTimer);
    driftTimer = setTimeout(startDrift, DRIFT_MS);
  }

  function startDrift() {
    if (locked || !root) return;
    locked = true;
    // duck music, raise noise
    const t = ctx.currentTime;
    try {
      stationGain.gain.setTargetAtTime(0.0001, t, 0.4);
      noiseGain.gain.setTargetAtTime(0.22, t, 0.4);
    } catch (e) {}
    openAlign();
  }

  function endDrift() {
    locked = false;
    const t = ctx.currentTime;
    try {
      noiseGain.gain.setTargetAtTime(0.0001, t, 0.4);
      stationGain.gain.setTargetAtTime(0.8, t, 0.5);
    } catch (e) {}
    scheduleDrift();
  }

  let alignRaf = null, alignVisible = false;
  function openAlign() {
    const ov = root.querySelector(".rk-align");
    ov.hidden = false;
    ov.innerHTML =
      '<div class="rk-align-head">⚠ SIGNAL DRIFT — realign the carrier</div>' +
      '<canvas class="rk-wave" width="300" height="90"></canvas>' +
      '<div class="rk-sliders">' +
        '<label>TUNE <input type="range" class="rk-f" min="0" max="100" value="10"></label>' +
        '<label>GAIN <input type="range" class="rk-a" min="0" max="100" value="90"></label>' +
      '</div>' +
      '<div class="rk-align-msg">overlap your wave (cyan) onto the target (amber)</div>';

    const canvas = ov.querySelector(".rk-wave");
    const g = canvas.getContext("2d");
    const fEl = ov.querySelector(".rk-f");
    const aEl = ov.querySelector(".rk-a");
    const msg = ov.querySelector(".rk-align-msg");

    // random target, kept away from the slider start so it's never pre-solved
    const targetF = rnd(45, 90), targetA = rnd(25, 70);
    let alignedSince = 0;

    const toCycles = (v) => 1 + (v / 100) * 5;       // 1..6 cycles
    const toAmp = (v) => 6 + (v / 100) * 32;         // px amplitude

    function matched() {
      return Math.abs(+fEl.value - targetF) <= ALIGN_TOL &&
             Math.abs(+aEl.value - targetA) <= ALIGN_TOL;
    }

    function drawWave(cyc, amp, phase, color, w, h) {
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const y = h / 2 - amp * Math.sin((x / w) * cyc * Math.PI * 2 + phase);
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    }

    alignVisible = true;
    function render(ts) {
      if (!alignVisible) { alignRaf = null; return; }     // strictly-while-visible loop
      const w = canvas.width, h = canvas.height;
      g.clearRect(0, 0, w, h);
      g.fillStyle = "#0d1320"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(127,215,200,.15)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      const ph = (ts || 0) * 0.002;
      drawWave(toCycles(targetF), toAmp(targetA), ph, "#ffcf6a", w, h);
      drawWave(toCycles(+fEl.value), toAmp(+aEl.value), ph, "#7fd7c8", w, h);
      const ok = matched();
      if (ok) {
        if (!alignedSince) alignedSince = performance.now();
        msg.textContent = "carrier locking…"; msg.className = "rk-align-msg good";
        if (performance.now() - alignedSince >= ALIGN_HOLD_MS) { passAlign(); return; }
      } else {
        alignedSince = 0;
        msg.textContent = "overlap your wave (cyan) onto the target (amber)";
        msg.className = "rk-align-msg";
      }
      alignRaf = requestAnimationFrame(render);
    }
    alignRaf = requestAnimationFrame(render);

    function passAlign() {
      alignVisible = false;
      if (alignRaf) { cancelAnimationFrame(alignRaf); alignRaf = null; }
      ov.hidden = true; ov.innerHTML = "";
      try { Sound && Sound.levelup && Sound.levelup(); } catch (e) {}
      endDrift();
    }
    // sliders are inside the radio container — scoped, no global listeners
    try { Sound && Sound.error && Sound.error(); } catch (e) {}
  }

  /* ============================================================
     Idle -> Spud Vibe Check
     ============================================================ */
  const QUESTIONS = [
    { q: 'Did track #3 sound more like a sad robot or a lonely toaster?',
      opts: ['A sad robot', 'A lonely toaster'], a: 1 },
    { q: 'Be honest: is the static judging you?',
      opts: ['Yes, constantly', 'No, it respects me'], a: 0 },
    { q: 'What key was that in?',
      opts: ['The key of regret', 'C# minor', 'A locked one'], a: 0 },
    { q: 'The bassline just winked at you. Wink back?',
      opts: ['Wink back', 'Report to authorities'], a: 0 },
    { q: 'How many potatoes are currently listening with you?',
      opts: ['One (it me)', 'Zero, I am alone', 'Too many'], a: 0 }
  ];

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(openVibe, IDLE_MS);
  }

  function openVibe() {
    if (!root) return;
    const ov = root.querySelector(".rk-vibe");
    const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    ov.hidden = false;
    ov.innerHTML =
      '<div class="rk-vibe-card">' +
        '<div class="rk-vibe-head">🥔 SPUD VIBE CHECK</div>' +
        '<div class="rk-vibe-q">' + q.q + '</div>' +
        '<div class="rk-vibe-opts">' +
          q.opts.map((o, i) => '<button class="btn rk-vibe-opt" data-i="' + i + '">' + o + '</button>').join("") +
        '</div>' +
      '</div>';
    try { Sound && Sound.eerie && Sound.eerie(); } catch (e) {}
    ov.querySelectorAll(".rk-vibe-opt").forEach((b) => {
      b.onclick = () => {
        if (+b.dataset.i === q.a) {
          ov.hidden = true; ov.innerHTML = "";
          try { Sound && Sound.good && Sound.good(); } catch (e) {}
          resetIdle();
        } else {
          ov.querySelector(".rk-vibe-q").textContent = "WRONG. Suspicious answer. Recalibrating you.";
          playModem();
          setTimeout(() => {
            ov.hidden = true; ov.innerHTML = "";
            resetIdle();
            startDrift();                 // wrong answer knocks the station out of alignment
          }, 3200);
        }
      };
    });
  }

  /* high-gain procedural dial-up modem handshake */
  function playModem() {
    const c = ctx, t0 = c.currentTime;
    const bus = c.createGain(); bus.gain.value = 0.34; bus.connect(master);
    const beep = (f, at, dur, type) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.linearRampToValueAtTime(0.9, t0 + at + 0.02);
      g.gain.setValueAtTime(0.9, t0 + at + dur - 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(bus); o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
    };
    // touch-tone dial
    beep(350, 0, 0.3); beep(440, 0, 0.3);
    beep(697, 0.4, 0.12, "square"); beep(1209, 0.4, 0.12, "square");
    beep(770, 0.55, 0.12, "square"); beep(1336, 0.55, 0.12, "square");
    // carrier + handshake warble
    beep(2100, 0.8, 0.5); beep(1650, 0.8, 0.5);
    // scratchy negotiation noise
    const n = Math.floor(c.sampleRate * 1.6);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (0.4 + 0.6 * Math.sin(i / 400));
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0.5;
    src.connect(bp).connect(ng).connect(bus); src.start(t0 + 1.4); src.stop(t0 + 3.0);
    // final screech
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(1200, t0 + 2.6);
    o.frequency.linearRampToValueAtTime(2400, t0 + 3.1);
    g.gain.setValueAtTime(0.6, t0 + 2.6); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.15);
    o.connect(g).connect(bus); o.start(t0 + 2.6); o.stop(t0 + 3.2);
  }

  /* ============================================================
     The tuning knob
     ============================================================ */
  function wireKnob() {
    const knob = root.querySelector(".rk-knob");
    const dial = root.querySelector(".rk-dial");
    let value = curStation, dragging = false, startY = 0, startVal = 0;

    const paint = () => {
      const deg = (value / (STATIONS.length - 1)) * 240 - 120;   // -120..120
      dial.style.transform = "rotate(" + deg + "deg)";
    };
    paint();

    const move = (e) => {
      if (!dragging) return;
      value = clamp(startVal + (startY - e.clientY) / 55, 0, STATIONS.length - 1);
      paint();
      switchStation(Math.round(value));
    };
    knob.addEventListener("pointerdown", (e) => {
      dragging = true; startY = e.clientY; startVal = value;
      try { knob.setPointerCapture(e.pointerId); } catch (err) {}
      knob.classList.add("grab");
    });
    knob.addEventListener("pointermove", move);
    const up = () => {
      if (!dragging) return;
      dragging = false; knob.classList.remove("grab");
      value = Math.round(value); paint();
    };
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
    // clicking a station tick jumps to it
    root.querySelectorAll(".rk-tick").forEach((t, i) => {
      t.onclick = () => { value = i; paint(); switchStation(i); };
    });
  }

  /* ============================================================
     Window
     ============================================================ */
  function open() {
    if (winApi) { winApi.focus(); return winApi; }
    ctx = AC();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    stationGain = ctx.createGain(); stationGain.gain.value = 0.8; stationGain.connect(master);
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0.0001; noiseGain.connect(master);
    // persistent looping noise bed for drift
    const n = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = buf; noiseSrc.loop = true;
    const nlp = ctx.createBiquadFilter(); nlp.type = "lowpass"; nlp.frequency.value = 5000;
    noiseSrc.connect(nlp).connect(noiseGain); noiseSrc.start();

    root = document.createElement("div");
    root.className = "rk";
    body = root;
    root.innerHTML =
      '<div class="rk-set">' +
        '<div class="rk-display">' +
          '<div class="rk-freq">88.4</div>' +
          '<div class="rk-fm">FM</div>' +
          '<div class="rk-name">Soft Jazz</div>' +
          '<div class="rk-eq"><i></i><i></i><i></i><i></i><i></i></div>' +
        '</div>' +
        '<div class="rk-ticks">' +
          STATIONS.map((s, i) =>
            '<div class="rk-tick" data-i="' + i + '"><b></b><span>' + s.freq + '</span></div>').join("") +
        '</div>' +
        '<div class="rk-knobwrap">' +
          '<div class="rk-knob" role="slider" aria-label="Tuning knob" title="Drag to tune">' +
            '<div class="rk-dial"><i></i></div>' +
          '</div>' +
          '<div class="rk-knoblbl">TUNE</div>' +
        '</div>' +
      '</div>' +
      '<div class="rk-align" hidden></div>' +
      '<div class="rk-vibe" hidden></div>';

    winApi = WM.open({
      title: "radio.exe", icon: "📻", width: 340, height: 300,
      resizable: false, content: root, className: "appwin rkwin",
      appId: "radio", onClose: cleanup
    });

    wireKnob();
    switchStation(0);
    scheduleDrift();
    resetIdle();

    // idle timer resets on ANY interaction inside the radio container only
    root.addEventListener("pointerdown", resetIdle);
    return winApi;
  }

  function cleanup() {
    clearTimeout(driftTimer); clearTimeout(idleTimer);
    alignVisible = false;
    if (alignRaf) { cancelAnimationFrame(alignRaf); alignRaf = null; }
    if (engine) { engine.stop(); engine = null; }
    try { noiseSrc && noiseSrc.stop(0); } catch (e) {}
    try { master && master.disconnect(); } catch (e) {}
    ctx = master = stationGain = noiseGain = noiseSrc = null;
    root = body = null; winApi = null; curStation = -1; locked = false;
  }

  global.Radio = { open };
})(window);
