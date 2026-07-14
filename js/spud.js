/* ============================================================
   Spud the Potato — the taskbar mascot who is, quietly, watching.

   He starts as your cozy tea buddy. But he keeps a running
   "suspicion" score fed by what you actually do — how long you go
   still, how frantically you click, how many captchas you flunk,
   what you hover over. As it climbs he moves through four moods:

     friendly  ->  observant  ->  suspicious  ->  predictive

   The body stays cozy the whole way (same bob, steam, blinks, tea
   sips). Only the WORDS turn unsettling — and, once he's suspicious,
   his pupils start tracking your cursor. He also interrupts you on
   his own now and then, rate-limited so it stays a surprise.
   ============================================================ */
(function (global) {
  const now = () => Date.now();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const prefersReduced = global.matchMedia &&
    global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- what Spud says, bucketed by mood ---- */
  const MOOD = [
    { name: "Spud", pool: [                               // 0 · friendly
      "Take it easy, friend ☕",
      "Cozy night for it, isn't it.",
      "Tea's warm. You're safe. Enjoy.",
      "No rush. I'm just here, sipping.",
      "Good to have real company for once."
    ]},
    { name: "Spud", pool: [                               // 1 · observant
      "You stopped moving...",
      "I saw the cursor rest just now.",
      "You've clicked a fair bit, you know.",
      "I keep track of little things. Habit.",
      "Still with me? I noticed the pause."
    ]},
    { name: "spud", pool: [                               // 2 · suspicious
      "Why did you hesitate there?",
      "That pause — what were you thinking?",
      "You moved differently that time.",
      "Bots hesitate like that too, by the way.",
      "I've been counting your clicks. Have you?"
    ]},
    { name: "SPUD", pool: [                               // 3 · predictive
      "You're about to click that, right?",
      "I already know where the cursor's going.",
      "You'll drift left in a second. …See?",
      "I knew you'd read this far.",
      "You won't close me. We both know that."
    ]}
  ];
  const CTX = {
    greet:   ["Take it easy, friend ☕"],
    idle:    ["You stopped moving...",
              "The stillness again. I notice.",
              "Frozen, or thinking? I can't tell anymore.",
              "You went quiet. I don't love the quiet."],
    repeat:  ["That's a lot of clicks for one potato.",
              "Clicking faster won't help. I've watched hundreds try.",
              "Easy — the buttons hear you the first time.",
              "Why hesitate, then click that much?"],
    fail:    ["Failed again? I'm not judging. I'm recording.",
              "The captcha doesn't trust you. Neither do I now.",
              "Even I could've passed that one. …I think.",
              "Another miss. I'm keeping a tally."],
    predict: ["You're about to click that, right?",
              "That one. Predictable.",
              "Go ahead. I already logged it.",
              "Mm. I saw that coming."],
    snake:   ["The snake got you. I watched the whole thing.",
              "Game over. I never trusted that snake either.",
              "You lost. The report says you hesitated.",
              "That's alright — reflexes aren't your thing. I'm a potato; I get it.",
              "Score noted. Filed under 'tried their best.'"]
  };

  /* ---- tuning ---- */
  const IDLE_NOTICE_MS = 5000;                 // stillness that earns a remark
  const REPEAT_WIN = 2500, REPEAT_N = 5;       // clicks/window that reads as frantic
  const GAP = [24000, 16000, 11000, 7000];     // min ms between unsolicited lines, by tier

  /* ---- state ---- */
  let suspicion = 0, curTier = 0;
  let lastMove = now(), idleNoticed = false, lastSpoke = 0;
  let clickTimes = [];
  let typing = false, currentLine = "", lastIdx = -1;
  let typeTimer = null, hideTimer = null, blinkTimer = null, sipTimer = null;
  let started = false;

  let spud, guy, eyes, nameEl, bubble, textEl;

  function tier() { return suspicion >= 80 ? 3 : suspicion >= 50 ? 2 : suspicion >= 25 ? 1 : 0; }
  function bump(v) { suspicion = clamp(suspicion + v, 0, 100); updateMood(); }

  function init() {
    if (started) return;
    spud = document.getElementById("spud");
    if (!spud) return;
    started = true;
    spud.hidden = false;
    guy = spud.querySelector(".spud-guy");
    eyes = spud.querySelector(".spud-eyes");
    nameEl = spud.querySelector(".sb-name");
    bubble = spud.querySelector(".spud-bubble");
    textEl = spud.querySelector(".sb-text");

    // debug: ?spud=0..3 previews a mood without waiting for the arc
    const qm = /[?&]spud=(\d)/.exec((global.location && global.location.search) || "");
    if (qm) suspicion = [10, 35, 62, 90][clamp(parseInt(qm[1], 10), 0, 3)];

    guy.addEventListener("click", onPoke);
    guy.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPoke(); }
    });
    document.addEventListener("pointerdown", (e) => {
      if (bubble.classList.contains("show") && !spud.contains(e.target)) hide();
    });

    // context signals — real actions only, so he never chirps just for opening an app
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("click", onAnyClick, true);
    window.addEventListener("captcha:fail", () => {        // fires from any launched app's captcha
      bump(13);
      speak(pick(CTX.fail), { minGap: 2500, prob: 1 });
    });
    window.addEventListener("snake:over", () => {          // lost a round of Snake
      bump(5);
      speak(pick(CTX.snake), { minGap: 2500, prob: 1 });
    });

    setInterval(poll, 1000);
    scheduleBlink();
    scheduleSip();
    updateMood();

    // the cozy opener, before he knows you (skipped if he's already wary,
    // e.g. when previewing a mood with ?spud=2)
    setTimeout(() => { if (tier() === 0 && say(CTX.greet[0])) lastSpoke = now(); }, 2600);
  }

  /* ---- the suspicion heartbeat ---- */
  function poll() {
    const still = now() - lastMove;
    if (still >= IDLE_NOTICE_MS) {
      suspicion += 0.8;                          // silence unnerves him
      if (!idleNoticed) {
        idleNoticed = true; bump(6);
        // at his most unsettling, stillness gets a predictive jab instead
        speak(pick(tier() >= 3 ? CTX.predict : CTX.idle), { prob: 0.9 });
      }
    } else {
      suspicion -= 0.15;                         // smooth motion calms him a little
    }
    suspicion += 0.08;                           // but the night is long, and he drifts up
    suspicion = clamp(suspicion, 0, 100);
    updateMood();
  }

  function updateMood() {
    if (!spud) return;
    const t = tier();
    for (let i = 0; i < 4; i++) spud.classList.toggle("mood-" + i, i === t);
    const watch = t >= 2 && !prefersReduced;
    spud.classList.toggle("watching", watch);
    if (!watch) resetPupils();
    if (t > curTier) speak(pick(MOOD[t].pool), { minGap: 5000, prob: 1 });  // announce the shift
    curTier = t;
  }

  /* ---- context listeners ---- */
  function onMove(e) {
    lastMove = now();
    idleNoticed = false;
    if (spud.classList.contains("watching")) trackPupils(e.clientX, e.clientY);
  }

  function onAnyClick() {
    const t = now();
    clickTimes.push(t);
    clickTimes = clickTimes.filter((x) => t - x < REPEAT_WIN);
    suspicion = clamp(suspicion + 1, 0, 100);
    if (clickTimes.length >= REPEAT_N) {
      clickTimes = [];
      bump(8);
      speak(pick(CTX.repeat), { prob: 0.85 });
    }
  }

  /* ---- pupils that follow the cursor once he's suspicious ---- */
  function trackPupils(x, y) {
    const es = eyes.querySelectorAll(".eye");
    es.forEach((eye) => {
      const r = eye.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const a = Math.atan2(dy, dx), mag = Math.min(1.8, Math.hypot(dx, dy) / 36);
      const b = eye.querySelector("b");
      if (b) b.style.transform = "translate(" + (Math.cos(a) * mag).toFixed(1) + "px," +
                                 (Math.sin(a) * mag).toFixed(1) + "px)";
    });
  }
  function resetPupils() {
    if (!eyes) return;
    eyes.querySelectorAll(".eye b").forEach((b) => { b.style.transform = ""; });
  }

  /* ---- idle animations (unchanged, always cozy) ---- */
  function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      if (!guy.classList.contains("sipping")) {
        eyes.classList.add("blink");
        setTimeout(() => eyes.classList.remove("blink"), 130);
        if (Math.random() < 0.3) setTimeout(() => {
          eyes.classList.add("blink");
          setTimeout(() => eyes.classList.remove("blink"), 120);
        }, 260);
      }
      scheduleBlink();
    }, rnd(2600, 6200));
  }
  function scheduleSip() {
    sipTimer = setTimeout(() => {
      if (!typing && !guy.classList.contains("sipping")) {
        guy.classList.add("sipping");
        try { Sound && Sound.sip && Sound.sip(); } catch (e) {}
        setTimeout(() => guy.classList.remove("sipping"), 1100);
      }
      scheduleSip();
    }, rnd(8000, 15000));
  }

  /* ---- talking ---- */
  function onPoke() {
    try { Sound && Sound.resume && Sound.resume(); } catch (e) {}
    suspicion = clamp(suspicion + 2, 0, 100);        // engaging him raises the stakes
    if (typing) { finishNow(); return; }
    say(pick(MOOD[tier()].pool));
    lastSpoke = now();
  }

  function pick(pool) {
    let i;
    do { i = Math.floor(Math.random() * pool.length); }
    while (i === lastIdx && pool.length > 1);
    lastIdx = i;
    return pool[i];
  }

  /* gated, unsolicited speech (respects mood cadence + the Activity Check) */
  function speak(line, opts) {
    opts = opts || {};
    if (!line || typing) return false;
    if (document.getElementById("aac-overlay")) return false;   // never talk over the Alive Test
    const gap = opts.minGap != null ? opts.minGap : GAP[tier()] + rnd(-1500, 3000);
    if (now() - lastSpoke < gap) return false;
    if (opts.prob != null && Math.random() > opts.prob) return false;
    say(line);
    lastSpoke = now();
    return true;
  }

  function say(line) {
    clearTimeout(hideTimer);
    clearTimeout(typeTimer);
    currentLine = line;
    nameEl.textContent = MOOD[tier()].name;
    textEl.textContent = "";
    bubble.classList.add("show", "typing");
    guy.classList.remove("sipping");
    guy.classList.add("talking");
    typing = true;

    let i = 0;
    (function step() {
      if (i >= line.length) { endTalk(); return; }
      const ch = line[i++];
      textEl.textContent += ch;
      if (ch !== " " && ch !== "\n") {
        const f = 360 + (ch.charCodeAt(0) % 14) * 16 + rnd(-20, 20);
        try { Sound && Sound.blip && Sound.blip(f); } catch (e) {}
      }
      const pause = ch === " " ? 22 : /[.,!?;:…]/.test(ch) ? 240 : rnd(30, 58);
      typeTimer = setTimeout(step, pause);
    })();
    return true;
  }

  function finishNow() {
    clearTimeout(typeTimer);
    textEl.textContent = currentLine;
    endTalk();
  }
  function endTalk() {
    typing = false;
    guy.classList.remove("talking");
    bubble.classList.remove("typing");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 4200);
  }
  function hide() {
    clearTimeout(typeTimer);
    clearTimeout(hideTimer);
    typing = false;
    bubble.classList.remove("show", "typing");
    guy.classList.remove("talking");
  }

  global.Spud = { init, say, hide, state: () => ({ suspicion: Math.round(suspicion), tier: tier() }) };
})(window);
