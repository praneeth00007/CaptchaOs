/* ============================================================
   Fogged glass overlay.

   When the Ambient Mixer's Chassis Moisture crosses 80%, the whole
   desktop fogs over. A single translucent <canvas> covers the screen;
   dragging the cursor "wipes" the condensation (destination-out), and
   once enough glass is cleared the fog lifts on its own.

   Kept light: the backing store runs at a fraction of screen res and
   the cleared-area check samples a coarse grid, not every pixel.
   ============================================================ */
(function (global) {
  const S = 0.6;                 // backing-store scale (lightweight)
  const CLEAR_TARGET = 0.6;      // wipe ~60% and it lifts

  let canvas = null, g = null, hint = null;
  let active = false, wiping = false, last = null, lastCheck = 0;
  let stroke = [], accused = false;

  function show() {
    if (active) return;
    active = true; accused = false;
    const scr = document.getElementById("screen") || document.body;

    canvas = document.createElement("canvas");
    canvas.id = "fog";
    scr.appendChild(canvas);

    hint = document.createElement("div");
    hint.id = "fog-hint";
    hint.textContent = "wipe the glass";
    scr.appendChild(hint);

    g = canvas.getContext("2d");
    resize();
    paint();

    global.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    global.addEventListener("pointerup", up);
    global.addEventListener("pointercancel", up);
  }

  function resize() {
    if (!canvas) return;
    canvas.width = Math.max(1, Math.floor(global.innerWidth * S));
    canvas.height = Math.max(1, Math.floor(global.innerHeight * S));
    paint();
  }

  function paint() {
    if (!g) return;
    const w = canvas.width, h = canvas.height;
    g.globalCompositeOperation = "source-over";
    // frosted, faintly blue-cold glass
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(214,226,234,0.94)");
    grad.addColorStop(1, "rgba(190,205,216,0.96)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // a few soft streaks so it reads as condensation, not a flat sheet
    g.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 40;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }

  function toBacking(e) {
    return [e.clientX * S, e.clientY * S];
  }
  function down(e) { wiping = true; last = toBacking(e); stroke = [[e.clientX, e.clientY]]; wipe(last, last); }
  function move(e) {
    if (!wiping) return;
    const p = toBacking(e);
    wipe(last, p); last = p;
    stroke.push([e.clientX, e.clientY]);
    if (Date.now() - lastCheck > 250) { lastCheck = Date.now(); if (cleared() >= CLEAR_TARGET) lift(); }
  }
  function up() {
    if (wiping && stroke.length > 4) analyzeStroke(stroke);
    wiping = false; last = null; stroke = [];
  }

  /* ---- gesture analysis: catch "robotically precise" wipes ---- */
  function resample(pts) {
    const out = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc >= 18) { out.push(pts[i]); acc = 0; }
    }
    return out;
  }
  function rightAngles(r) {
    let corners = 0;
    for (let i = 1; i < r.length - 1; i++) {
      const ax = r[i][0] - r[i - 1][0], ay = r[i][1] - r[i - 1][1];
      const bx = r[i + 1][0] - r[i][0], by = r[i + 1][1] - r[i][1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 6 || lb < 6) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180 / Math.PI;
      if (ang > 60 && ang < 120) corners++;
    }
    return corners;
  }
  function axisFraction(r) {
    let axis = 0, tot = 0;
    for (let i = 1; i < r.length; i++) {
      const dx = Math.abs(r[i][0] - r[i - 1][0]), dy = Math.abs(r[i][1] - r[i - 1][1]);
      tot++; if (dx < 8 || dy < 8) axis++;
    }
    return tot ? axis / tot : 0;
  }
  function analyzeStroke(pts) {
    if (accused) return;
    const n = pts.length;
    let len = 0, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i < n; i++) {
      const x = pts[i][0], y = pts[i][1];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    }
    if (len < 120) return;                                  // too short to judge
    const span = Math.hypot(pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1]);
    const diag = Math.hypot(maxX - minX, maxY - minY);
    const r = resample(pts);

    const straight = span > 130 && len / span < 1.12;       // a ruler-straight drag
    const loop     = span < 40  && len > 220 && diag > 90;  // returns to its start
    const circuit  = rightAngles(r) >= 2 && axisFraction(r) > 0.7; // clean right angles

    const kind = straight ? "line" : loop ? "loop" : circuit ? "circuit" : null;
    if (kind) {
      accused = true;
      try { global.dispatchEvent(new CustomEvent("spy:accused", { detail: { kind: kind } })); } catch (e) {}
      lift();                                               // caught you — the glass clears
    }
  }

  function wipe(a, b) {
    if (!g) return;
    if (hint) hint.style.opacity = "0";
    const R = 34;                 // brush radius in backing px
    g.globalCompositeOperation = "destination-out";
    g.strokeStyle = "rgba(0,0,0,1)"; g.fillStyle = "rgba(0,0,0,1)";
    g.lineWidth = R * 2; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    g.beginPath(); g.arc(b[0], b[1], R, 0, Math.PI * 2); g.fill();
  }

  // one readback, then sample a coarse grid; fraction of glass already wiped
  function cleared() {
    if (!g) return 0;
    const w = canvas.width, h = canvas.height, step = 24;
    let total = 0, clear = 0;
    try {
      const data = g.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          total++;
          if (data[(y * w + x) * 4 + 3] < 40) clear++;
        }
      }
    } catch (e) { return 0; }
    return total ? clear / total : 0;
  }

  function lift() {
    if (!canvas || canvas.dataset.lifting) return;
    canvas.dataset.lifting = "1";
    canvas.style.transition = "opacity .5s ease";
    canvas.style.opacity = "0";
    if (hint) hint.remove();
    setTimeout(hide, 520);
  }

  function hide() {
    global.removeEventListener("resize", resize);
    global.removeEventListener("pointerup", up);
    global.removeEventListener("pointercancel", up);
    if (canvas) { canvas.remove(); canvas = null; g = null; }
    if (hint) { hint.remove(); hint = null; }
    active = false; wiping = false; last = null;
  }

  global.Fog = { show, hide, isActive: () => active };
})(window);
