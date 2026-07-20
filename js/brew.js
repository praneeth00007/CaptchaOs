/* ============================================================
   brew.exe — a cozy café terminal that trusts your fingers even
   less than the rest of CaptchaOS trusts the rest of you.

   A text terminal in a WM window styled as a coffee-shop menu.
   Every keystroke passes through a Typing Rhythm Engine: type
   faster than a human can (<60ms between keys) and it decides
   you're a bot, prints a velocity error, and locks input for 5s.

   Commands are a plain ES6 object map + one regex for `brew X`.
     help          -> an ASCII-art pixel poem
     menu / ls     -> the drink list
     brew <drink>  -> procedural steam-hiss + drip audio, mints a
                      Coffee Item and tops up Spud-Pet's Caffeine
     sudo          -> a 5-stage CAPTCHA, locked to THIS window only
     clear/whoami/about

   Output history is capped at 50 lines (FIFO). All audio is
   synthesized on the shared AudioContext — no files.
   ============================================================ */
(function (global) {
  const MIN_MS = 60;                 // faster than this between keys => "bot"
  const LOCK_MS = 5000;              // input freeze on detection
  const MAX_LINES = 50;              // FIFO output cap

  /* the menu — caffeine is what each drink adds to Spud-Pet */
  const MENU = {
    espresso:    { caffeine: 30, temp: "scalding", note: "a tiny, furious cup" },
    americano:   { caffeine: 22, temp: "hot",      note: "espresso, diluted, brooding" },
    latte:       { caffeine: 18, temp: "warm",     note: "mostly milk, mildly judgmental" },
    cappuccino:  { caffeine: 20, temp: "warm",     note: "foam architecture" },
    cortado:     { caffeine: 16, temp: "warm",     note: "balanced. suspiciously so" },
    mocha:       { caffeine: 24, temp: "hot",      note: "chocolate bribe included" },
    decaf:       { caffeine: 2,  temp: "lukewarm", note: "why. just... why" }
  };

  const POEM = [
    "   .-\"\"\"\"\"-.",
    "  |  ~ ~ ~  |     steam climbs the window glass,",
    "  |  ~ ~ ~  |     the kettle keeps its counsel.",
    "  '-.......-'     you are, it insists, a machine —",
    "    |     |       so prove your hands can hesitate.",
    "   _|     |_      (brew slowly. it is watching.)"
  ];

  const BANNER = [
    "brew.exe  ·  CaptchaOS Coffee Terminal  v1.0",
    "type 'help' for the poem, 'menu' for drinks, 'sudo' if you dare.",
    ""
  ];

  function ctx() {
    let c = null;
    try { if (global.Sound && Sound.ctx) c = Sound.ctx(); } catch (e) {}
    if (!c) { const A = global.AudioContext || global.webkitAudioContext; c = new A(); }
    if (c.state === "suspended") c.resume();
    return c;
  }

  function open() {
    const body = document.createElement("div");
    body.className = "brew";
    body.innerHTML =
      '<div class="brew-out" aria-live="polite"></div>' +
      '<div class="brew-line">' +
        '<span class="brew-prompt">guest@brew:~$</span>' +
        '<input class="brew-in" autocomplete="off" autocapitalize="off" ' +
          'spellcheck="false" inputmode="text" aria-label="terminal input">' +
      '</div>' +
      '<div class="brew-sudo" hidden><div class="brew-sudo-inner"></div></div>';

    const win = WM.open({
      title: "brew.exe", icon: "☕", width: 420, height: 340,
      resizable: true, minW: 320, minH: 240, content: body,
      className: "appwin brewwin", onClose: cleanup
    });

    const out = body.querySelector(".brew-out");
    const input = body.querySelector(".brew-in");
    const sudoWrap = body.querySelector(".brew-sudo");
    const sudoInner = sudoWrap.querySelector(".brew-sudo-inner");

    let locked = false;               // input freeze (bot lockout OR sudo modal)
    let lastKeyT = null;
    let lockTimer = null;

    /* ---------- output + FIFO cap ---------- */
    function line(text, cls) {
      String(text).split("\n").forEach((ln) => {
        const el = document.createElement("div");
        el.className = "brew-ln" + (cls ? " " + cls : "");
        el.textContent = ln === "" ? " " : ln;
        out.appendChild(el);
        while (out.children.length > MAX_LINES) out.firstElementChild.remove();
      });
      out.scrollTop = out.scrollHeight;
    }
    function lines(arr, cls) { arr.forEach((l) => line(l, cls)); }

    BANNER.forEach((l) => line(l, "dim"));

    /* ---------- Typing Rhythm Engine ---------- */
    function botDetected(reason) {
      locked = true;
      input.value = "";
      input.disabled = true;
      line("ERROR: Keystroke velocity exceeded. Bot detected.", "err");
      line((reason || "inter-key latency below human floor") +
           " — input locked for 5 seconds.", "err dim");
      try { Sound && Sound.critical && Sound.critical(); } catch (e) {}
      clearTimeout(lockTimer);
      lockTimer = setTimeout(() => {
        locked = false; lastKeyT = null;
        input.disabled = false; input.focus();
        line("input restored. type like you mean it.", "dim");
      }, LOCK_MS);
    }

    input.addEventListener("keydown", (e) => {
      if (locked) { e.preventDefault(); return; }
      if (e.key === "Enter") { e.preventDefault(); submit(); return; }
      // only judge printable single characters
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = (global.performance || Date).now();
      if (lastKeyT != null && (t - lastKeyT) < MIN_MS) {
        e.preventDefault();
        botDetected("Δt=" + Math.round(t - lastKeyT) + "ms < " + MIN_MS + "ms");
        return;
      }
      lastKeyT = t;
    });
    // a paste dumps text instantly — no human latency at all
    input.addEventListener("paste", (e) => {
      if (locked) { e.preventDefault(); return; }
      e.preventDefault();
      botDetected("clipboard paste — zero keystroke latency");
    });

    /* ---------- command map ---------- */
    const COMMANDS = {
      help() { lines(POEM, "art"); },
      menu() {
        line("— today's menu —", "hd");
        Object.keys(MENU).forEach((k) => {
          const m = MENU[k];
          line("  brew " + k.padEnd(11) + "· +" + m.caffeine + " caffeine · " + m.note);
        });
      },
      ls() { line(Object.keys(MENU).join("  ")); },
      whoami() { line("guest — unverified human. suspicious by default."); },
      about() { lines(BANNER); },
      clear() { out.innerHTML = ""; },
      sudo() { openSudo(); },
      exit() { line("you can check out any time. the window stays."); }
    };

    function submit() {
      const raw = input.value.trim();
      input.value = "";
      lastKeyT = null;
      line("guest@brew:~$ " + raw, "echo");
      if (!raw) return;

      const brew = /^brew\s+([a-z]+)$/i.exec(raw);
      if (brew) { doBrew(brew[1].toLowerCase()); return; }

      const cmd = raw.split(/\s+/)[0].toLowerCase();
      if (COMMANDS[cmd]) { try { Sound && Sound.tick && Sound.tick(); } catch (e) {} COMMANDS[cmd](); }
      else line("command not found: " + cmd + "  (try 'help' or 'menu')", "err");
    }

    /* ---------- brew <drink>: procedural audio + Coffee Item ---------- */
    function doBrew(name) {
      const m = MENU[name];
      if (!m) { line("we don't serve '" + name + "' here. try 'menu'.", "err"); return; }
      line("brewing " + name + "…", "dim");
      brewSound();
      const item = {
        name: name, caffeine: m.caffeine, temp: m.temp,
        size: name === "espresso" ? "single" : "regular",
        ts: (global.performance || Date).now()
      };
      setTimeout(() => {
        line("☕ " + name + " ready — " + m.temp + ", +" + m.caffeine + " caffeine.", "ok");
        feedSpud(item);
      }, 1400);
    }

    // steam hiss (filtered noise swell) + a few liquid drips
    function brewSound() {
      const c = ctx();
      const t0 = c.currentTime;
      // --- steam hiss ---
      const n = Math.floor(c.sampleRate * 1.3);
      const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = buf;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 5200; bp.Q.value = 0.7;
      const hg = c.createGain();
      hg.gain.setValueAtTime(0.0001, t0);
      hg.gain.linearRampToValueAtTime(0.12, t0 + 0.25);
      hg.gain.linearRampToValueAtTime(0.08, t0 + 0.9);
      hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
      src.connect(bp).connect(hg).connect(c.destination);
      src.start(t0); src.stop(t0 + 1.32);
      // --- liquid drips: short descending sine plips ---
      for (let i = 0; i < 6; i++) {
        const dt = t0 + 0.5 + i * 0.14 + Math.random() * 0.05;
        const o = c.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(680 - i * 30 + Math.random() * 40, dt);
        o.frequency.exponentialRampToValueAtTime(180, dt + 0.09);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, dt);
        g.gain.linearRampToValueAtTime(0.14, dt + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.12);
        o.connect(g).connect(c.destination);
        o.start(dt); o.stop(dt + 0.13);
      }
    }

    function feedSpud(item) {
      try {
        if (global.SpudPet) {
          const s = SpudPet.state();
          SpudPet.set("caffeine", s.caffeine + item.caffeine);
          line("→ Spud-Pet caffeine: " + s.caffeine + " → " +
               SpudPet.state().caffeine, "dim");
        } else {
          line("(Spud-Pet is asleep — open spud_pet.exe to feel the buzz)", "dim");
        }
      } catch (e) {}
      return item;
    }

    /* ---------- sudo: 5-stage CAPTCHA, LOCAL to this window ---------- */
    const SUDO_STAGES = 5;
    function openSudo() {
      if (!global.Captcha) { line("sudo: security module offline.", "err"); return; }
      locked = true;                        // freeze only THIS terminal's input
      input.disabled = true;
      sudoWrap.hidden = false;
      let i = 0;
      const types = Captcha.shuffle(
        ["checkbox", "grid", "traffic", "mechanical", "nut", "pattern"]).slice(0, SUDO_STAGES);

      const bar = document.createElement("div");
      bar.className = "brew-sudo-bar";
      const closeBtn = document.createElement("div");
      closeBtn.className = "brew-sudo-x"; closeBtn.textContent = "abort sudo";
      const host = document.createElement("div");
      sudoInner.innerHTML = "";
      sudoInner.appendChild(bar);
      sudoInner.appendChild(closeBtn);
      sudoInner.appendChild(host);

      function endSudo(granted) {
        sudoWrap.hidden = true;
        sudoInner.innerHTML = "";
        locked = false; lastKeyT = null;
        input.disabled = false; input.focus();
        if (granted) {
          line("root access granted. (for 8 seconds. we're not monsters. we're worse.)", "ok");
          try { Sound && Sound.levelup && Sound.levelup(); } catch (e) {}
        } else {
          line("sudo: authentication cancelled. you remain a guest.", "err");
        }
      }
      closeBtn.onclick = () => endSudo(false);

      function step() {
        bar.textContent = "SUDO VERIFICATION · stage " + (i + 1) + " / " + SUDO_STAGES;
        host.innerHTML = "";
        Captcha.renderInto(host, () => {
          i++;
          if (i >= SUDO_STAGES) { endSudo(true); return; }
          try { Sound && Sound.good && Sound.good(); } catch (e) {}
          setTimeout(step, 450);
        }, { type: types[i] });
      }
      step();
    }

    function cleanup() {
      clearTimeout(lockTimer);
    }

    setTimeout(() => input.focus(), 60);
    return win;
  }

  global.Brew = { open };
})(window);
