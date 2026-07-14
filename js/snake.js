/* ============================================================
   Snake — a full canvas game living inside a WM window.
   Levels, hi-score, keys scoped to the focused window, cleanup.
   ============================================================ */
(function (global) {
  const COLS = 20, ROWS = 20, CELL = 16;
  const W = COLS * CELL, H = ROWS * CELL;

  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  /* the cascade of retro error windows that erupts from Level 2 on */
  const GLITCH_ERRORS = [
    { title: "System Error",     tico: "⚠", icon: "❌", msg: "An illegal snake operation has been detected.",                          code: "STOP 0x00SNEK01" },
    { title: "REPTILE.EXE",      tico: "🐍", icon: "💥", msg: "REPTILE.EXE has stopped responding and must be fed.",                    code: "Fault @ 0xFEED" },
    { title: "Out of Memory",    tico: "⚠", icon: "💾", msg: "Not enough memory to remember where your tail is.",                       code: "ERR_NO_RAM" },
    { title: "Kernel Panic",     tico: "☠", icon: "🌀", msg: "kernel32.dll tried to eat itself. Please remain calm.",                   code: "KRNL_UROBOROS" },
    { title: "Warning",          tico: "⚠", icon: "📉", msg: "You are running dangerously low on free pixels.",                          code: "W_LOW_PIXELS" },
    { title: "CaptchaOS",        tico: "🖥️", icon: "🟦", msg: "A problem has been detected and Snake has been glitched to protect your score.", code: "0x000000SS" },
    { title: "Fatal Exception",  tico: "💥", icon: "⛔", msg: "A fatal exception 0E has occurred at 00SS:APPLE.",                        code: "0E:APPLE" },
    { title: "Update Required",  tico: "🔄", icon: "⬇", msg: "CaptchaOS would like to restart. Now. In the middle of this.",            code: "UPD_RUDE" }
  ];
  const BTN_LABELS = ["OK", "Ignore", "Retry", "Abort", "Continue", "Why"];

  function loadHi() {
    try { return parseInt(localStorage.getItem("captchaos.snake.hi") || "0", 10) || 0; }
    catch (e) { return 0; }
  }
  function saveHi(v) { try { localStorage.setItem("captchaos.snake.hi", String(v)); } catch (e) {} }

  function open(opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "snake-wrap";
    wrap.innerHTML = `
      <div class="snake-hud">
        <div class="lvl">LVL <b class="v-lvl">1</b></div>
        <div>SCORE <b class="v-score">0</b></div>
        <div>HI <b class="v-hi">0</b></div>
      </div>
      <div class="snake-canvas-wrap">
        <canvas width="${W}" height="${H}"></canvas>
        <div class="snake-start">
          <h2>SNAKE</h2>
          <p>Arrow keys or W A S D to move<br>Eat the apples 🍎<br>Don't bite your own tail</p>
          <div class="btn primary go-start">PRESS TO START</div>
        </div>
        <div class="snake-over">
          <h2 class="over-msg">GAME OVER</h2>
          <div class="btn primary go-again">PLAY AGAIN</div>
        </div>
      </div>`;

    const win = WM.open({
      title: "Snake",
      icon: "🐍",
      width: 360,
      height: 430,
      resizable: false,
      content: wrap,
      className: "appwin",
      onClose: cleanup
    });

    const canvas = wrap.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const startEl = wrap.querySelector(".snake-start");
    const overEl = wrap.querySelector(".snake-over");
    const vLvl = wrap.querySelector(".v-lvl");
    const vScore = wrap.querySelector(".v-score");
    const vHi = wrap.querySelector(".v-hi");

    let hi = loadHi();
    vHi.textContent = hi;

    let snake, dir, nextDir, food, score, level, alive, timer = null;
    let eaten = 0;         // apples ACTUALLY eaten this run (anti-bypass truth source)
    let cheatFlag = false; // set once a bypass is detected

    /* ---- glitch: cascading retro error windows ---- */
    let glitchWins = [];              // live error-popup handles
    const GLITCH_CAP = 14;            // ceiling so the screen never fully saturates

    // per-apple error burst ("beads"): Lvl2 -> 4, Lvl3 -> 5, capped at 7
    function glitchCount(lvl) { return Math.min(7, lvl + 2); }

    function spawnGlitch() {
      if (!alive) return;             // no new chaos once dead / stopped
      const e = pick(GLITCH_ERRORS);
      const h = WM.error({
        title: e.title, tico: e.tico, icon: e.icon, msg: e.msg, code: e.code,
        buttons: [{ label: pick(BTN_LABELS) }],
        shake: true,
        sound: Math.random() < 0.5 ? "critical" : true   // synthesized retro beeps
      });
      glitchWins.push(h);
      if (glitchWins.length > GLITCH_CAP) {
        const old = glitchWins.shift();
        try { old.close(); } catch (e) {}
      }
      // auto-dismiss so the field of gaps keeps shifting
      const life = 2200 + Math.random() * 1400;
      setTimeout(() => {
        const i = glitchWins.indexOf(h);
        if (i >= 0) glitchWins.splice(i, 1);
        try { h.close(); } catch (e) {}
      }, life);
    }

    function glitchBurst(n) {
      for (let i = 0; i < n; i++)
        setTimeout(spawnGlitch, i * (110 + Math.random() * 130));
    }

    function clearGlitch() {
      glitchWins.forEach((h) => { try { h.close(); } catch (e) {} });
      glitchWins = [];
    }

    function reset() {
      snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
      dir = { x: 1, y: 0 };
      nextDir = { x: 1, y: 0 };
      score = 0; level = 1; alive = true;
      eaten = 0; cheatFlag = false;
      placeFood();
      vScore.textContent = 0; vLvl.textContent = 1;
    }

    function placeFood() {
      let p;
      do { p = { x: rnd(COLS), y: rnd(ROWS) }; }
      while (snake.some((s) => s.x === p.x && s.y === p.y));
      food = p;
    }
    function rnd(n) { return Math.floor(Math.random() * n); }

    function speed() { return Math.max(60, 150 - (level - 1) * 12); }

    function loop() {
      if (!alive) return;
      // ANTI-BYPASS: score & level must match apples actually eaten. Natural play
      // always matches; jumping score/level via the console (to skip the pain) won't.
      if (!cheatFlag && (score !== eaten * 10 || level !== Math.floor(score / 50) + 1))
        return penalize();
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

      // walls + self collision
      if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS ||
          snake.some((s) => s.x === head.x && s.y === head.y)) {
        return gameOver();
      }

      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        eaten++;                       // the only legitimate way progress is earned
        score += 10;
        vScore.textContent = score;
        Sound && Sound.eat();
        if (score % 50 === 0) {
          level++; vLvl.textContent = level;
          Sound && Sound.levelup();
          clearGlitch();              // brief breather, then the storm rebuilds
          if (level === 3) survived();
          if (level >= 4) { endToFinale(); return; }  // cleared Level 3 -> the finale
          restartTimer();
        }
        // Level 1 is calm; from Level 2 every apple erupts a cascade of errors
        if (level >= 2) glitchBurst(glitchCount(level));
        placeFood();
      } else {
        snake.pop();
      }
      draw();
    }

    function draw() {
      ctx.fillStyle = "#0d110b";
      ctx.fillRect(0, 0, W, H);
      // subtle grid
      ctx.fillStyle = "rgba(44,58,38,.4)";
      for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++)
        if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      // nothing more to draw before the first reset() (pre-start screen)
      if (!snake || !food) return;
      // food
      ctx.fillStyle = "#ff5a5a";
      ctx.fillRect(food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6);
      // snake
      snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? "#bdf0b0" : "#5fbf52";
        ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
      });
    }

    function restartTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(loop, speed());
    }

    function start() {
      reset();
      startEl.classList.remove("show");
      startEl.style.display = "none";
      overEl.classList.remove("show");
      draw();
      restartTimer();
      win.focus();
    }

    // debug: jump straight into a given level (sanctioned — keeps counters
    // consistent so the anti-bypass check does NOT fire for dev testing)
    function startAt(lvl) {
      start();
      lvl = Math.max(1, lvl | 0);
      if (lvl > 1) {
        level = lvl;
        score = (lvl - 1) * 50;          // 50 pts per level
        eaten = score / 10;              // keep the truth source consistent
        vLvl.textContent = level;
        vScore.textContent = score;
        restartTimer();
      }
    }

    // ANTI-BYPASS penalty: revoke progress, troll the cheater, back to Level 1
    function penalize() {
      if (cheatFlag) return;
      cheatFlag = true;
      alive = false;
      if (timer) { clearInterval(timer); timer = null; }
      clearGlitch();
      Sound && Sound.crash();
      const accusations = [
        { title: "Integrity Violation", msg: "Unnatural gameplay detected. That's not how snakes work." },
        { title: "CHEATER.EXE", msg: "You tried to skip the fun part. The fun part was mandatory." },
        { title: "Penalty Applied", msg: "Progress revoked. Back to Level 1 with you, human." }
      ];
      accusations.forEach((e, i) => setTimeout(() => WM.error({
        title: e.title, tico: "⛔", icon: "🚫", msg: e.msg,
        buttons: [{ label: "Ugh, fine" }], shake: true, sound: "critical"
      }), i * 320));
      overEl.querySelector(".over-msg").innerHTML = "NICE TRY 😏<br>PLAY FAIR";
      overEl.classList.add("show");
    }

    /* reached Level 3 — you survived the storm (it does not fully relent) */
    function survived() {
      WM.error({
        title: "SYSTEM (mostly) RECOVERED",
        tico: "🏆", icon: "🎉",
        msg: "You reached Level 3 and survived the glitch storm. The errors, however, are not done with you.",
        buttons: [{ label: "I regret nothing", primary: true }],
        sound: false
      });
    }

    /* cleared Level 3 — hand off to the un-closable rickroll finale */
    function endToFinale() {
      alive = false;
      if (timer) { clearInterval(timer); timer = null; }
      clearGlitch();
      setTimeout(() => { try { Finale.play(); } catch (e) {} }, 250);
    }

    function gameOver() {
      alive = false;
      clearGlitch();
      if (timer) { clearInterval(timer); timer = null; }
      if (score > hi) { hi = score; saveHi(hi); vHi.textContent = hi; }
      overEl.querySelector(".over-msg").innerHTML = `GAME OVER<br>SCORE ${score}`;
      overEl.classList.add("show");
      Sound && Sound.crash();
      // let Spud offer his (dubious) condolences
      try { window.dispatchEvent(new CustomEvent("snake:over", { detail: { score } })); } catch (e) {}
    }

    // start/over overlays use .show; hide the initial start card via display too
    wrap.querySelector(".go-start").onclick = start;
    wrap.querySelector(".go-again").onclick = start;

    // keys scoped to THIS window while focused & visible
    const KEYS = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
      W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0]
    };
    function onKey(e) {
      if (win.el.classList.contains("inactive") || win.el.style.display === "none") return;
      const k = KEYS[e.key];
      if (!k) return;
      e.preventDefault();
      if (!alive) return;
      const [dx, dy] = k;
      // disallow reversing directly into self
      if (dx === -dir.x && dy === -dir.y) return;
      nextDir = { x: dx, y: dy };
    }
    document.addEventListener("keydown", onKey);

    function cleanup() {
      alive = false;
      clearGlitch();
      document.removeEventListener("keydown", onKey);
      if (timer) { clearInterval(timer); timer = null; }
    }

    draw();
    if (opts.level) setTimeout(() => startAt(opts.level), 60);   // debug deep-link
    return win;
  }

  global.Snake = { open };
})(window);