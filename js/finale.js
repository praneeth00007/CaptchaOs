/* ============================================================
   Finale — the toll. A full-screen, un-closable rickroll that
   ends in a fake BSOD and wipes the DOM (a simulated system exit).
   The tune is synthesized in audio.js; no lyrics are shown.
   ============================================================ */
(function (global) {
  let box = null;          // the finale overlay
  let melodyTimer = null;  // loops the synthesized melody
  let danceTimer = null;   // cycles the pixel dancer frames
  let mqTimer = null;      // rotates the marquee text
  let keyLock = null;      // swallows all keys while the finale is up
  let killed = false;

  function screenEl() { return document.getElementById("screen") || document.body; }
  function crt(on) { const c = document.getElementById("crt"); if (c) c.classList.toggle("on", !!on); }

  // pixel "dance" frames + rotating banner text (deliberately NOT the lyrics)
  const DANCERS = ["🕺", "💃", "🙆", "🕺", "💃", "🙅"];
  const MARQUEE = [
    "★ CERTIFIED HUMAN ★ CERTIFIED RICKROLLED ★ NO REFUNDS ★",
    "THIS HAS BEEN CAPTCHAOS · THANK YOU FOR VERIFYING ENDLESSLY",
    "YOU SURVIVED THE SNAKE · THE SNAKE DID NOT SURVIVE YOU",
    "NO ESCAPE · ONLY GROOVE · PLEASE ENJOY THE COMPLIMENTARY TUNE"
  ];

  function lockKeys(on) {
    if (on && !keyLock) {
      keyLock = (e) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener("keydown", keyLock, true);
    } else if (!on && keyLock) {
      window.removeEventListener("keydown", keyLock, true);
      keyLock = null;
    }
  }

  function stopTimers() {
    killed = true;
    if (melodyTimer) { clearTimeout(melodyTimer); melodyTimer = null; }
    if (danceTimer)  { clearInterval(danceTimer); danceTimer = null; }
    if (mqTimer)     { clearInterval(mqTimer); mqTimer = null; }
  }

  function playMelodyLoop() {
    if (killed) return;
    let dur = 8000;
    try { dur = (Sound && Sound.rickroll()) || 8000; } catch (e) {}
    melodyTimer = setTimeout(playMelodyLoop, dur + 500);
  }

  function play() {
    if (box) return;                         // already running
    killed = false;
    if (global.Captcha && Captcha.state) Captcha.state.inFinale = true;

    box = document.createElement("div");
    box.className = "finale show";
    box.id = "finale";
    box.innerHTML = `
      <div class="disco"></div>
      <div class="finale-inner">
        <div class="dancer">🕺</div>
        <div class="rr">★ YOU HAVE BEEN<br>RICKROLLED ★</div>
        <div class="notes"><span>🎵</span><span>🎶</span><span>🎵</span><span>🎶</span><span>🎵</span></div>
        <div class="marquee"><span></span></div>
        <div class="q">Who just got rickrolled?</div>
        <div class="opts"><div class="btn primary you">YOU</div></div>
      </div>`;
    screenEl().appendChild(box);
    try { Sound && Sound.ambientStop && Sound.ambientStop(); } catch (e) {}
    crt(true);
    lockKeys(true);                          // the game underneath can no longer be steered

    // pixel dancer frame-swap
    const dancer = box.querySelector(".dancer");
    let f = 0;
    danceTimer = setInterval(() => { f = (f + 1) % DANCERS.length; dancer.textContent = DANCERS[f]; }, 220);

    // rotating banner
    const mq = box.querySelector(".marquee > span");
    let mi = 0; mq.textContent = MARQUEE[0];
    mqTimer = setInterval(() => { mi = (mi + 1) % MARQUEE.length; mq.textContent = MARQUEE[mi]; }, 5000);

    playMelodyLoop();

    // the ONLY interactable control on the entire screen
    box.querySelector(".you").onclick = crash;
  }

  /* ---- click "YOU" -> Blue Screen of Death -> wipe the DOM ---- */
  function bsodMarkup() {
    return `
      <div class="bsod">
        <div class="bsod-face">:(</div>
        <h1>CaptchaOS</h1>
        <p>A problem has been detected and CaptchaOS has been shut down to
           prevent damage to your remaining sense of trust.</p>
        <div class="stop">RICKROLL_EXCEPTION_NOT_HANDLED</div>
        <p>* You clicked <b>YOU</b>.<br>
           * It was the only button.<br>
           * Deep down, you always knew.</p>
        <p>Technical information:</p>
        <p>*** STOP: 0x0000R1CK (0xDEAD, 0xBEEF, 0x0000, 0xC0DE)</p>
        <p>Dumping physical memory of your dignity&hellip; 100% complete.</p>
        <p class="blink">Press any key to reboot CaptchaOS_</p>
      </div>`;
  }

  function freezeAllTimers() {
    // fully "exit": cancel every pending timer in the page (snake loop, clock, …)
    try {
      const top = setTimeout(function () {}, 0);
      for (let i = 0; i <= top; i++) { clearTimeout(i); clearInterval(i); }
    } catch (e) {}
  }

  function crash() {
    stopTimers();
    lockKeys(false);
    try { Sound && Sound.critical && Sound.critical(); } catch (e) {}
    try { Sound && Sound.crash && Sound.crash(); } catch (e) {}

    // wipe the entire DOM, leaving only the crash screen
    document.body.className = "bsod-body";
    document.body.innerHTML = bsodMarkup();
    box = null;

    freezeAllTimers();

    // a real reboot for anyone who wants to run the gauntlet again
    const reboot = () => { try { global.location.reload(); } catch (e) {} };
    setTimeout(() => {
      window.addEventListener("keydown", reboot, { once: true });
      window.addEventListener("pointerdown", reboot, { once: true });
    }, 1200);
  }

  global.Finale = { play };
})(window);