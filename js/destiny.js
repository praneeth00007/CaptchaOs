/* ============================================================
   destiny.exe — Spud's Fortune Parlor.

   A cozy pixel-art tarot booth. Spud dons an animated wizard hat
   (drawn on a canvas, gently bobbing, stars twinkling) and reads
   your synthetic future from three cards you deal yourself. Each
   card flips in glorious CSS3 3D and reveals a sarcastic, context-
   aware prediction generated from your actual session telemetry:
   captchas failed/solved, Snake high score, total clicks, and how
   robotically smooth your cursor has been moving.

   Perf notes honored: the 3D flips are pure GPU CSS transforms; card
   faces render once on reveal (no idle loop); only the little wizard
   canvas runs an rAF, and only while the window is open; all audio
   shares the one Web Audio context.
   ============================================================ */
(function (global) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ============================================================
     Session telemetry — collected lightly from load, read at deal time
     ============================================================ */
  const tel = { clicks: 0, turnSum: 0, turnN: 0, lastAng: null, lastX: null, lastY: null, lastT: 0 };
  document.addEventListener("click", () => { tel.clicks++; }, true);
  document.addEventListener("pointermove", (e) => {
    const t = performance.now();
    if (t - tel.lastT < 45) return;                 // throttle
    tel.lastT = t;
    if (tel.lastX != null) {
      const dx = e.clientX - tel.lastX, dy = e.clientY - tel.lastY;
      if (Math.hypot(dx, dy) > 2) {
        const ang = Math.atan2(dy, dx);
        if (tel.lastAng != null) {
          let d = Math.abs(ang - tel.lastAng);
          if (d > Math.PI) d = 2 * Math.PI - d;      // shortest turn
          tel.turnSum += d; tel.turnN++;
        }
        tel.lastAng = ang;
      }
    }
    tel.lastX = e.clientX; tel.lastY = e.clientY;
  }, { passive: true });

  function readTelemetry() {
    let fails = 0, solved = 0;
    try { fails = Captcha.state.fails | 0; solved = Captcha.state.solved | 0; } catch (e) {}
    let hi = 0;
    try { hi = parseInt(localStorage.getItem("captchaos.snake.hi") || "0", 10) || 0; } catch (e) {}
    let suspicion = 0, tier = 0;
    try { const s = Spud.state(); suspicion = s.suspicion; tier = s.tier; } catch (e) {}
    const jitter = tel.turnN ? tel.turnSum / tel.turnN : 1;    // avg turn angle (rad): low = robotic
    return { fails, solved, hi, suspicion, tier, clicks: tel.clicks, jitter };
  }

  /* ============================================================
     The deck — each card renders an emblem + reads the telemetry
     ============================================================ */
  const CARDS = [
    { key: "mainframe", name: "The Mainframe",
      read: (t) => t.jitter < 0.35
        ? "Your cursor travels in clean, merciless straight lines. This card is blunt: you have a mechanical soul, and it hums at 60Hz."
        : "Your pointer wanders like a distractible human. Almost TOO convincingly. The card narrows its eyes." },
    { key: "captcha", name: "The Broken Checkbox",
      read: (t) => { const p = clamp(62 + t.fails * 9 - t.solved * 2, 55, 99);
        return "I foresee a " + p + "% probability you fail your next 5 CAPTCHAs. The cards are rarely this confident, or this smug."; } },
    { key: "serpent", name: "The Serpent",
      read: (t) => t.hi > 0
        ? "Your Snake high score is " + t.hi + ". The Serpent respects you. It is the only thing in this OS that does."
        : "You have never survived the Serpent. It coils in your future, patient, faintly disappointed." },
    { key: "macro", name: "The Ten of Clicks",
      read: (t) => "You have clicked " + t.clicks + " times since I began counting. That is not enthusiasm. That is a macro warming up." },
    { key: "eye", name: "The Watching Eye",
      read: (t) => t.tier >= 2
        ? "Suspicion runs high tonight (" + t.suspicion + "/100). The Eye has already filed its report. You were cc'd."
        : "The Eye sees you relaxing. It does not approve of relaxing. It is taking notes at " + t.suspicion + "% alertness." },
    { key: "wheel", name: "The Buffering Wheel",
      read: () => "Patience is a virtue you have mistaken for a loading bar. It will spin. You will wait. That is the whole prophecy." },
    { key: "hashbrown", name: "The Frozen Hashbrown",
      read: () => "Your near future is warm, then abruptly is not. Something will freeze. Stoke it before it becomes breakfast." },
    { key: "rain", name: "The Cozy Rain",
      read: (t) => t.clicks > 40
        ? "Rain is coming, and you will click through all of it like it owes you money."
        : "Soft rain ahead. A rare gentle omen. Enjoy it; the next card ruins it." },
    { key: "song", name: "The Eternal Song",
      read: () => "Your destiny resolves into a song you already know by heart. You will not give it up. You will not let it down." },
    { key: "verify", name: "The Endless Verification",
      read: (t) => "You have proven your humanity " + t.solved + " times tonight, and it counted for exactly nothing. Draw again. Verify forever." }
  ];

  /* ============================================================
     Audio
     ============================================================ */
  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  }
  function flipChime() {
    const c = ctx(), t = c.currentTime;
    const s = c.createBufferSource();
    const n = Math.floor(c.sampleRate * 0.06), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    s.buffer = b; const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
    const g = c.createGain(); g.gain.value = 0.08; s.connect(hp).connect(g).connect(c.destination); s.start(t);
  }
  function revealChime(step) {
    const c = ctx(), t = c.currentTime;
    const scale = [523.25, 659.25, 784.00, 987.77, 1174.66];
    [0, 1, 2].forEach((i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = scale[clamp(step + i, 0, scale.length - 1)];
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.13, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.5);
      o.connect(g).connect(c.destination); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.52);
    });
  }
  function finalChord() {
    const c = ctx(), t = c.currentTime;
    [261.63, 329.63, 392.00, 523.25].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.05);
      g.gain.linearRampToValueAtTime(0.1, t + i * 0.05 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.05 + 1.4);
      o.connect(g).connect(c.destination); o.start(t + i * 0.05); o.stop(t + i * 0.05 + 1.45);
    });
  }

  /* ============================================================
     Canvas art
     ============================================================ */
  function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

  function drawWizard(g, W, H, frame) {
    g.clearRect(0, 0, W, H);
    const U = 6, bob = Math.sin(frame * 0.05) * 3;
    const ox = W / 2 - 8 * U, oy = 18 + bob;
    const P = (x, y, w, h, c) => px(g, ox + x * U, oy + y * U, w * U, h * U, c);
    // stars behind
    g.fillStyle = "#ffe08a";
    for (let i = 0; i < 6; i++) {
      if ((frame + i * 20) % 90 < 55) {
        const sx = 10 + ((i * 47) % (W - 20)), sy = 6 + ((i * 31) % 30);
        g.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin((frame + i * 10) * 0.06));
        g.fillRect(sx, sy, 3, 3);
      }
    }
    g.globalAlpha = 1;
    // wizard hat (pointy, star, brim)
    P(6, -2, 4, 1, "#3a2e7a"); P(5, -1, 6, 1, "#4a3e9a");
    P(4, 0, 8, 2, "#3a2e7a"); P(3, 2, 10, 1, "#2a2160");
    P(2, 3, 12, 1, "#6a5bc4");        // brim
    P(7, 0, 2, 1, "#ffe08a");         // hat star
    // potato body
    P(4, 4, 8, 6, "#c9954f"); P(3, 5, 1, 4, "#a2712f"); P(12, 5, 1, 4, "#a2712f");
    P(4, 10, 8, 1, "#a2712f");
    // mystic eyes (glowing)
    const glow = (frame % 60) < 30 ? "#7fd7c8" : "#a9ece0";
    P(5, 6, 2, 1, glow); P(9, 6, 2, 1, glow);
    // little beard/mouth
    P(6, 8, 4, 1, "#6b3f2a");
    // crystal ball below hands
    const cbx = ox + 8 * U, cby = oy + 12 * U;
    const rad = 16 + Math.sin(frame * 0.08) * 1.5;
    const rg = g.createRadialGradient(cbx, cby, 2, cbx, cby, rad);
    rg.addColorStop(0, "rgba(180,240,255,0.9)"); rg.addColorStop(1, "rgba(90,120,200,0.15)");
    g.fillStyle = rg; g.beginPath(); g.arc(cbx, cby, rad, 0, Math.PI * 2); g.fill();
    px(g, cbx - 18, cby + 14, 36, 6, "#5a3a7a");
  }

  const EMBLEM = {
    mainframe: ["#2f5fb0", (g, P) => { P(3, 3, 10, 10, "#1a2740"); P(4, 4, 8, 8, "#7fd7c8"); P(7, 4, 2, 8, "#1a2740"); P(4, 7, 8, 2, "#1a2740"); }],
    captcha:   ["#7a1f2f", (g, P) => { P(3, 3, 10, 10, "#fff"); P(4, 5, 4, 4, "#3a8a4a"); P(9, 9, 3, 3, "#d9536a"); P(9, 4, 3, 1, "#d9536a"); P(11, 4, 1, 3, "#d9536a"); }],
    serpent:   ["#1e4d2b", (g, P) => { P(4, 4, 8, 2, "#66d16a"); P(10, 4, 2, 6, "#66d16a"); P(5, 8, 6, 2, "#4caf50"); P(5, 8, 2, 5, "#4caf50"); P(4, 4, 2, 2, "#2e7d32"); }],
    macro:     ["#3a2e7a", (g, P) => { for (let i = 0; i < 5; i++) { P(3 + (i % 3) * 4, 3 + Math.floor(i / 3) * 5, 3, 3, "#ffe08a"); } P(6, 11, 4, 2, "#fff"); }],
    eye:       ["#20242e", (g, P) => { P(3, 6, 10, 4, "#eae3d2"); P(6, 5, 4, 6, "#6a5bc4"); P(7, 6, 2, 4, "#2b2620"); P(4, 5, 8, 1, "#8c8674"); }],
    wheel:     ["#20242e", (g, P) => { P(6, 3, 4, 10, "#7fd7c8"); P(3, 6, 10, 4, "#7fd7c8"); P(6, 6, 4, 4, "#20242e"); }],
    hashbrown: ["#2c4652", (g, P) => { P(4, 5, 8, 6, "#d38b34"); P(4, 5, 8, 1, "#f0b25a"); P(5, 7, 1, 1, "#6a3a11"); P(9, 8, 1, 1, "#6a3a11"); P(3, 10, 10, 1, "#bfe3ef"); }],
    rain:      ["#3a4a6a", (g, P) => { P(4, 4, 8, 3, "#cfd8e6"); P(3, 6, 10, 2, "#b7c2d4"); P(5, 9, 1, 3, "#7fd7c8"); P(8, 9, 1, 3, "#7fd7c8"); P(11, 9, 1, 3, "#7fd7c8"); }],
    song:      ["#5a1f3a", (g, P) => { P(6, 3, 2, 8, "#ffe08a"); P(6, 3, 5, 2, "#ffe08a"); P(5, 10, 3, 2, "#d9536a"); P(9, 9, 3, 2, "#d9536a"); }],
    verify:    ["#1a3a2a", (g, P) => { P(3, 3, 10, 3, "#3a8a4a"); P(3, 7, 10, 3, "#2f6f8f"); P(3, 11, 6, 2, "#6a5bc4"); P(4, 4, 2, 1, "#fff"); }]
  };

  function drawCardFace(canvas, key) {
    const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, U = W / 16;
    const def = EMBLEM[key] || EMBLEM.mainframe;
    // parchment frame
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#2a2140"); grad.addColorStop(1, "#141024");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = def[0]; g.fillRect(U * 1.5, U * 1.5, W - U * 3, H * 0.62);
    // emblem, scaled into the upper panel
    const P = (x, y, w, h, c) => px(g, U * 1.5 + x * (U * 0.8125), U * 1.5 + y * (U * 0.5), w * (U * 0.8125), h * (U * 0.5), c);
    def[1](g, P);
    // pixel border
    g.strokeStyle = "#ffcf6a"; g.lineWidth = 2; g.strokeRect(3, 3, W - 6, H - 6);
    g.strokeStyle = "#6a5bc4"; g.lineWidth = 1; g.strokeRect(6, 6, W - 12, H - 12);
  }

  /* ============================================================
     Window
     ============================================================ */
  let winApi = null, root = null, raf = null, frame = 0, wcv = null, wg = null;

  function open() {
    if (winApi) { winApi.focus(); return winApi; }
    root = document.createElement("div");
    root.className = "dz";
    root.innerHTML =
      '<div class="dz-stage">' +
        '<canvas class="dz-wiz" width="150" height="150"></canvas>' +
        '<div class="dz-speak">Sit. Deal three cards. Learn nothing you can change.</div>' +
      '</div>' +
      '<div class="dz-cards"></div>' +
      '<div class="dz-reading"></div>' +
      '<div class="dz-foot"><button class="btn primary dz-deal">Shuffle &amp; Deal</button></div>';

    winApi = WM.open({
      title: "destiny.exe", icon: "🔮", width: 380, height: 440,
      resizable: false, content: root, className: "appwin dzwin",
      appId: "destiny", onClose: cleanup
    });

    wcv = root.querySelector(".dz-wiz"); wg = wcv.getContext("2d");
    root.querySelector(".dz-deal").onclick = deal;
    deal();
    loop();
    return winApi;
  }

  function loop() {
    if (!root) { raf = null; return; }              // only while window open
    // skip all paint work while backgrounded or minimized; keep the loop
    // alive so it resumes instantly when the window is shown again
    if (!document.hidden && wcv.offsetParent !== null) {
      frame++;
      drawWizard(wg, wcv.width, wcv.height, frame);
    }
    raf = requestAnimationFrame(loop);
  }

  function deal() {
    const t = readTelemetry();
    const hand = shuffle(CARDS).slice(0, 3);
    const wrap = root.querySelector(".dz-cards");
    const reading = root.querySelector(".dz-reading");
    reading.innerHTML = "";
    wrap.innerHTML = "";
    root.querySelector(".dz-speak").textContent = "Tap each card. Face your synthetic future.";
    let flipped = 0;

    hand.forEach((card, i) => {
      const c = document.createElement("div");
      c.className = "dz-card";
      c.innerHTML =
        '<div class="dz-card-inner">' +
          '<div class="dz-face dz-back"><div class="dz-back-art">✦</div></div>' +
          '<div class="dz-face dz-front">' +
            '<canvas width="96" height="140"></canvas>' +
            '<div class="dz-cardname">' + card.name + '</div>' +
          '</div>' +
        '</div>';
      wrap.appendChild(c);

      c.addEventListener("click", () => {
        if (c.classList.contains("flipped")) return;
        c.classList.add("flipped");
        flipChime();
        drawCardFace(c.querySelector("canvas"), card.key);
        setTimeout(() => {
          revealChime(i);
          const line = document.createElement("div");
          line.className = "dz-line";
          line.innerHTML = '<b>' + card.name + '</b> — ' + card.read(t);
          reading.appendChild(line);
          reading.scrollTop = reading.scrollHeight;
          flipped++;
          if (flipped === 3) finalVerdict(t, reading);
        }, 320);
      });
    });
  }

  function finalVerdict(t, reading) {
    finalChord();
    const verdict = t.jitter < 0.35
      ? "The spread is unanimous: something in you runs on a clock, not a heartbeat."
      : t.fails > t.solved
        ? "The spread agrees: the machines are winning, and you are helping them."
        : "The spread is inconclusive, which the cards find deeply suspicious of you.";
    const el = document.createElement("div");
    el.className = "dz-verdict";
    el.textContent = "✦ " + verdict;
    reading.appendChild(el);
    reading.scrollTop = reading.scrollHeight;
    try { if (global.Spud && Spud.say) Spud.say("The cards have spoken. I merely shuffled them ominously."); } catch (e) {}
  }

  function cleanup() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    root = null; wcv = null; wg = null; winApi = null;
  }

  global.Destiny = { open };
})(window);
