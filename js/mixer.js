/* ============================================================
   Cozy Ambient Mixer (mixer.exe)

   Four procedurally-generated ambient channels — Rain, Thunder,
   Vinyl Crackle, Fireplace — each with a fader and a mute. Three of
   them (Thunder, Vinyl, Fireplace) are locked behind the "Trust Tax":
   touch a locked fader and an Audio CAPTCHA plays a spoken number
   sequence over noise while Spud coughs over some digits. Type the
   digits you actually heard to unlock that channel.

   A Chassis Moisture meter is derived from the live Rain + Thunder
   volumes; push it past 80% and the desktop fogs over (see fog.js).
   Every sound is synthesized with the Web Audio API — no files.
   ============================================================ */
(function (global) {
  const rnd = (a, b) => a + Math.random() * (b - a);

  const CHANNELS = [
    { id: "rain",    label: "Rain",          icon: "🌧️", level: 45, max: 0.55, taxed: false },
    { id: "thunder", label: "Thunder",       icon: "⛈️", level: 50, max: 0.85, taxed: true  },
    { id: "vinyl",   label: "Vinyl Crackle", icon: "💿", level: 35, max: 0.55, taxed: true  },
    { id: "fire",    label: "Fireplace",     icon: "🔥", level: 40, max: 0.55, taxed: true  }
  ];

  let winApi = null, master = null, moist = null, mxRoot = null;
  let hi = false, failStreak = 0, freezeTimer = null, onSpy = null;
  const rig = {};

  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") c.resume();
    return c;
  }

  /* ---- noise + engines (identical DSP to before) ---- */
  function whiteBuf(sec) {
    const c = ctx(), n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function brownBuf(sec) {
    const c = ctx(), n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    return b;
  }
  function loop(buf) { const c = ctx(), s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
  function pop(out, hp, peak, len) {
    const c = ctx(), t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = whiteBuf(len);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + len + 0.02);
  }
  function rainEngine(out) {
    const c = ctx(), src = loop(whiteBuf(2));
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 430;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600; lp.Q.value = 0.3;
    src.connect(hp).connect(lp).connect(out);
    return { stop() { try { src.stop(); } catch (e) {} } };
  }
  function fireEngine(out) {
    const c = ctx(), src = loop(brownBuf(2.5));
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 700; bp.Q.value = 0.7;
    src.connect(bp).connect(out);
    const timers = [];
    (function crackle() { pop(out, 1500, rnd(0.25, 0.55), 0.05); timers.push(setTimeout(crackle, rnd(160, 900))); })();
    return { stop() { try { src.stop(); } catch (e) {} timers.forEach(clearTimeout); } };
  }
  function vinylEngine(out) {
    const c = ctx(), src = loop(whiteBuf(2));
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3200;
    const hiss = c.createGain(); hiss.gain.value = 0.06;
    src.connect(hp).connect(hiss).connect(out);
    const timers = [];
    (function crackle() { pop(out, 900, rnd(0.18, 0.5), 0.03); timers.push(setTimeout(crackle, rnd(50, 480))); })();
    return { stop() { try { src.stop(); } catch (e) {} timers.forEach(clearTimeout); } };
  }
  function thunderEngine(out) {
    const c = ctx(), timers = [];
    (function boom() {
      const t = c.currentTime;
      const osc = c.createOscillator(); osc.type = "sine";
      osc.frequency.setValueAtTime(rnd(52, 72), t);
      osc.frequency.exponentialRampToValueAtTime(34, t + 2.6);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.8, t + 0.4);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      osc.connect(og).connect(out); osc.start(t); osc.stop(t + 3.1);
      const s = c.createBufferSource(); s.buffer = brownBuf(3);
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.5, t + 0.5);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      s.connect(lp).connect(ng).connect(out); s.start(t); s.stop(t + 3);
      timers.push(setTimeout(boom, rnd(6000, 15000)));
    })();
    return { stop() { timers.forEach(clearTimeout); } };
  }
  const ENGINES = { rain: rainEngine, thunder: thunderEngine, vinyl: vinylEngine, fire: fireEngine };

  /* ---- levels & moisture ---- */
  function applyGain(id) {
    const r = rig[id]; if (!r) return;
    const on = r.unlocked && !r.muted;
    const target = on ? (r.level / 100) * r.def.max : 0.0001;
    try { r.gain.gain.setTargetAtTime(Math.max(0.0001, target), ctx().currentTime, 0.05); } catch (e) {}
  }
  function chLevel(id) { const r = rig[id]; return (r && r.unlocked && !r.muted) ? r.level : 0; }
  function updateMoisture() {
    if (!moist) return;
    const m = Math.round(chLevel("rain") * 0.6 + chLevel("thunder") * 0.4);
    moist.bar.style.width = m + "%";
    moist.val.textContent = m + "%";
    moist.wrap.classList.toggle("high", m > 80);
    if (m > 80 && !hi) {
      hi = true;
      try { global.Fog && Fog.show(); } catch (e) {}
      try { global.dispatchEvent(new CustomEvent("moisture:high", { detail: { level: m } })); } catch (e) {}
    } else if (m < 70 && hi) {
      hi = false;
      try { global.dispatchEvent(new CustomEvent("moisture:ok")); } catch (e) {}
    }
  }

  /* Spud seizes the board after three failed taxes */
  function seizeBoard() {
    Object.keys(rig).forEach((id) => {
      const r = rig[id]; r.level = 0; if (r.slider) r.slider.value = 0; applyGain(id);
    });
    updateMoisture();
    try { global.dispatchEvent(new CustomEvent("mixer:reset")); } catch (e) {}
  }

  /* freeze the whole board for a spell (spy accusation penalty) */
  function freezeControls(ms) {
    if (!mxRoot) return;
    mxRoot.classList.add("mx-frozen");
    clearTimeout(freezeTimer);
    freezeTimer = setTimeout(() => { if (mxRoot) mxRoot.classList.remove("mx-frozen"); }, ms);
  }
  function accusePopup(kind) {
    const what = kind === "line" ? "a perfectly straight line"
               : kind === "loop" ? "a flawless closed loop"
               : "clean right-angle circuits";
    try {
      WM.error({
        title: "Behavioral Anomaly", tico: "🕵️", icon: "🤖",
        msg: "Your wipe traced " + what + ". Human hands smear; they don't draft. Audio controls are frozen for 15 seconds while this is reviewed.",
        code: "ERR_ROBOTIC_PRECISION_0xB07",
        buttons: [{ label: "I'm human, I swear", primary: true }],
        sound: "critical", shake: true
      });
    } catch (e) {}
  }

  function unlock(id) {
    const r = rig[id]; if (!r || r.unlocked) return;
    r.unlocked = true;
    if (!r.engine) r.engine = ENGINES[id](r.gain);
    r.row.classList.remove("locked");
    r.tax.hidden = true;
    r.slider.disabled = false;
    r.lock.textContent = "🔓"; r.lock.title = "Unlocked — tax paid";
    applyGain(id); updateMoisture();
  }

  /* ============================================================
     Trust Tax — the audio CAPTCHA that unlocks a channel
     ============================================================ */
  function openTax(id) {
    const r = rig[id]; if (!r || r.unlocked) return;

    const LEN = 6;
    const seq = []; for (let i = 0; i < LEN; i++) seq.push(Math.floor(Math.random() * 10));
    const coughed = new Set();
    while (coughed.size < 2) coughed.add(Math.floor(Math.random() * LEN));
    const answer = seq.filter((_, i) => !coughed.has(i)).join("");

    const host = document.createElement("div");
    host.className = "cap taxcap";
    host.innerHTML =
      '<div class="banner"><div class="k">AUDIO VERIFICATION · TRUST TAX</div>' +
      '<div class="q">Unlock <b>' + r.def.label + '</b> by ear</div></div>' +
      '<div class="tx-body">' +
        '<div class="tx-note">Press play and type only the numbers you can hear. ' +
        'Spud coughs over <b>' + coughed.size + '</b> of them — leave those out.</div>' +
        '<div class="tx-row"><div class="tx-play">▶ Play sequence</div>' +
        '<div class="tx-eq"><i></i><i></i><i></i><i></i><i></i></div></div>' +
        '<input class="cap-input bevel-in tx-input" type="text" inputmode="numeric" ' +
        'autocomplete="off" placeholder="digits you heard">' +
      '</div>' +
      '<div class="cap-msg"></div>' +
      '<div class="foot"><div class="robo"><span>🔒</span><span>tax due</span></div>' +
      '<div class="btn primary verify">Unlock</div></div>';

    const win = WM.open({
      title: "Trust Tax", icon: "🔊", width: 344,
      content: host, resizable: false, system: true
    });

    const msg = host.querySelector(".cap-msg");
    const input = host.querySelector(".tx-input");
    const eq = host.querySelector(".tx-eq");
    let bed = null, playing = false;

    function startBed() {
      const c = ctx();
      const src = loop(whiteBuf(2));
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
      const g = c.createGain(); g.gain.value = 0.09;
      src.connect(lp).connect(g).connect(c.destination);
      bed = { stop() { try { src.stop(); } catch (e) {} } };
    }
    function stopBed() { if (bed) { bed.stop(); bed = null; } }
    function speak(d) {
      try {
        const u = new SpeechSynthesisUtterance(String(d));
        u.rate = 0.85; u.pitch = 1;
        global.speechSynthesis.speak(u);
      } catch (e) {}
    }
    function play() {
      if (playing) return;
      playing = true; eq.classList.add("on");
      try { Sound && Sound.resume && Sound.resume(); } catch (e) {}
      startBed();
      let t = 450;
      seq.forEach((d, i) => {
        setTimeout(() => {
          if (coughed.has(i)) { try { Sound && Sound.cough && Sound.cough(); } catch (e) {} }
          else speak(d);
        }, t);
        t += 950;
      });
      setTimeout(() => { stopBed(); eq.classList.remove("on"); playing = false; }, t + 500);
    }

    host.querySelector(".tx-play").onclick = play;
    host.querySelector(".verify").onclick = () => {
      const val = input.value.replace(/\D/g, "");
      if (val === answer) {
        failStreak = 0;
        msg.textContent = "Tax paid. Channel unlocked.";
        msg.className = "cap-msg good";
        try { Sound && Sound.levelup(); } catch (e) {}
        stopBed();
        unlock(id);
        setTimeout(() => { try { win.close(); } catch (e) {} }, 700);
      } else {
        failStreak++;
        try { Sound && Sound.error(); } catch (e) {}
        if (failStreak >= 3) {
          failStreak = 0;
          msg.textContent = "Three misses. Spud is taking the board.";
          msg.className = "cap-msg bad";
          stopBed();
          setTimeout(() => { try { win.close(); } catch (e) {} seizeBoard(); }, 800);
        } else {
          msg.textContent = "That's not what I said. Listen again — mind the coughs. (" + failStreak + "/3)";
          msg.className = "cap-msg bad";
        }
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") host.querySelector(".verify").click(); });
    setTimeout(play, 350);            // auto-play once on open
  }

  /* ============================================================
     Window
     ============================================================ */
  function open() {
    if (winApi) { winApi.focus(); return winApi; }
    const c = ctx();
    master = c.createGain(); master.gain.value = 0.7; master.connect(c.destination);

    const body = document.createElement("div");
    body.className = "mx";
    mxRoot = body;
    body.innerHTML =
      '<div class="mx-head">COZY AMBIENT MIXER</div>' +
      '<div class="mx-sub">Four channels, all synthesized. Three are behind the Trust Tax.</div>' +
      CHANNELS.map((ch) =>
        '<div class="mx-row' + (ch.taxed ? " locked" : "") + '" data-id="' + ch.id + '">' +
          '<div class="mx-ico">' + ch.icon + '</div>' +
          '<div class="mx-name">' + ch.label + '</div>' +
          '<div class="mx-fader">' +
            '<input type="range" class="mx-slider" min="0" max="100" value="' + ch.level + '"' +
              (ch.taxed ? " disabled" : "") + ' aria-label="' + ch.label + ' volume">' +
            '<div class="mx-tax"' + (ch.taxed ? "" : " hidden") + ' title="Locked — pay the Trust Tax">🔒</div>' +
          '</div>' +
          '<div class="mx-btn mx-mute" title="Mute">🔊</div>' +
          '<div class="mx-btn mx-lock" title="' + (ch.taxed ? "Locked" : "Free channel") + '">' +
            (ch.taxed ? "🔒" : "🔓") + '</div>' +
        '</div>'
      ).join("") +
      '<div class="mx-moist"><div class="mx-moist-top"><span>CHASSIS MOISTURE</span>' +
        '<span class="mx-moist-val">0%</span></div>' +
        '<div class="mx-moist-bar bevel-in"><i></i></div>' +
        '<div class="mx-moist-hint">Rain + Thunder. Over 80% and the glass fogs up.</div></div>';

    const moistWrap = body.querySelector(".mx-moist");
    moist = {
      wrap: moistWrap,
      bar: moistWrap.querySelector(".mx-moist-bar > i"),
      val: moistWrap.querySelector(".mx-moist-val")
    };

    CHANNELS.forEach((ch) => {
      const g = c.createGain(); g.connect(master);
      const row = body.querySelector('.mx-row[data-id="' + ch.id + '"]');
      const r = {
        def: ch, gain: g, level: ch.level, muted: false, unlocked: !ch.taxed, engine: null,
        row: row,
        slider: row.querySelector(".mx-slider"),
        mute: row.querySelector(".mx-mute"),
        lock: row.querySelector(".mx-lock"),
        tax: row.querySelector(".mx-tax")
      };
      rig[ch.id] = r;
      if (r.unlocked) r.engine = ENGINES[ch.id](g);
      applyGain(ch.id);

      r.slider.oninput = () => {
        if (!r.unlocked) return;
        r.level = +r.slider.value; applyGain(ch.id); updateMoisture();
      };
      r.mute.onclick = () => {
        r.muted = !r.muted; row.classList.toggle("muted", r.muted);
        r.mute.textContent = r.muted ? "🔇" : "🔊";
        applyGain(ch.id); updateMoisture();
        try { Sound && Sound.tick(); } catch (e) {}
      };
      // touching a locked channel triggers the Trust Tax
      r.tax.onclick = () => openTax(ch.id);
      r.lock.onclick = () => { if (!r.unlocked) openTax(ch.id); };
    });

    updateMoisture();

    // robotic wipe on the fog -> freeze the board + accuse
    onSpy = (e) => { freezeControls(15000); accusePopup(e.detail && e.detail.kind); };
    global.addEventListener("spy:accused", onSpy);

    winApi = WM.open({
      title: "Cozy Ambient Mixer", icon: "🎚️", width: 360,
      content: body, resizable: false, className: "appwin", onClose: stopAll
    });
    return winApi;
  }

  function stopAll() {
    Object.keys(rig).forEach((id) => {
      try { if (rig[id].engine) rig[id].engine.stop(); } catch (e) {}
      delete rig[id];
    });
    try { if (master) master.disconnect(); } catch (e) {}
    if (onSpy) { global.removeEventListener("spy:accused", onSpy); onSpy = null; }
    clearTimeout(freezeTimer);
    master = null; moist = null; mxRoot = null; winApi = null; hi = false; failStreak = 0;
  }

  global.Mixer = { open };
})(window);
