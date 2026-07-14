/* ============================================================
   Cozle Browser — a mock search engine that gates every article
   behind a Traffic Lights or Identify-the-Pattern captcha.
   ============================================================ */
(function (global) {
  const R = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const TLDS = ["com", "net", "org", "io", "info", "biz"];
  const HOSTS = ["cozynet", "webdial", "infozone", "the-archive", "pixelpost", "quorble", "wikible"];

  const TITLE_TEMPLATES = [
    "10 Things You Won't Believe About {Q}",
    "The Ultimate Guide to {Q} (2001 Edition)",
    "Is {Q} Bad For You? Doctors Are Divided",
    "{Q}: Everything You Need To Know",
    "Why {Q} Is Trending Right Now",
    "{Q} Explained For Beginners"
  ];
  const DESC =
    "This comprehensive resource covers everything about your query. " +
    "Click through to read the full article, complete with expert quotes, " +
    "a numbered list, and exactly one useful sentence buried somewhere below the fold…";

  function domainFor(q) {
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 18) || "search";
    return `www.${pick(HOSTS)}.${pick(TLDS)}/${slug}`;
  }

  function articleBody(q) {
    const paras = [
      `Welcome, curious human. You searched for <b>${esc(q)}</b>, and you have come to the right place. Or possibly the wrong place. It is genuinely hard to say.`,
      `Experts agree that ${esc(q)} is, in fact, a thing that exists. Studies have shown that ${esc(q)} may be related to other things, some of which are also ${esc(q)}.`,
      `Here are 3 quick facts about ${esc(q)}: (1) it is popular; (2) it is sometimes unpopular; (3) this website will now ask you to prove you are human at least once more before the day is out.`,
      `In conclusion, ${esc(q)} remains one of the most ${esc(q)}-adjacent topics of our time. Thank you for reading. Please accept 47 cookies.`
    ];
    return `
      <div class="pad">
        <h2 style="font-size:26px;color:var(--link);line-height:1.15;margin-bottom:6px">${esc(q)}: Everything You Need To Know</h2>
        <div style="font-size:15px;color:var(--ink-soft);margin-bottom:14px">By Staff Writer · ${R(3, 19)} min read · ${R(2, 900)}k shares</div>
        ${paras.map((p) => `<p style="margin-bottom:12px">${p}</p>`).join("")}
      </div>`;
  }

  function open(opts) {
    opts = opts || {};
    const host = document.createElement("div");
    host.className = "br";
    host.innerHTML = `
      <div class="chrome">
        <div class="tabs"><div class="tab active">🌐 Cozle</div><div class="tab" style="opacity:.5">+ New Tab</div></div>
        <div class="bar">
          <div class="nav">
            <div class="navbtn" data-act="back" title="Back">◀</div>
            <div class="navbtn" data-act="home" title="Home">⌂</div>
            <div class="navbtn" data-act="reload" title="Reload">⟳</div>
          </div>
          <input class="url bevel-in" value="cozle.com" spellcheck="false" autocomplete="off">
          <div class="btn primary go">Go</div>
        </div>
      </div>
      <div class="view"></div>`;

    const win = WM.open({
      title: "Cozle Browser",
      icon: "🌐",
      width: 660,
      height: 480,
      resizable: true,
      minW: 420,
      minH: 320,
      content: host,
      className: "appwin"
    });

    const view = host.querySelector(".view");
    const url = host.querySelector(".url");

    function setUrl(u) { url.value = u; }

    /* -------- home / search-engine landing page -------- */
    function home() {
      setUrl("cozle.com");
      view.innerHTML = `
        <div class="se">
          <div class="logo"><b>C</b><b>o</b><b>z</b><b>l</b>e</div>
          <div class="sub">the search engine that cares (about verifying you)</div>
          <div class="searchrow">
            <input class="q bevel-in" placeholder="Search the cozy web…" spellcheck="false" autocomplete="off">
          </div>
          <div class="lucky">
            <div class="btn cozle-search">Cozle Search</div>
            <div class="btn feeling-lucky">I'm Feeling Verified</div>
          </div>
          <div class="tips">Tip: every result is equally trustworthy. Clicking one may require you to prove, once again, that you possess a soul.</div>
        </div>`;
      const q = view.querySelector(".q");
      setTimeout(() => { try { q.focus(); } catch (e) {} }, 40);
      const go = () => { const v = q.value.trim(); if (v) results(v); };
      view.querySelector(".cozle-search").onclick = go;
      view.querySelector(".feeling-lucky").onclick = () => { const v = q.value.trim() || "cozy web rings"; results(v); };
      q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    }

    /* -------- results: 10 identical fake articles -------- */
    function results(q) {
      Sound && Sound.click();
      setUrl(`cozle.com/search?q=${encodeURIComponent(q)}`);
      const count = (R(1, 9) + "," + R(100, 999) + "," + R(100, 999));
      const dom = domainFor(q);
      const title = pick(TITLE_TEMPLATES).replace("{Q}", q);
      let cards = "";
      for (let i = 0; i < 10; i++) {
        cards += `
          <div class="res" data-q="${esc(q)}">
            <div class="u">${esc(dom)}</div>
            <div class="t">${esc(title)}</div>
            <div class="d">${DESC}</div>
          </div>`;
      }
      view.innerHTML = `
        <div class="sr">
          <div class="stat">About ${count} results (0.0${R(1, 9)} seconds) · all of them identical</div>
          ${cards}
          <div class="pages">
            <span>Coooooooo</span>
            ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<span class="pg ${n === 1 ? "on" : ""}">${n}</span>`).join("")}
            <span>gle ›</span>
          </div>
        </div>`;
      view.scrollTop = 0;
      view.querySelectorAll(".res .t").forEach((t) => {
        t.onclick = () => gate(q);
      });
      view.querySelectorAll(".pg").forEach((p) => p.onclick = () => { Sound && Sound.tick(); view.scrollTop = 0; });
    }

    /* -------- the gate: lock the window behind a visual captcha -------- */
    function gate(q) {
      // 50/50 Traffic Lights vs Identify the Pattern
      const type = Math.random() < 0.5 ? "traffic" : "pattern";
      Sound && (Sound.critical ? Sound.critical() : Sound.error());

      const veil = document.createElement("div");
      veil.className = "veil locking";
      veil.innerHTML = `
        <div class="lockbox bevel-out">
          <div class="lockhead"><span>🔒</span><span class="lockttl">ACCESS BLOCKED — Verify to continue</span></div>
          <div class="lockbody"><div class="lock-host"></div></div>
        </div>`;
      win.body.appendChild(veil);

      const lockHost = veil.querySelector(".lock-host");
      const lockTtl = veil.querySelector(".lockttl");

      // stage 1: the visual captcha (Traffic Lights / Identify the Pattern)
      Captcha.renderInto(lockHost, () => {
        Sound && Sound.good();
        // stage 2: the mechanical "Remove the Bolts" micro-game
        lockTtl.textContent = "MECHANICAL VERIFICATION — Remove the Bolts";
        Captcha.renderInto(lockHost, () => {
          Sound && Sound.unlock();
          veil.remove();
          searchSuccess(q);
        }, { type: "mechanical" });
      }, { type });
    }

    /* -------- the reward: a dummy "Search Successful" page -------- */
    function searchSuccess(q) {
      setUrl(domainFor(q));
      view.innerHTML = `
        <div class="success">
          <div class="success-badge">✅</div>
          <h1>Search Successful</h1>
          <p>Your humanity has been verified. Here are your results for <b>${esc(q)}</b>:</p>
          <div class="success-card bevel-out">${articleBody(q)}</div>
        </div>`;
      view.scrollTop = 0;
    }

    /* -------- chrome wiring -------- */
    host.querySelector('[data-act="home"]').onclick = () => { Sound && Sound.click(); home(); };
    host.querySelector('[data-act="back"]').onclick = () => { Sound && Sound.click(); home(); };
    host.querySelector('[data-act="reload"]').onclick = () => { Sound && Sound.tick(); };
    host.querySelector(".go").onclick = () => {
      const v = url.value.replace(/^https?:\/\//, "").trim();
      const m = v.match(/[?&]q=([^&]+)/);
      if (m) results(decodeURIComponent(m[1]));
      else if (/^cozle\.com\/?$/.test(v) || v === "cozle.com") home();
      else results(v.split("/")[0] || "the web");
    };
    url.addEventListener("keydown", (e) => { if (e.key === "Enter") host.querySelector(".go").click(); });

    if (opts.q) results(opts.q); else home();   // ?q=term deep-links straight to results
    return win;
  }

  global.Browser = { open };
})(window);   