/* ============================================================
   Cozy Ambient Mixer (mixer.exe)

   Four ambient channels — Rain, Thunder, Vinyl Crackle, Fireplace —
   each with a fader, a mute toggle, and a lock. Every sound is
   generated live with the Web Audio API; there are no audio files.
     - Rain     : white noise through a band of low-pass filtering
     - Thunder  : low sine "booms" swelling under a filtered rumble
     - Vinyl    : faint surface hiss plus little impulse pops
     - Fireplace: band-passed brown noise with the odd crackle
   ============================================================ */
(function (global) {
  const rnd = (a, b) => a + Math.random() * (b - a);

  const CHANNELS = [
    { id: "rain",    label: "Rain",          icon: "🌧️", level: 45, max: 0.55 },
    { id: "thunder", label: "Thunder",       icon: "⛈️", level: 55, max: 0.85 },
    { id: "vinyl",   label: "Vinyl Crackle", icon: "💿", level: 30, max: 0.55 },
    { id: "fire",    label: "Fireplace",     icon: "🔥", level: 40, max: 0.55 }
  ];

  let winApi = null;      // singleton window
  let master = null;      // master gain -> destination
  const rig = {};         // id -> { gain, engine, level, muted, locked }

  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") c.resume();      // bypass autoplay lock on first click
    return c;
  }

  /* ---- noise sources ---- */
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
  function loop(buf) {
    const c = ctx(), s = c.createBufferSource();
    s.buffer = buf; s.loop = true; s.start();
    return s;
  }
  // a short filtered impulse — the "pop" used by vinyl & fire crackle
  function pop(out, hp, peak, len) {
    const c = ctx(), t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = whiteBuf(len);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    s.connect(f).connect(g).connect(out);
    s.start(t); s.stop(t + len + 0.02);
  }

  /* ---- the four engines. each returns { stop } and feeds `out` ---- */
  function rainEngine(out) {
    const c = ctx(), src = loop(whiteBuf(2));
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 430;
    const lp = c.createBiquadFilter(); lp.type = "lowpass";  lp.frequency.value = 2600; lp.Q.value = 0.3;
    src.connect(hp).connect(lp).connect(out);
    return { stop() { try { src.stop(); } catch (e) {} } };
  }
  function fireEngine(out) {
    const c = ctx(), src = loop(brownBuf(2.5));
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 700; bp.Q.value = 0.7;
    src.connect(bp).connect(out);
    const timers = [];
    (function crackle() {
      pop(out, 1500, rnd(0.25, 0.55), 0.05);
      timers.push(setTimeout(crackle, rnd(160, 900)));
    })();
    return { stop() { try { src.stop(); } catch (e) {} timers.forEach(clearTimeout); } };
  }
  function vinylEngine(out) {
    const c = ctx(), src = loop(whiteBuf(2));
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3200;
    const hiss = c.createGain(); hiss.gain.value = 0.06;
    src.connect(hp).connect(hiss).connect(out);
    const timers = [];
    (function crackle() {
      pop(out, 900, rnd(0.18, 0.5), 0.03);
      timers.push(setTimeout(crackle, rnd(50, 480)));
    })();
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
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.8, t + 0.4);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      osc.connect(og).connect(out); osc.start(t); osc.stop(t + 3.1);

      const s = c.createBufferSource(); s.buffer = brownBuf(3);
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.5, t + 0.5);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      s.connect(lp).connect(ng).connect(out); s.start(t); s.stop(t + 3);

      timers.push(setTimeout(boom, rnd(6000, 15000)));
    })();
    return { stop() { timers.forEach(clearTimeout); } };
  }
  const ENGINES = { rain: rainEngine, thunder: thunderEngine, vinyl: vinylEngine, fire: fireEngine };

  /* ---- level helpers ---- */
  function applyGain(id) {
    const r = rig[id]; if (!r) return;
    const target = r.muted ? 0.0001 : (r.level / 100) * r.def.max;
    try {
      const c = ctx();
      r.gain.gain.setTargetAtTime(Math.max(0.0001, target), c.currentTime, 0.05);
    } catch (e) {}
  }

  function open() {
    if (winApi) { winApi.focus(); return winApi; }      // singleton
    ctx();

    const c = ctx();
    master = c.createGain(); master.gain.value = 0.7;
    master.connect(c.destination);

    const body = document.createElement("div");
    body.className = "mx";
    body.innerHTML =
      '<div class="mx-head">COZY AMBIENT MIXER</div>' +
      '<div class="mx-sub">Four channels. No audio files. All of it made up on the spot.</div>' +
      CHANNELS.map((ch) =>
        '<div class="mx-row" data-id="' + ch.id + '">' +
          '<div class="mx-ico">' + ch.icon + '</div>' +
          '<div class="mx-name">' + ch.label + '</div>' +
          '<input type="range" class="mx-slider" min="0" max="100" value="' + ch.level + '" aria-label="' + ch.label + ' volume">' +
          '<div class="mx-btn mx-mute" title="Mute">🔊</div>' +
          '<div class="mx-btn mx-lock" title="Lock this fader">🔓</div>' +
        '</div>'
      ).join("") +
      '<div class="mx-foot">Lock a fader and it stops taking requests. Very on-brand.</div>';

    // build audio rig + wire controls
    CHANNELS.forEach((ch) => {
      const g = c.createGain(); g.connect(master);
      rig[ch.id] = { def: ch, gain: g, level: ch.level, muted: false, locked: false,
                     engine: ENGINES[ch.id](g) };
      applyGain(ch.id);

      const row = body.querySelector('.mx-row[data-id="' + ch.id + '"]');
      const slider = row.querySelector(".mx-slider");
      const mute = row.querySelector(".mx-mute");
      const lock = row.querySelector(".mx-lock");

      slider.oninput = () => {
        if (rig[ch.id].locked) return;
        rig[ch.id].level = +slider.value;
        applyGain(ch.id);
      };
      mute.onclick = () => {
        const r = rig[ch.id]; r.muted = !r.muted;
        row.classList.toggle("muted", r.muted);
        mute.textContent = r.muted ? "🔇" : "🔊";
        applyGain(ch.id);
        try { Sound && Sound.tick(); } catch (e) {}
      };
      lock.onclick = () => {
        const r = rig[ch.id]; r.locked = !r.locked;
        row.classList.toggle("locked", r.locked);
        lock.textContent = r.locked ? "🔒" : "🔓";
        slider.disabled = r.locked;
        try { Sound && Sound.click(); } catch (e) {}
      };
    });

    winApi = WM.open({
      title: "Cozy Ambient Mixer", icon: "🎚️", width: 344,
      content: body, resizable: false, className: "appwin",
      onClose: stopAll
    });
    return winApi;
  }

  function stopAll() {
    Object.keys(rig).forEach((id) => {
      try { rig[id].engine.stop(); } catch (e) {}
      delete rig[id];
    });
    try { if (master) master.disconnect(); } catch (e) {}
    master = null;
    winApi = null;
  }

  global.Mixer = { open };
})(window);
