/* ============================================================
   Captcha Engine — the heart of the prank.
   Types: checkbox, emoji grid, traffic lights, bolt removal.
   Escalates: solve 3-7 in a row -> rickroll finale.
   ============================================================ */
(function (global) {
  const R = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = R(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const state = {
    solved: 0,       // total captchas ever solved this session
    streak: 0,       // solved back-to-back inside the current gauntlet
    fails: 0,        // total wrong answers this session (watched by Spud)
    inFinale: false
  };

  // registry of captcha type builders (filled below)
  const TYPES = {};

  /* ---- shared foot (the "I'm not a robot" strip + verify) ---- */
  function foot(verifyLabel) {
    return `
      <div class="cap-msg"></div>
      <div class="foot">
        <div class="robo"><span>🤖</span><span>reCAPCHA</span></div>
        <div class="btn primary verify">${verifyLabel || "Verify"}</div>
      </div>
      <div class="cap-counter"></div>`;
  }
  function wireCounter(host) {
    const c = host.querySelector(".cap-counter");
    if (c) c.textContent = "Privacy · Terms · You are human #" + (state.solved + 1);
  }
  function setMsg(host, t, cls) {
    const m = host.querySelector(".cap-msg");
    if (!m) return;
    m.textContent = t || "";
    m.className = "cap-msg " + (cls || "");
  }

  /* ============ TYPE: checkbox "I'm not a robot" ============ */
  TYPES.checkbox = function (host, api) {
    host.classList.add("cap");
    host.innerHTML = `
      <div class="cbx-wrap bevel-in" style="margin:14px">
        <div class="cbx"></div>
        <div style="font-size:22px">I'm not a robot</div>
      </div>
      <div class="cap-msg"></div>
      <div class="cap-counter"></div>`;
    wireCounter(host);
    const box = host.querySelector(".cbx");
    box.onclick = () => {
      if (box.classList.contains("on")) return;
      Sound && Sound.tick();
      box.classList.add("loading");
      setMsg(host, "Verifying you have a soul…");
      setTimeout(() => {
        box.classList.remove("loading");
        // 55% of the time it just "passes"; otherwise escalate to a grid
        if (Math.random() < 0.55) {
          box.classList.add("on");
          setMsg(host, "Hmm, we'll allow it.", "good");
          Sound && Sound.good();
          setTimeout(api.solve, 500);
        } else {
          setMsg(host, "Our systems detected unusual soul activity.", "bad");
          Sound && Sound.error();
          setTimeout(() => TYPES.grid(host, api), 700);
        }
      }, 900);
    };
  };

  /* ============ TYPE: emoji grid "select all X" ============ */
  const GRID_ROUNDS = [
    { q: "traffic lights", ans: "🚦", noise: ["🚗", "🌳", "🏠", "🛑", "🚕", "🌂", "🚦"] },
    { q: "buses",          ans: "🚌", noise: ["🚗", "🚕", "🚙", "🛵", "🚌", "🚚", "🏠"] },
    { q: "cats",           ans: "🐱", noise: ["🐶", "🐰", "🦊", "🐱", "🐭", "🐻", "🌵"] },
    { q: "crosswalks",     ans: "🚸", noise: ["🛣️", "🚧", "🚸", "🛑", "🌉", "🏗️", "🅿️"] },
    { q: "existential dread", ans: "💀", noise: ["🌈", "🧁", "💀", "🎈", "☀️", "🍀", "🦄"] }
  ];
  TYPES.grid = function (host, api, round) {
    host.classList.add("cap");
    round = round || pick(GRID_ROUNDS);
    // build 9 cells, 2-4 correct
    const nCorrect = R(2, 4);
    const cells = [];
    for (let i = 0; i < nCorrect; i++) cells.push(round.ans);
    while (cells.length < 9) cells.push(pick(round.noise.filter(x => x !== round.ans)));
    const grid = shuffle(cells);

    host.innerHTML = `
      <div class="banner">
        <div class="k">SELECT ALL IMAGES WITH</div>
        <div class="q"><b>${round.q}</b></div>
      </div>
      <div class="grid">
        ${grid.map((e, i) => `<div class="cell" data-i="${i}" data-e="${e}">${e}</div>`).join("")}
      </div>
      ${foot("Verify")}`;
    wireCounter(host);

    host.querySelectorAll(".cell").forEach((c) => {
      c.onclick = () => { c.classList.toggle("sel"); Sound && Sound.tick(); };
    });
    host.querySelector(".verify").onclick = () => {
      const sel = [...host.querySelectorAll(".cell.sel")];
      const all = [...host.querySelectorAll(".cell")];
      const ok = all.every(c =>
        (c.dataset.e === round.ans) === c.classList.contains("sel")
      ) && sel.length > 0;
      if (ok) { Sound && Sound.good(); setMsg(host, "Barely convincing. Fine.", "good"); setTimeout(api.solve, 450); }
      else {
        Sound && Sound.error();
        setMsg(host, "That's not quite " + round.q + ". Try again, human.", "bad");
        api.fail && api.fail();
        setTimeout(() => TYPES.grid(host, api), 800); // new board
      }
    };
  };

  /* ============ TYPE: THE traffic lights captcha ============
     A single cozy 2D pixel scene (sky, buildings, road) with a real
     traffic-light pole, and a 4x4 selection grid laid over it. You tick
     the squares the traffic light occupies (a vertical run in one column). */
  TYPES.traffic = function (host, api) {
    host.classList.add("cap");
    const N = 4;                       // 4x4 grid over the scene
    const col = R(0, N - 1);           // which column the pole stands in
    const topRow = R(0, 1);            // head starts in row 0 or 1
    // the traffic-light HEAD (the lamp box) spans two stacked cells — that,
    // not the thin pole beneath it, is what counts as "the traffic light"
    const correct = new Set([topRow * N + col, (topRow + 1) * N + col]);

    // cozy pixel scene props (a couple of clouds + buildings for vibe)
    const cells = [...Array(N * N).keys()].map(i =>
      `<div class="tl-cell" data-i="${i}"></div>`).join("");

    host.innerHTML = `
      <div class="banner">
        <div class="k">SELECT ALL SQUARES WITH</div>
        <div class="q"><b>traffic lights</b></div>
      </div>
      <div class="tl-scene-wrap">
        <div class="tl-scene">
          <div class="tl-sun"></div>
          <div class="tl-cloud c1"></div>
          <div class="tl-cloud c2"></div>
          <div class="tl-city"></div>
          <div class="tl-road"></div>
          <div class="tl-light" style="left:${col * 25}%">
            <div class="tl-pole" style="top:${topRow * 25 + 13}%"></div>
            <div class="tl-head" style="top:${topRow * 25 + 2}%">
              <span class="tl-lamp r"></span>
              <span class="tl-lamp y"></span>
              <span class="tl-lamp g"></span>
            </div>
          </div>
          <div class="tl-grid">${cells}</div>
        </div>
      </div>
      ${foot("Verify")}`;
    wireCounter(host);

    host.querySelectorAll(".tl-cell").forEach(c =>
      c.onclick = () => { c.classList.toggle("sel"); Sound && Sound.tick(); });

    host.querySelector(".verify").onclick = () => {
      const all = [...host.querySelectorAll(".tl-cell")];
      const anySel = all.some(c => c.classList.contains("sel"));
      const ok = anySel && all.every((c, i) => correct.has(i) === c.classList.contains("sel"));
      if (ok) {
        Sound && Sound.good();
        setMsg(host, "You clearly stop at reds. Approved.", "good");
        setTimeout(api.solve, 450);
      } else {
        Sound && Sound.error(); api.fail && api.fail();
        setMsg(host, "That's not quite the traffic light. Look again.", "bad");
        setTimeout(() => TYPES.traffic(host, api), 850);
      }
    };
  };

  /* ============ TYPE: bolt / screw removal ============
     Select a bolt, then hold ← / → to unscrew it out.        */
  TYPES.bolt = function (host, api) {
    host.classList.add("cap");
    const nBolts = R(3, 4);
    host.innerHTML = `
      <div class="banner">
        <div class="k">SECURITY CHECK</div>
        <div class="q">Remove every <b>bolt</b> from the plate</div>
      </div>
      <div class="cap-stage">
        <div class="bolt-plate" tabindex="0"></div>
      </div>
      <div class="cap-help">Click a bolt to grab it, then hold <b>←</b> / <b>→</b> to unscrew.</div>
      <div class="cap-msg"></div>
      <div class="cap-counter"></div>`;
    wireCounter(host);
    const plate = host.querySelector(".bolt-plate");
    const positions = [[14, 14], [166, 14], [14, 96], [166, 96]];
    const bolts = [];
    for (let i = 0; i < nBolts; i++) {
      const b = document.createElement("div");
      b.className = "bolt";
      b.style.left = positions[i][0] + "px";
      b.style.top = positions[i][1] + "px";
      b.dataset.turns = 0;
      b.dataset.need = R(6, 9);
      plate.appendChild(b);
      bolts.push(b);
    }
    let active = null;
    const select = (b) => {
      bolts.forEach(x => x.classList.remove("active"));
      active = b; if (b) b.classList.add("active");
      plate.focus();
    };
    bolts.forEach(b => b.onclick = () => { Sound && Sound.tick(); select(b); setMsg(host, "Bolt grabbed. Hold ← / → to spin it out."); });
    select(bolts[0]);

    const spin = () => {
      if (!active) return;
      let t = +active.dataset.turns + 1;
      active.dataset.turns = t;
      active.classList.remove("spinning"); void active.offsetWidth; active.classList.add("spinning");
      Sound && Sound.tick();
      if (t >= +active.dataset.need) {
        active.classList.add("out");
        Sound && Sound.eat();
        const done = active;
        active = null;
        setTimeout(() => { done.remove(); }, 320);
        const left = bolts.filter(x => !x.classList.contains("out"));
        if (left.length) { select(left[0]); setMsg(host, left.length + " bolt(s) left. Keep going.", ""); }
        else { setMsg(host, "Plate cleared. You may pass.", "good"); Sound && Sound.good(); setTimeout(api.solve, 500); }
      }
    };
    const keyHandler = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); spin(); }
    };
    plate.addEventListener("keydown", keyHandler);
    // also allow global arrows while this captcha is focused-ish
    host._boltKey = keyHandler;
    host.tabIndex = 0;
    host.addEventListener("keydown", keyHandler);
    setTimeout(() => plate.focus(), 50);
  };

  /* ============ TYPE: MECHANICAL — two-bolt split controls ============
     Two 2D hex nuts, each with an arrow pointing at it. The LEFT bolt
     ONLY unscrews with the ← key; the RIGHT bolt ONLY with →. One is
     "reverse-threaded" — nobody expects opposite keys. Tricky & fun.   */
  TYPES.mechanical = function (host, api) {
    host.classList.add("cap");
    host.innerHTML = `
      <div class="banner">
        <div class="k">VERIFY HUMANITY</div>
        <div class="q">Unscrew <b>both</b> bolts to continue</div>
      </div>
      <div class="cap-stage">
        <div class="mech2">
          <div class="mbolt" data-key="ArrowLeft">
            <div class="mkey">← LEFT arrow</div>
            <div class="marrow">▼</div>
            <div class="mnut"><div class="mbolt-head"></div></div>
            <div class="mprog"><i></i></div>
            <div class="mtag">standard thread</div>
          </div>
          <div class="mbolt" data-key="ArrowRight">
            <div class="mkey">RIGHT arrow →</div>
            <div class="marrow">▼</div>
            <div class="mnut"><div class="mbolt-head"></div></div>
            <div class="mprog"><i></i></div>
            <div class="mtag">reverse thread</div>
          </div>
        </div>
      </div>
      <div class="cap-help">Left bolt spins only with <b>&larr;</b>, right bolt only with <b>&rarr;</b>. Yes — opposite keys. Trust us.</div>
      <div class="cap-msg"></div>
      <div class="cap-counter"></div>`;
    wireCounter(host);
    setMsg(host, "Two bolts, two different keys. Get tapping.");

    const bolts = [...host.querySelectorAll(".mbolt")].map((el) => ({
      el, key: el.dataset.key,
      head: el.querySelector(".mbolt-head"),
      fill: el.querySelector(".mprog > i"),
      turns: 0, need: R(12, 16), rot: 0, done: false
    }));
    let done = false;

    function onKey(e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      if (done) return;
      const b = bolts.find((x) => x.key === e.key && !x.done);
      if (!b) return;                                   // that bolt is already out
      b.turns++;
      b.rot += (e.key === "ArrowLeft" ? -40 : 40);      // tracked rotation state
      b.head.style.transform = `rotate(${b.rot}deg)`;
      b.fill.style.width = Math.min(100, (b.turns / b.need) * 100) + "%";
      Sound && Sound.tick();
      if (b.turns >= b.need) popOut(b);
    }

    function popOut(b) {
      b.done = true;
      b.el.classList.add("done");
      Sound && Sound.eat();
      const left = bolts.filter((x) => !x.done);
      if (left.length) {
        const k = left[0].key === "ArrowLeft" ? "LEFT (←)" : "RIGHT (→)";
        setMsg(host, "One down! Now the " + k + " bolt.", "");
      } else {
        done = true;
        cleanup();
        setMsg(host, "Both bolts removed. You may pass.", "good");
        Sound && Sound.good();
        setTimeout(api.solve, 550);
      }
    }

    function cleanup() {
      document.removeEventListener("keydown", onKey, true);
      clearInterval(watch);
    }

    // safety: if the window/veil closes mid-captcha, stop listening
    const watch = setInterval(() => { if (!host.isConnected) cleanup(); }, 400);
    document.addEventListener("keydown", onKey, true);
  };

  /* ============ TYPE: NUT — match the reference by rotating the nut ============
     One upright bolt with a hex nut on the thread. ← screws it up, → screws it
     down; land it where the little reference bolt shows, then Verify.          */
  TYPES.nut = function (host, api) {
    host.classList.add("cap", "nutcap");
    const STEP = 100 / 14;          // ~14 taps across the whole thread
    const TOL = 6;                  // how close counts as matched
    let target = 0, pos = 0;

    function newTarget() {          // land it low-ish, snapped near a step, away from the top
      target = Math.round((28 + Math.random() * 52) / STEP) * STEP;
    }
    newTarget();

    host.innerHTML = `
      <div class="banner">
        <div class="k">MATCH THE REFERENCE IMAGE BY</div>
        <div class="q">rotating the <b>nut</b></div>
      </div>
      <div class="nc-body">
        <div class="nc-ref" title="Reference">
          <div class="nc-mini nc-bolt">
            <div class="nc-head"></div>
            <div class="nc-track"><div class="nc-shaft"></div><div class="nc-nut ref"></div></div>
          </div>
        </div>
        <div class="nc-stage">
          <div class="nc-bolt">
            <div class="nc-head"></div>
            <div class="nc-track"><div class="nc-shaft"></div><div class="nc-nut live"></div></div>
          </div>
        </div>
        <div class="nc-controls">
          <div class="nc-arrow" data-d="-1" title="Turn left (up)">&larr;</div>
          <div class="nc-arrow" data-d="1" title="Turn right (down)">&rarr;</div>
        </div>
      </div>
      <div class="cap-msg"></div>
      <div class="nc-foot">
        <div class="nc-refresh" title="New reference">&#x21BB;</div>
        <div class="btn primary verify">Verify</div>
      </div>
      <div class="cap-counter"></div>`;
    wireCounter(host);

    const liveNut = host.querySelector(".nc-nut.live");
    const refNut  = host.querySelector(".nc-nut.ref");
    const paint = () => {
      liveNut.style.setProperty("--pos", pos.toFixed(2));
      refNut.style.setProperty("--pos", target.toFixed(2));
    };
    paint();

    function turn(dir) {
      pos = Math.max(0, Math.min(100, pos + dir * STEP));
      liveNut.classList.remove("turn"); void liveNut.offsetWidth; liveNut.classList.add("turn");
      Sound && Sound.tick();
      setMsg(host, "");
      paint();
    }

    host.querySelectorAll(".nc-arrow").forEach((a) =>
      (a.onclick = () => turn(parseInt(a.dataset.d, 10))));

    function onKey(e) {
      if (e.key === "ArrowLeft")  { e.preventDefault(); turn(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); turn(1); }
    }
    document.addEventListener("keydown", onKey, true);
    const watch = setInterval(() => {
      if (!host.isConnected) { document.removeEventListener("keydown", onKey, true); clearInterval(watch); }
    }, 400);

    host.querySelector(".nc-refresh").onclick = () => {
      newTarget(); pos = 0; paint();
      setMsg(host, "New reference. Match it.", "");
      Sound && Sound.click();
    };

    host.querySelector(".verify").onclick = () => {
      if (Math.abs(pos - target) <= TOL) {
        setMsg(host, "Torqued to spec. You may pass.", "good");
        Sound && Sound.good();
        liveNut.classList.add("locked");
        document.removeEventListener("keydown", onKey, true);
        setTimeout(api.solve, 450);
      } else {
        const dir = pos < target ? "down (→)" : "up (←)";
        setMsg(host, "Not aligned. Turn the nut " + dir + " to match.", "bad");
        Sound && Sound.error(); api.fail && api.fail();
      }
    };
  };

  /* ============ TYPE: absurd multi-stage TEXT captcha ============
     Driven by a `spec` produced by makeLoginSpecs(). Input-only:
     one prompt, optional distorted glyph, a text field + Verify.   */
  TYPES.text = function (host, api, spec) {
    host.classList.add("cap");
    spec = spec || makeLoginSpecs()[0];
    host.innerHTML = `
      <div class="banner">
        <div class="k">${spec.k || "HUMAN VERIFICATION"}</div>
        <div class="q">${spec.prompt}</div>
      </div>
      ${spec.glyph ? `<div class="cap-glyph">${spec.glyph}</div>` : ""}
      ${spec.note ? `<div class="cap-note">${spec.note}</div>` : ""}
      <div class="cap-inwrap">
        <input class="cap-input bevel-in" type="text" autocomplete="off"
               autocapitalize="off" autocorrect="off" spellcheck="false"
               placeholder="${spec.placeholder || "type your answer"}">
      </div>
      ${foot("Verify")}`;
    wireCounter(host);
    const input = host.querySelector(".cap-input");
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 40);

    const submit = () => {
      const raw = input.value;
      if (!raw.trim()) { setMsg(host, "Type something first, human.", "bad"); Sound && Sound.tick(); return; }
      if (spec.check(raw)) {
        Sound && Sound.good();
        setMsg(host, spec.ok || "Verified. Barely.", "good");
        input.disabled = true;
        host.querySelector(".verify").style.pointerEvents = "none";
        setTimeout(api.solve, 430);
      } else {
        Sound && Sound.error();
        setMsg(host, spec.bad || "Incorrect. Are you sure you're human?", "bad");
        api.fail && api.fail();
        try { input.select(); } catch (e) {}
      }
    };
    host.querySelector(".verify").onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  };

  /* normalize a free-text answer for lenient comparison */
  function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ""); }

  /* Build the login gauntlet: 6 increasingly absurd text challenges.
     Content is randomized each call; order stays fixed & escalating.  */
  function makeLoginSpecs() {
    const eq = (a) => (v) => norm(v) === norm(a);

    // 1. read distorted characters
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 5; i++) code += abc[R(0, abc.length - 1)];
    const distort = code.split("").map((ch) =>
      `<span style="display:inline-block;transform:rotate(${R(-30, 30)}deg) skewX(${R(-20, 20)}deg) scale(${(R(85, 130) / 100).toFixed(2)});margin:0 ${R(2, 7)}px;opacity:${(R(70, 100) / 100).toFixed(2)}">${ch}</span>`
    ).join("");

    // 2. type a word backwards
    const w2 = pick(["COZY", "PIXEL", "MODEM", "FLOPPY", "GREMLIN", "NOODLE"]);
    const w2rev = w2.split("").reverse().join("");

    // 3. count the letter "o"
    const p3 = pick([
      "a good robot took a photo of the moon",
      "too soon to know how to boot",
      "cool doodles of goofy moody goblins",
      "ноpe — a lonely loop of foolish glory".replace("но", "no")
    ]);
    const n3 = (p3.match(/o/g) || []).length;

    // 4. replace vowels with the digit 3
    const w4 = pick(["captcha", "password", "keyboard", "welcome", "computer"]);
    const w4ans = w4.replace(/[aeiou]/gi, "3");

    // 5. cats × socks multiplication
    const cats = R(3, 7), socks = R(2, 5);

    // 6. type word #N of this SHORT phrase (spaces let it wrap; can't be clipped)
    const s6 = "cozy pixel modem dream";
    const words6 = s6.split(" ");
    const n6 = R(2, words6.length);
    const s6glyph = words6.map((w) => `<span style="margin:0 4px">${w}</span>`).join(" ");

    return [
      {
        k: "STEP 1 / 6 · OPTICAL",
        prompt: "Type the characters you see:",
        glyph: distort,
        placeholder: "5 characters",
        ok: "Recognized. Suspicious, but recognized.",
        bad: "Those aren't the characters. Look harder.",
        check: (v) => norm(v) === norm(code)
      },
      {
        k: "STEP 2 / 6 · REVERSAL",
        prompt: `Type this word <b>backwards</b>: <b>${w2}</b>`,
        placeholder: "the word, reversed",
        ok: "Backwards and correct. Weird, but fine.",
        bad: "That's not it backwards. A human would know.",
        check: eq(w2rev)
      },
      {
        k: "STEP 3 / 6 · ARITHMETIC",
        prompt: `How many times does the letter <b>"o"</b> appear below?`,
        glyph: `<span class="cap-quote">“${p3}”</span>`,
        placeholder: "a number",
        ok: "Correct count. Only a human counts o's for fun.",
        bad: "Wrong count. Recount every single 'o'.",
        check: (v) => parseInt(v, 10) === n3
      },
      {
        k: "STEP 4 / 6 · SUBSTITUTION",
        prompt: `Retype this word, replacing every vowel (a,e,i,o,u) with the digit <b>3</b>:`,
        glyph: `<span class="cap-quote">${w4}</span>`,
        placeholder: "the leetified word",
        ok: "Flawless leet. You may proceed.",
        bad: "A vowel survived. Try again, meatbag.",
        check: eq(w4ans)
      },
      {
        k: "STEP 5 / 6 · LOGIC",
        prompt: `A shop has <b>${cats} cats</b>. Each cat is wearing <b>${socks} socks</b>. How many socks are being worn in total?`,
        placeholder: "total socks",
        ok: "Math checks out. Barely human.",
        bad: "That's not how cats or socks work. Retry.",
        check: (v) => parseInt(v, 10) === cats * socks
      },
      {
        k: "STEP 6 / 6 · COMPREHENSION",
        prompt: `Type word number <b>${n6}</b> of this sentence (count from 1):`,
        glyph: `<span class="cap-quote">${s6glyph}</span>`,
        placeholder: `word #${n6}`,
        ok: "Access granted. Welcome, definitely-a-human.",
        bad: "Wrong word. Count again, slowly.",
        check: eq(words6[n6 - 1])
      }
    ];
  }

  /* ============ TYPE: "Identify the Pattern" ============
     A short sequence follows a rule; pick the tile that comes next. */
  const PATTERNS = [
    function () { // rotating arrows (cycle of 4)
      const arr = ["⬆️", "➡️", "⬇️", "⬅️"];
      const s = R(0, 3);
      return {
        seq: [arr[s], arr[(s + 1) % 4], arr[(s + 2) % 4]],
        answer: arr[(s + 3) % 4],
        opts: shuffle(arr.slice())
      };
    },
    function () { // growing squares
      const g = "🟦";
      return {
        seq: [g, g.repeat(2), g.repeat(3)],
        answer: g.repeat(4),
        opts: shuffle([g.repeat(4), g.repeat(2), g.repeat(3), g.repeat(6)])
      };
    },
    function () { // alternating moons
      return {
        seq: ["🌓", "🌕", "🌑"],
        answer: "🌓",
        opts: shuffle(["🌓", "🌑", "🌗", "🌒"])
      };
    },
    function () { // arithmetic number sequence
      const start = R(1, 5), step = R(2, 4);
      const answer = String(start + 3 * step);
      const set = new Set([answer]);
      const cands = [String(start + 3 * step + 1), String(start + 2 * step),
                     String(start + 4 * step), String(start + 3 * step - 1)];
      const opts = [answer];
      for (const c of cands) { if (!set.has(c) && opts.length < 4) { set.add(c); opts.push(c); } }
      while (opts.length < 4) { const x = String(start + 3 * step + opts.length + 2); if (!set.has(x)) { set.add(x); opts.push(x); } }
      return { seq: [start, start + step, start + 2 * step].map(String), answer, opts: shuffle(opts) };
    },
    function () { // color cycle
      const arr = ["🔴", "🟡", "🟢"];
      const s = R(0, 2);
      return {
        seq: [arr[s], arr[(s + 1) % 3], arr[(s + 2) % 3]],
        answer: arr[s],
        opts: shuffle(["🔴", "🟡", "🟢", "🔵"])
      };
    }
  ];
  TYPES.pattern = function (host, api, round) {
    host.classList.add("cap");
    const p = (typeof round === "function" ? round : pick(PATTERNS))();
    host.innerHTML = `
      <div class="banner">
        <div class="k">IDENTIFY THE PATTERN</div>
        <div class="q">Pick the tile that comes <b>next</b> in the sequence</div>
      </div>
      <div class="cap-seq">
        ${p.seq.map((s) => `<div class="cap-seqcell bevel-in">${s}</div>`).join("")}
        <div class="cap-seqcell cap-qcell">?</div>
      </div>
      <div class="cap-opts">
        ${p.opts.map((o, i) => `<div class="cap-opt bevel-out" data-i="${i}">${o}</div>`).join("")}
      </div>
      ${foot("Verify")}`;
    wireCounter(host);
    let sel = null;
    host.querySelectorAll(".cap-opt").forEach((el) => {
      el.onclick = () => {
        host.querySelectorAll(".cap-opt").forEach((x) => x.classList.remove("sel"));
        el.classList.add("sel"); sel = el.textContent; Sound && Sound.tick();
      };
    });
    host.querySelector(".verify").onclick = () => {
      if (sel == null) { setMsg(host, "Select a tile first.", "bad"); return; }
      if (sel === p.answer) {
        Sound && Sound.good(); setMsg(host, "Pattern recognized. Proceed.", "good");
        setTimeout(api.solve, 430);
      } else {
        Sound && Sound.error(); api.fail && api.fail();
        setMsg(host, "That breaks the pattern. Try again.", "bad");
        setTimeout(() => TYPES.pattern(host, api), 850);
      }
    };
  };

  /* ---- weighted type picker: harder types as solved grows ---- */
  function pickType(n) {
    if (n <= 0) return "checkbox";
    const bag = ["grid", "grid", "traffic"];
    if (n >= 2) bag.push("mechanical", "nut");    // the mechanical micro-games
    if (n >= 3) bag.push("traffic", "nut");
    return pick(bag);
  }

  /* Render ONE captcha into host; call onSolved when passed.
     opts: {type, round}. Wrong answers loop internally.        */
  function renderInto(host, onSolved, opts) {
    opts = opts || {};
    host.className = "cap-host";
    const type = opts.type || pickType(state.solved);
    const api = {
      solve() { state.solved++; if (onSolved) onSolved(); },
      fail() {
        state.fails++;
        // let context-aware watchers (Spud) know a human just slipped up
        try { global.dispatchEvent(new CustomEvent("captcha:fail", { detail: { fails: state.fails } })); } catch (e) {}
      }
    };
    if (type === "text") { TYPES.text(host, api, opts.spec); return; }
    if (type === "pattern") { TYPES.pattern(host, api, opts.round); return; }
    (TYPES[type] || TYPES.grid)(host, api, opts.round);
  }

  const Captcha = { state, TYPES, R, pick, shuffle, setMsg, pickType, renderInto, makeLoginSpecs };
  global.Captcha = Captcha;
})(window);