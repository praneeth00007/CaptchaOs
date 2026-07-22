/* ============================================================
   recycle_bin.exe — CaptchaOS Waste Compliance Facility.

   Opening the bin is not a formality here: it's a sorting shift.
   A pool of procedurally-categorised junk drops onto the belt and
   you must drag each item into exactly the right bin —

     · Compost            — organic (Spud's coffee cups, banana peels…)
     · Electronic Waste   — corrupted .sys files, binary dumps…
     · Robotic Propaganda — bot manifests, robot schematics…

   Sort it right and it vanishes with a little trash-drop chime.
   Sort it WRONG and Spud issues an Environmental Violation Ticket,
   levies a fine, and freezes the taskbar solid for two full minutes.

   Pointer Events drive the drag (the whole OS speaks pointer, and it
   works on touch); all audio is synthesized on the shared context;
   the freeze timer lives at module scope so closing the window can
   never strand the taskbar in a locked state.
   ============================================================ */
(function (global) {
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const BINS = [
    { cat: "organic",  label: "Compost",            glyph: "🌱", tint: "#3a8a4a" },
    { cat: "electronic", label: "Electronic Waste", glyph: "💾", tint: "#2f5fb0" },
    { cat: "robotic",  label: "Robotic Propaganda", glyph: "🤖", tint: "#d9536a" }
  ];

  const ITEMS = [
    { glyph: "☕", label: "Spud's coffee cup",   cat: "organic" },
    { glyph: "🍌", label: "banana peel",         cat: "organic" },
    { glyph: "🍎", label: "apple core",          cat: "organic" },
    { glyph: "🥔", label: "potato skin",         cat: "organic" },
    { glyph: "💾", label: "corrupted.sys",       cat: "electronic" },
    { glyph: "🖥️", label: "binary_dump.bin",     cat: "electronic" },
    { glyph: "🔌", label: "dead_driver.dll",     cat: "electronic" },
    { glyph: "📼", label: "old_backup.tar",      cat: "electronic" },
    { glyph: "🤖", label: "bot_manifest.txt",    cat: "robotic" },
    { glyph: "📐", label: "robot_schematic.svg", cat: "robotic" },
    { glyph: "⚙️", label: "actuator_specs",      cat: "robotic" },
    { glyph: "📡", label: "propaganda.exe",      cat: "robotic" }
  ];
  const BATCH = 9;                       // items per shift (3 of each, shuffled)

  const FINE_STEPS = [12, 25, 40, 80];   // escalating credits per violation
  const FREEZE_MS = 120000;              // 2-minute taskbar freeze

  let winApi = null, root = null;
  let remaining = 0, violations = 0;

  /* ---------------- audio ---------------- */
  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  }
  function dropChime() {
    const c = ctx(), t = c.currentTime;
    [523.25, 784.00].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.16, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.22);
      o.connect(g).connect(c.destination); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.24);
    });
    // a soft lid "clack"
    const n = Math.floor(c.sampleRate * 0.05);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const g2 = c.createGain(); g2.gain.value = 0.12;
    s.connect(g2).connect(c.destination); s.start(t);
  }
  function buzzer() {
    const c = ctx(), t = c.currentTime;
    [0, 0.18].forEach((off) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sawtooth"; o.frequency.value = 150;
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.linearRampToValueAtTime(0.22, t + off + 0.01);
      g.gain.setValueAtTime(0.22, t + off + 0.13);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16);
      o.connect(g).connect(c.destination); o.start(t + off); o.stop(t + off + 0.17);
    });
  }

  /* ============================================================
     Taskbar freeze — module-scoped so it survives the window closing
     ============================================================ */
  let freezeTimer = null, freezeTick = null;
  function freezeTaskbar(ms) {
    const tb = document.getElementById("taskbar");
    if (!tb) return;
    tb.classList.add("rb-frozen");
    let badge = document.getElementById("rb-freeze-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "rb-freeze-badge";
      tb.appendChild(badge);
    }
    const end = performance.now() + ms;
    const paint = () => {
      const left = Math.max(0, end - performance.now());
      const s = Math.ceil(left / 1000);
      badge.textContent = "⛔ TASKBAR FROZEN " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    };
    paint();
    clearInterval(freezeTick);
    freezeTick = setInterval(paint, 500);
    clearTimeout(freezeTimer);
    freezeTimer = setTimeout(unfreezeTaskbar, ms);   // the one authority that lifts it
  }
  function unfreezeTaskbar() {
    clearTimeout(freezeTimer); clearInterval(freezeTick);
    freezeTimer = freezeTick = null;
    const tb = document.getElementById("taskbar");
    if (tb) tb.classList.remove("rb-frozen");
    const badge = document.getElementById("rb-freeze-badge");
    if (badge) badge.remove();
  }

  /* ============================================================
     Violation ticket
     ============================================================ */
  function ticket(item, bin) {
    buzzer();
    const fine = FINE_STEPS[Math.min(violations, FINE_STEPS.length - 1)];
    violations++;
    freezeTaskbar(FREEZE_MS);
    WM.error({
      title: "Environmental Violation",
      tico: "♻️", icon: "🚨",
      msg: "You put <b>" + item.label + "</b> in <b>" + bin.label + "</b>. That is not where that goes and you know it. " +
           "Fine: <b>" + fine + " trust-credits</b>. The taskbar is frozen for 2 minutes so you can reflect.",
      code: "ERR_MISSORT_0x" + (0xC0 + violations).toString(16).toUpperCase(),
      buttons: [{ label: "I have learned nothing", primary: true }],
      sound: false, shake: true
    });
  }

  /* ============================================================
     Window + belt
     ============================================================ */
  function open() {
    if (winApi) { winApi.focus(); return winApi; }
    root = document.createElement("div");
    root.className = "rb";
    root.innerHTML =
      '<div class="rb-head">WASTE COMPLIANCE FACILITY · sort every item into its exact bin</div>' +
      '<div class="rb-bins">' +
        BINS.map((b) =>
          '<div class="rb-bin" data-cat="' + b.cat + '" style="--tint:' + b.tint + '">' +
            '<div class="rb-bin-mouth"></div>' +
            '<div class="rb-bin-glyph">' + b.glyph + '</div>' +
            '<div class="rb-bin-label">' + b.label + '</div>' +
          '</div>').join("") +
      '</div>' +
      '<div class="rb-pool"></div>' +
      '<div class="rb-status"><span class="rb-count"></span></div>';

    winApi = WM.open({
      title: "Recycle Bin", icon: "♻️", width: 420, height: 400,
      resizable: false, content: root, className: "appwin rbwin",
      appId: "bin", onClose: cleanup
    });

    populate();
    return winApi;
  }

  function populate() {
    const pool = root.querySelector(".rb-pool");
    pool.innerHTML = "";
    const batch = shuffle(ITEMS).slice(0, BATCH);
    remaining = batch.length;
    batch.forEach((it, i) => {
      const el = document.createElement("div");
      el.className = "rb-item";
      el.dataset.cat = it.cat;
      el.dataset.label = it.label;
      el.innerHTML = '<span class="rb-item-glyph">' + it.glyph + '</span>' +
                     '<span class="rb-item-label">' + it.label + '</span>';
      wireDrag(el, it);
      pool.appendChild(el);
    });
    updateCount();
  }

  function updateCount() {
    const c = root && root.querySelector(".rb-count");
    if (c) c.textContent = remaining > 0
      ? remaining + " item" + (remaining === 1 ? "" : "s") + " left to sort"
      : "Facility cleared. Spud is suspicious of your competence.";
  }

  /* ---------------- pointer-driven drag ---------------- */
  function wireDrag(el, item) {
    let ghost = null, dragging = false;

    el.addEventListener("pointerdown", (e) => {
      if (document.getElementById("taskbar")?.classList.contains("rb-frozen")) { /* facility still open; allow */ }
      dragging = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
      ghost = el.cloneNode(true);
      ghost.className = "rb-ghost";
      document.body.appendChild(ghost);
      moveGhost(e);
      try { Sound && Sound.tick && Sound.tick(); } catch (err) {}
    });

    el.addEventListener("pointermove", (e) => { if (dragging) moveGhost(e); highlightBin(e); });

    el.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      clearBinHighlight();
      const bin = binUnder(e, ghost);
      if (ghost) { ghost.remove(); ghost = null; }
      if (!bin) return;                                  // dropped nowhere: snap back
      if (bin.dataset.cat === item.cat) {
        // correct — vanish the item
        dropChime();
        bin.classList.add("rb-accept");
        setTimeout(() => bin.classList.remove("rb-accept"), 240);
        el.remove();
        remaining--;
        updateCount();
        if (remaining <= 0) finishBatch();
      } else {
        const binDef = BINS.find((b) => b.cat === bin.dataset.cat);
        ticket(item, binDef);
      }
    });

    function moveGhost(e) {
      if (!ghost) return;
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
    }
  }

  function binUnder(e, ghost) {
    if (ghost) ghost.style.display = "none";
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (ghost) ghost.style.display = "";
    return target ? target.closest(".rb-bin") : null;
  }
  function highlightBin(e) {
    clearBinHighlight();
    const b = binUnder(e, document.querySelector(".rb-ghost"));
    if (b) b.classList.add("rb-over");
  }
  function clearBinHighlight() {
    if (!root) return;
    root.querySelectorAll(".rb-bin.rb-over").forEach((b) => b.classList.remove("rb-over"));
  }

  function finishBatch() {
    try { Sound && Sound.levelup && Sound.levelup(); } catch (e) {}
    const pool = root.querySelector(".rb-pool");
    pool.innerHTML =
      '<div class="rb-clear">✔ Facility cleared.<br>' +
      '<button class="btn primary rb-again">Bring another batch</button></div>';
    pool.querySelector(".rb-again").onclick = () => { try { Sound && Sound.click && Sound.click(); } catch (e) {} populate(); };
  }

  function cleanup() {
    // the window is going away; the freeze timer is intentionally NOT cleared
    // here — a penalty must outlive the window so it can't be dodged by closing.
    winApi = null; root = null;
  }

  global.RecycleBin = { open };
})(window);
