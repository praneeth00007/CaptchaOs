/* ============================================================
   Gauntlet — chains 3..7 captchas back-to-back, escalating,
   then triggers the rickroll finale. Also the single-shot
   captcha popup used by the browser & login.
   ============================================================ */
(function (global) {
  const C = () => global.Captcha;

  const NAG = [
    "Nice. Just to be sure…", "One more, promise.", "Okay okay, last one.",
    "Our servers are shy. Again.", "You're SO close.", "Almost human now.",
    "Prove it. Again.", "Hmm, suspicious. Retry."
  ];

  /* single captcha in its own window; onPass() when solved once. */
  function popup(opts) {
    opts = opts || {};
    const host = document.createElement("div");
    host.style.width = "340px";
    const win = WM.open({
      title: opts.title || "Security Check",
      icon: "🛡️",
      width: 344,
      content: host,
      resizable: false,
      system: true            // a verification gate, not a window the user chose to open
    });
    C().renderInto(host, () => {
      if (opts.onPass) opts.onPass();
      if (!opts.keepOpen) setTimeout(win.close, 250);
    }, { type: opts.type });
    return win;
  }

  /* the gauntlet: N captchas -> finale. onEscape unused (finale exits). */
  function run(opts) {
    opts = opts || {};
    const target = opts.count || C().R(3, 7);
    const st = C().state;
    st.streak = 0;
    st.inFinale = false;

    const host = document.createElement("div");
    host.style.width = "340px";
    const win = WM.open({
      title: "CAPTCHA Trials",
      icon: "🧩",
      width: 344,
      content: host,
      resizable: false,
      onClose: () => { if (opts.onQuit && !st.inFinale) opts.onQuit(); }
    });

    const banner = document.createElement("div");
    banner.style.cssText = "font-family:var(--font-pixel);font-size:9px;padding:6px 12px;background:#20242e;color:#7fd7c8;";
    const inner = document.createElement("div");
    host.appendChild(banner);
    host.appendChild(inner);

    function step() {
      banner.textContent = `TRIAL ${st.streak + 1} / ${target}  ·  no escape but through`;
      C().renderInto(inner, () => {
        st.streak++;
        if (st.streak >= target) {
          Sound && Sound.levelup();
          setTimeout(() => { win.close(); Finale.play(); }, 400);
        } else {
          const nag = NAG[st.streak % NAG.length];
          inner.innerHTML = `<div style="padding:26px;text-align:center;font-size:22px">${nag}</div>`;
          Sound && Sound.chord();
          setTimeout(step, 650);
        }
      }, {});
    }
    step();
    return win;
  }

  global.Gauntlet = { run, popup };
})(window);