/* ============================================================
   CaptchaOS Audio — everything synthesized with Web Audio.
   No external files, no CDN. Works offline.
   ============================================================ */
(function (global) {
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // one beep
  function tone(freq, dur, type, when, gain) {
    if (muted) return;
    const c = ac();
    const t0 = c.currentTime + (when || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain == null ? 0.18 : gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // white-noise burst (for glitch/crash textures)
  function noise(dur, gain) {
    if (muted) return;
    const c = ac();
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = gain == null ? 0.15 : gain;
    src.buffer = buf;
    src.connect(g).connect(c.destination);
    src.start();
  }

  /* ---------------- calm lo-fi ambient loop ----------------
     A soft chord-pad progression through a warm lowpass filter.
     Routed through its own gain "bus" so mute can duck it smoothly
     without cutting the one-shot UI beeps.                        */
  let ambientGain = null, ambientFilter = null;
  const ambient = { on: false, timer: null, idx: 0 };
  const AMBIENT_LEVEL = 0.9;

  // cozy Cmaj7 -> Am7 -> Fmaj7 -> G, one bar each
  const AMB_CHORDS = [
    [130.81, 329.63, 392.00, 493.88], // Cmaj7
    [110.00, 329.63, 392.00, 523.25], // Am7
    [ 87.31, 261.63, 329.63, 440.00], // Fmaj7
    [ 98.00, 293.66, 392.00, 493.88]  // G
  ];
  const CHORD_SECS = 4.2;

  function ambientBus() {
    const c = ac();
    if (!ambientGain) {
      ambientGain = c.createGain();
      ambientGain.gain.value = muted ? 0.0001 : AMBIENT_LEVEL;
      ambientFilter = c.createBiquadFilter();
      ambientFilter.type = "lowpass";
      ambientFilter.frequency.value = 1100;   // soft, muffled, warm
      ambientFilter.Q.value = 0.6;
      ambientGain.connect(ambientFilter).connect(c.destination);
    }
    return ambientGain;
  }

  // a single slow-swelling pad voice
  function pad(freq, t0, dur, gain) {
    const c = ac();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    const peak = gain == null ? 0.045 : gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + dur * 0.35);        // slow attack
    g.gain.linearRampToValueAtTime(peak * 0.8, t0 + dur * 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);        // gentle release
    osc.connect(g).connect(ambientBus());
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function ambientTick() {
    if (!ambient.on) return;
    const c = ac();
    const t0 = c.currentTime + 0.05;
    const chord = AMB_CHORDS[ambient.idx % AMB_CHORDS.length];
    ambient.idx++;
    pad(chord[0], t0, CHORD_SECS * 1.1, 0.06);                    // warm bass root
    for (let i = 1; i < chord.length; i++) pad(chord[i], t0, CHORD_SECS, 0.033);
    // an occasional high shimmer — that lo-fi twinkle
    if (Math.random() < 0.6) {
      const note = chord[1 + Math.floor(Math.random() * (chord.length - 1))] * 2;
      pad(note, t0 + CHORD_SECS * 0.5, CHORD_SECS * 0.5, 0.018);
    }
    ambient.timer = setTimeout(ambientTick, CHORD_SECS * 1000);
  }

  const Sound = {
    mute(v) {
      muted = !!v;
      if (ambientGain) {
        try {
          const c = ac();
          ambientGain.gain.cancelScheduledValues(c.currentTime);
          ambientGain.gain.linearRampToValueAtTime(
            muted ? 0.0001 : AMBIENT_LEVEL, c.currentTime + 0.3);
        } catch (e) {}
      }
    },
    isMuted() { return muted; },
    resume() { try { ac(); } catch (e) {} },

    // start/stop the background lo-fi loop
    ambientStart() {
      try { ac(); } catch (e) { return; }
      if (ambient.on) return;
      ambient.on = true;
      ambientBus();
      ambientTick();
    },
    ambientStop() {
      ambient.on = false;
      if (ambient.timer) { clearTimeout(ambient.timer); ambient.timer = null; }
    },

    click()  { tone(660, 0.04, "square", 0, 0.08); },
    tick()   { tone(440, 0.03, "square", 0, 0.05); },
    open()   { tone(520, 0.05, "square"); tone(780, 0.06, "square", 0.05); },
    close()  { tone(400, 0.05, "square"); tone(260, 0.07, "square", 0.05); },

    // The classic two-note Windows error "ding-dong"
    error() {
      tone(880, 0.14, "sine", 0, 0.22);
      tone(587, 0.30, "sine", 0.13, 0.22);
    },
    // sharper "critical stop"
    critical() {
      tone(740, 0.10, "square", 0, 0.2);
      tone(494, 0.10, "square", 0.10, 0.2);
      tone(740, 0.10, "square", 0.20, 0.2);
    },
    chord()  { [523, 659, 784].forEach((f, i) => tone(f, 0.5, "sine", i * 0.04, 0.14)); },

    good()   { tone(659, 0.08, "square"); tone(880, 0.12, "square", 0.08); },
    bad()    { tone(200, 0.18, "sawtooth", 0, 0.2); },

    levelup() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, "square", i * 0.08, 0.16)); },
    eat()    { tone(880, 0.05, "square", 0, 0.12); tone(1320, 0.05, "square", 0.04, 0.1); },
    crash()  { noise(0.35, 0.2); tone(120, 0.4, "sawtooth", 0, 0.18); },

    boot()   { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.22, "sine", i * 0.14, 0.14)); },
    unlock() { [659, 784, 1046].forEach((f, i) => tone(f, 0.14, "sine", i * 0.1, 0.16)); },

    // "Never Gonna Give You Up" hook, roughly. Plays the melody line.
    rickroll(onDone) {
      if (muted) { if (onDone) setTimeout(onDone, 100); return; }
      // (note, duration-in-beats)
      const A3=220,C4=261.63,D4=293.66,E4=329.63,F4=349.23,G4=392,A4=440,Bb4=466.16,C5=523.25,D5=587.33;
      const mel = [
        [C4,1],[D4,1],[F4,1],[D4,1],   [A4,2],[A4,2],[G4,3],[0,1],
        [C4,1],[D4,1],[F4,1],[D4,1],   [G4,2],[G4,2],[F4,1],[E4,1],[D4,2],
        [C4,1],[D4,1],[F4,1],[D4,1],   [F4,2],[G4,1],[E4,1.5],[D4,.5],[C4,1],[C4,1],[G4,2],[F4,3]
      ];
      const beat = 0.26;
      let t = 0;
      mel.forEach(([f, d]) => {
        if (f > 0) tone(f, d * beat * 0.9, "square", t, 0.16);
        // simple bass
        if (f > 0) tone(f / 2, d * beat * 0.9, "triangle", t, 0.08);
        t += d * beat;
      });
      if (onDone) setTimeout(onDone, t * 1000 + 200);
      return t * 1000;
    }
  };

  global.Sound = Sound;
})(window);
