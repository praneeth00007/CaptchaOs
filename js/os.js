/* ============================================================
   CaptchaOS — orchestrator: boot -> login gauntlet -> desktop
   ============================================================ */
(function (global) {
  const $ = (sel) => document.querySelector(sel);

  /* ---------------- BOOT ---------------- */
  function boot() {
    const bootEl = $("#boot");
    const bar = bootEl.querySelector(".bar > i");
    const line = bootEl.querySelector(".bootline");
    const steps = [
      "Loading kernel modules…",
      "Mounting /dev/skepticism…",
      "Calibrating trust levels: LOW…",
      "Warming up the captcha engine…",
      "Ready. Prove yourself."
    ];
    let p = 0, si = 0;
    try { Sound && Sound.boot(); } catch (e) {}
    const tick = () => {
      p = Math.min(100, p + (8 + Math.random() * 14));
      bar.style.width = p + "%";
      if (line && p > (si + 1) * 20 && si < steps.length) { line.textContent = steps[si++]; }
      if (p >= 100) { setTimeout(showLogin, 500); return; }
      setTimeout(tick, 260 + Math.random() * 180);
    };
    setTimeout(tick, 400);
  }

  /* ---------------- LOGIN GAUNTLET ----------------
     Renders makeLoginSpecs() one-by-one: a chain of increasingly
     absurd multi-stage text captchas. Desktop stays locked until
     every single one is solved. No password. No escape.          */
  function showLogin() {
    const boot = $("#boot");
    const login = $("#login");
    boot.classList.add("hidden");
    login.classList.remove("hidden");
    try { Sound && Sound.chord(); } catch (e) {}

    const specs = Captcha.makeLoginSpecs();
    const prog = login.querySelector(".login-prog");
    const host = login.querySelector(".login-host");
    const hint = login.querySelector(".login-hint");

    const NAGS = [
      "Good. But one is never enough.",
      "Suspicious speed. Continue.",
      "Halfway. Or are you?",
      "Your humanity is… tentatively noted.",
      "Almost. Do not celebrate yet."
    ];

    let i = 0;
    function step() {
      if (i >= specs.length) return finishLogin();
      prog.textContent = `HUMAN VERIFICATION · ${i + 1} of ${specs.length}`;
      host.innerHTML = "";
      hint.textContent = "";
      hint.className = "login-hint";
      Captcha.renderInto(host, () => {
        i++;
        if (i >= specs.length) { finishLogin(); return; }
        hint.textContent = NAGS[(i - 1) % NAGS.length];
        hint.className = "login-hint good";
        setTimeout(step, 600);
      }, { type: "text", spec: specs[i] });
    }
    step();
  }

  function finishLogin() {
    const login = $("#login");
    const hint = login.querySelector(".login-hint");
    const prog = login.querySelector(".login-prog");
    prog.textContent = "ACCESS GRANTED";
    hint.textContent = "Welcome, definitely-a-human. Logging you in…";
    hint.className = "login-hint good";
    try { Sound && Sound.levelup(); } catch (e) {}
    setTimeout(() => { login.classList.add("hidden"); enterDesktop(); }, 900);
  }

  /* ---------------- DESKTOP ---------------- */
  let deskReady = false;

  /* app registry — the star is Browser; the rest are cozy filler/traps.
     dialog:true apps just pop a message box, so they don't count as windows. */
  const APPS = [
    { id: "browser", icon: "🌐", label: "Cozle Browser", open: () => Browser.open() },
    { id: "radio",   icon: "📻", label: "radio.exe",      open: () => Radio.open() },
    { id: "snake",   icon: "🐍", label: "Snake",         open: () => Snake.open() },
    { id: "mixer",   icon: "🎚️", label: "Ambient Mixer",  open: () => Mixer.open() },
    { id: "spudpet", icon: "🥔", label: "Spud-Pet",      open: () => SpudPet.open(), dialog: true },
    { id: "brew",    icon: "☕", label: "brew.exe",       open: () => Brew.open() },
    { id: "notes",   icon: "📝", label: "Notepad",       open: openNotepad },
    { id: "trials",  icon: "🧩", label: "CAPTCHA Trials",open: () => Gauntlet.run({}) },
    { id: "control", icon: "🎛️", label: "Control Panel",  open: openControlPanel, dialog: true },
    { id: "bin",     icon: "🗑️", label: "Recycle Bin",   open: () => RecycleBin.open() }
  ];

  /* ---------------- pixel-art taskbar icons ----------------
     Hand-built 16×16 SVGs (crispEdges => chunky pixels), one per app,
     so the taskbar reads as cozy retro glyphs instead of flat emoji.
     Transparent backgrounds; the dock shows a lit dot under running apps. */
  const ICONS = (function () {
    const wrap = (inner) =>
      '<svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" ' +
      'xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
    const r = (x, y, w, h, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>';
    return {
      browser: wrap(
        r(2,2,12,12,"#2f6f8f")+r(3,3,10,10,"#7fd7c8")+r(7,3,2,10,"#2f6f8f")+
        r(3,7,10,2,"#2f6f8f")+r(4,4,3,2,"#cdeee8")+r(3,3,10,1,"#a9ece0")),
      radio: wrap(
        r(1,5,14,9,"#8c5a3a")+r(2,6,12,7,"#c8905c")+r(3,7,6,5,"#3a2313")+r(4,8,4,3,"#7fd7c8")+
        r(10,7,3,3,"#ffe08a")+r(10,10,3,1,"#3a2313")+r(4,2,2,4,"#b8ae97")+r(9,3,1,3,"#b8ae97")),
      snake: wrap(
        r(3,3,8,2,"#4caf50")+r(9,3,2,6,"#4caf50")+r(5,7,6,2,"#4caf50")+r(5,7,2,5,"#4caf50")+
        r(5,10,7,2,"#66d16a")+r(3,3,2,2,"#2e7d32")+r(12,4,1,1,"#d9536a")),
      mixer: wrap(
        r(3,2,1,12,"#8c8674")+r(8,2,1,12,"#8c8674")+r(13,2,1,12,"#8c8674")+
        r(2,4,3,2,"#7fd7c8")+r(7,8,3,2,"#ffe08a")+r(12,3,3,2,"#e2687d")),
      spudpet: wrap(
        r(5,2,6,2,"#e2b878")+r(3,4,10,8,"#c9954f")+r(4,12,8,2,"#a2712f")+
        r(5,6,2,2,"#2b2620")+r(9,6,2,2,"#2b2620")+r(6,9,4,1,"#6b3f2a")+r(4,5,1,4,"#a2712f")),
      brew: wrap(
        r(3,6,9,7,"#eae3d2")+r(4,7,7,5,"#3a2313")+r(12,7,3,3,"#eae3d2")+r(13,8,1,1,"#8c8674")+
        r(5,2,1,3,"#cdeee8")+r(8,2,1,3,"#cdeee8")+r(3,12,9,1,"#b8ae97")),
      notes: wrap(
        r(3,2,10,12,"#fffdf5")+r(3,2,10,2,"#d9536a")+r(5,6,6,1,"#5c5548")+
        r(5,8,6,1,"#5c5548")+r(5,10,4,1,"#5c5548")+r(3,2,1,12,"#b8ae97")),
      trials: wrap(
        r(4,2,6,4,"#6a5bc4")+r(6,4,2,2,"#6a5bc4")+r(2,6,4,6,"#7fd7c8")+r(4,8,2,2,"#7fd7c8")+
        r(8,6,6,6,"#ffe08a")+r(10,4,2,2,"#ffe08a")),
      control: wrap(
        r(2,3,5,5,"#b8ae97")+r(3,4,3,3,"#3a2e7a")+r(9,3,5,5,"#b8ae97")+r(10,4,3,3,"#d9536a")+
        r(5,9,6,5,"#b8ae97")+r(6,10,4,3,"#7fd7c8")),
      bin: wrap(
        r(4,3,8,1,"#8c8674")+r(6,2,4,1,"#8c8674")+r(3,4,10,2,"#b8ae97")+r(4,6,8,8,"#9a938a")+
        r(6,7,1,6,"#6f6a5c")+r(9,7,1,6,"#6f6a5c"))
    };
  })();
  function iconFor(app) { return ICONS[app.id] || ('<span class="ql-emoji">' + app.icon + '</span>'); }

  /* CaptchaOS runs a strict three-window policy. Try to open a fourth and
     it panics at you in cascading error boxes, snake-storm style. */
  const MAX_WINDOWS = 3;
  const WINDOW_LIMIT_ERRORS = [
    { title: "CaptchaOS", tico: "🪟", icon: "⚠", sound: "critical",
      msg: "Too many windows open. CaptchaOS holds three at a time. It always has. It just never mentioned it." },
    { title: "Out of Memory", tico: "🧠", icon: "🚫",
      msg: "Memory exhausted. Close a window, or a thought, and try again." },
    { title: "Resource Limit", tico: "⛔", icon: "❌",
      msg: "Window quota reached. Three is plenty. Four is greed." }
  ];

  function launch(app) {
    if (!app.dialog && WM.appCount() >= MAX_WINDOWS) {
      try { Sound && Sound.bad && Sound.bad(); } catch (e) {}
      WM.errorStorm(WINDOW_LIMIT_ERRORS, 320);
      return;
    }
    WM._launchAppId = app.id;              // the app's first window inherits this
    try { app.open(); } catch (e) {}
    WM._launchAppId = null;
  }

  function enterDesktop() {
    if (deskReady) return;
    deskReady = true;
    const desktop = $("#desktop");
    const icons = desktop.querySelector(".icons");
    // Apps now live in the taskbar's Quick Launch strip (built in initTaskbar),
    // so the desktop stays clear — more room for the cozy nighttime scene, and
    // plenty of headroom as we add more apps.
    if (icons) icons.innerHTML = "";

    initAmbient();
    initTaskbar();
    startClock();

    // start the calm lo-fi background loop (audio ctx is already awake by now)
    try { Sound && Sound.ambientStart && Sound.ambientStart(); } catch (e) {}

    // the presence engine: music follows the mouse; silence gets suspicious
    try { global.Presence && Presence.start(); } catch (e) {}

    // Spud the Potato takes his seat on the taskbar
    try { global.Spud && Spud.init(); } catch (e) {}

    // a warm little welcome popup
    setTimeout(() => {
      WM.error({
        title: "Welcome to CaptchaOS",
        tico: "👋", icon: "☺",
        msg: "You are logged in. Try the Cozle Browser — search anything, then click a result. What could possibly go wrong?",
        buttons: [{ label: "Thanks", primary: true }],
        sound: false
      });
    }, 700);
  }

  /* ---------------- TASKBAR / START MENU / CLOCK ---------------- */
  function initTaskbar() {
    const btn = $("#startbtn");
    const menu = $("#startmenu");
    const items = menu.querySelector(".items");
    const mute = $("#mute");
    const quick = $("#quicklaunch");

    // Quick Launch: one pixel-icon per app, docked on the taskbar. Transparent
    // (no chrome box), name on hover (native tooltip), and an Ubuntu-style lit
    // dot under any app that currently has a window open. This is where apps
    // live now, so the desktop stays clear and new apps just slot in.
    if (quick) {
      quick.innerHTML = "";
      APPS.forEach((app) => {
        const q = document.createElement("div");
        q.className = "qlicon";
        q.dataset.app = app.id;
        q.title = app.label;                       // hover tooltip
        q.setAttribute("role", "button");
        q.setAttribute("aria-label", app.label);
        q.innerHTML = '<span class="ql-glyph">' + iconFor(app) + '</span>' +
                      '<span class="ql-dot"></span>' +
                      '<span class="ql-tip">' + app.label + '</span>';
        q.onclick = () => {
          try { Sound && Sound.click(); } catch (e) {}
          q.classList.add("bounce");
          setTimeout(() => q.classList.remove("bounce"), 320);
          launch(app);
        };
        quick.appendChild(q);
      });
      // reflect running apps whenever the window set changes
      const paintRunning = () => {
        let running; try { running = WM.runningAppIds(); } catch (e) { running = new Set(); }
        quick.querySelectorAll(".qlicon").forEach((el) =>
          el.classList.toggle("running", running.has(el.dataset.app)));
      };
      window.addEventListener("wm:changed", paintRunning);
      paintRunning();
    }

    // build start menu from APPS + a separator + a "log off"
    items.innerHTML = "";
    APPS.forEach((app) => {
      const it = document.createElement("div");
      it.className = "smitem";
      it.innerHTML = `<span class="g">${app.icon}</span><span>${app.label}</span>`;
      it.onclick = () => { closeMenu(); try { Sound && Sound.click(); } catch (e) {} launch(app); };
      items.appendChild(it);
    });
    const sep = document.createElement("div");
    sep.className = "smsep";
    items.appendChild(sep);
    const logoff = document.createElement("div");
    logoff.className = "smitem";
    logoff.innerHTML = `<span class="g">🚪</span><span>Log Off…</span>`;
    logoff.onclick = () => {
      closeMenu();
      WM.error({
        title: "Log Off", tico: "🚪", icon: "🤔",
        msg: "Logging off would only make you verify all over again. Stay a while.",
        buttons: [{ label: "Fine", primary: true }], sound: false
      });
    };
    items.appendChild(logoff);

    function openMenu() { menu.classList.add("open"); btn.classList.add("open"); }
    function closeMenu() { menu.classList.remove("open"); btn.classList.remove("open"); }
    function toggleMenu() { menu.classList.contains("open") ? closeMenu() : openMenu(); }

    btn.onclick = (e) => { e.stopPropagation(); try { Sound && Sound.click(); } catch (e) {} toggleMenu(); };
    document.addEventListener("pointerdown", (e) => {
      if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu();
    });

    mute.onclick = () => {
      const now = !Sound.isMuted();
      Sound.mute(now);
      mute.textContent = now ? "🔇" : "🔊";
      if (!now) try { Sound.tick(); } catch (e) {}
    };
  }

  function startClock() {
    const clock = $("#clock");
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    const paint = () => {
      const d = new Date();
      let h = d.getHours();
      const ap = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      // HH:MM with live-ticking seconds, so the taskbar clock feels alive
      clock.innerHTML =
        `${h}:${pad(d.getMinutes())}<span class="sec">:${pad(d.getSeconds())}</span> ${ap}`;
      clock.title = d.toLocaleDateString(undefined,
        { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    };
    paint();
    setInterval(paint, 1000);
  }

  /* ---------------- ambient nighttime scene ----------------
     Populates the desktop with twinkling stars + gentle rain.
     Everything animates via CSS; we only scatter the elements.   */
  let ambientReady = false;
  function initAmbient() {
    if (ambientReady) return;
    ambientReady = true;
    const desktop = $("#desktop");
    if (!desktop) return;
    const rnd = (a, b) => a + Math.random() * (b - a);

    const stars = desktop.querySelector(".stars");
    if (stars && !stars.childElementCount) {
      const frag = document.createDocumentFragment();
      for (let n = 0; n < 80; n++) {
        const s = document.createElement("i");
        const bright = Math.random() < 0.15;
        const sz = bright ? (Math.random() < 0.5 ? 2 : 3)
                          : (Math.random() < 0.7 ? 1 : 2);
        s.style.width = s.style.height = sz + "px";
        s.style.left = rnd(0, 100).toFixed(2) + "%";
        s.style.top = rnd(0, 100).toFixed(2) + "%";
        s.style.setProperty("--td", rnd(0, 4).toFixed(2) + "s");
        s.style.setProperty("--tw", rnd(2.4, 5).toFixed(2) + "s");
        const tint = Math.random();
        if (tint < 0.30) s.classList.add("warm");
        else if (tint < 0.55) s.classList.add("cool");
        if (bright) s.classList.add("bright");
        frag.appendChild(s);
      }
      stars.appendChild(frag);
    }

    const rain = desktop.querySelector(".rain");
    if (rain && !rain.childElementCount) {
      const frag = document.createDocumentFragment();
      for (let n = 0; n < 54; n++) {
        const d = document.createElement("i");
        d.style.left = rnd(0, 100).toFixed(2) + "%";
        d.style.height = rnd(10, 20).toFixed(0) + "px";
        d.style.opacity = rnd(0.3, 0.75).toFixed(2);
        d.style.animationDelay = "-" + rnd(0, 4).toFixed(2) + "s";
        d.style.animationDuration = rnd(1.6, 3.2).toFixed(2) + "s"; // slow = calm
        frag.appendChild(d);
      }
      rain.appendChild(frag);
    }
  }

  /* ---------------- filler apps ---------------- */
  function openNotepad() {
    const body = document.createElement("div");
    body.className = "pad";
    body.innerHTML =
      `<textarea spellcheck="false" placeholder="Dear diary, today the operating system asked me to prove I was human 6 times before breakfast…"></textarea>`;
    WM.open({ title: "Untitled — Notepad", icon: "📝", width: 380, height: 300,
      resizable: true, content: body, className: "appwin" });
  }

  function openControlPanel() {
    WM.error({
      title: "Control Panel",
      tico: "🎛️", icon: "🔒",
      msg: "Settings are locked. To change your settings, please first verify you are human.",
      buttons: [
        { label: "Verify", primary: true, act: () => Gauntlet.popup({ title: "Settings Verification" }) },
        { label: "Cancel" }
      ],
      sound: false
    });
  }


  /* ---------------- debug routing (query-string deep links) ----------------
     ?go=login        -> jump to the login gauntlet
     ?go=desktop      -> skip boot + login, straight to desktop
     ?cap=2           -> desktop + pop the bolt (two-bolt) captcha
     ?cap=1           -> desktop + a random captcha
     ?cap=traffic|pattern|grid|checkbox|text|mechanical
     ?q=something     -> desktop + browser already searching "something"     */
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const CAP_TYPES = ["checkbox", "grid", "traffic", "mechanical", "nut", "pattern", "text"];

  function getParams() {
    const out = {};
    const s = ((global.location && global.location.search) || "").replace(/^\?/, "");
    s.split("&").forEach((kv) => {
      if (!kv) return;
      const i = kv.indexOf("=");
      const k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      const v = i < 0 ? "" : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
      out[k] = v;
    });
    return out;
  }

  function capTypeFor(v) {
    v = String(v).toLowerCase();
    if (v === "2" || v === "bolt") return "mechanical";
    if (v === "1" || v === "any" || v === "") return pick(["grid", "traffic", "mechanical", "nut", "pattern", "checkbox"]);
    return CAP_TYPES.indexOf(v) >= 0 ? v : pick(["grid", "traffic", "mechanical", "nut", "pattern"]);
  }

  function toDesktop() {
    $("#boot").classList.add("hidden");
    $("#login").classList.add("hidden");
    enterDesktop();
  }

  /* returns true if a route was handled (so we skip the normal boot) */
  function route(p) {
    const cap = ("cap" in p) ? p.cap : (("queue" in p) ? p.queue : null);
    if (p.go === "login" || "login" in p) { showLogin(); return true; }
    if (p.go === "desktop" || cap != null || p.q != null ||
        p.snake != null || "finale" in p || "desktop" in p ||
        "audiocheck" in p || "idle" in p || "spud" in p || "spudpet" in p ||
        "brew" in p || "radio" in p) {
      toDesktop();
      if (cap != null) setTimeout(() => Gauntlet.popup({ type: capTypeFor(cap) }), 150);
      if (p.q != null) setTimeout(() => Browser.open({ q: p.q }), cap != null ? 400 : 150);
      if (p.snake != null) setTimeout(() => Snake.open({ level: parseInt(p.snake, 10) || 1 }), 150);
      if ("finale" in p) setTimeout(() => Finale.play(), 150);
      if ("spudpet" in p) setTimeout(() => SpudPet.open(), 150);
      if ("brew" in p) setTimeout(() => Brew.open(), 150);
      if ("radio" in p) setTimeout(() => Radio.open(), 150);
      return true;
    }
    return false;
  }

  /* ---------------- start ---------------- */
  function start() {
    // resume audio on first interaction (browsers block autoplay)
    const wake = () => { try { Sound && Sound.resume(); } catch (e) {} };
    document.addEventListener("pointerdown", wake, { once: true });
    document.addEventListener("keydown", wake, { once: true });
    try {
      console.log("%cCaptchaOS test routes:", "font-weight:bold;color:#6a5bc4",
        "\n  ?go=login   ?go=desktop" +
        "\n  ?cap=1 (random)  ?cap=2 (bolt)  ?cap=traffic|pattern|grid|checkbox|text|mechanical|nut" +
        "\n  ?q=term    (open browser + search)" +
        "\n  ?snake=2   (start Snake at level N: 2=glitch storm, 3=near finale)" +
        "\n  ?finale=1  (jump straight to the rickroll finale)" +
        "\n  ?audiocheck=1 (pop the Alive Test takeover now)" +
        "\n  ?idle=fast    (short idle timers: 1.5s fade, 20s check)" +
        "\n  ?spud=0|1|2|3 (preview Spud's mood: friendly→observant→suspicious→predictive)");
    } catch (e) {}
    if (route(getParams())) return;
    boot();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();

  global.OS = { boot, route, getParams };
})(window);