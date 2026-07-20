/* ============================================================
   Window Manager — draggable beveled windows + error popups
   ============================================================ */
(function (global) {
  let zTop = 100;
  const wins = new Map(); // id -> {el, meta}
  let idSeq = 0;

  const desktop = () => document.getElementById("desktop");
  const tasksEl = () => document.getElementById("tasks");

  function focus(win) {
    zTop += 1;
    win.style.zIndex = zTop;
    for (const [, w] of wins) w.el.classList.toggle("inactive", w.el !== win);
    syncTasks();
  }

  function syncTasks() {
    const bar = tasksEl();
    if (!bar) return;
    bar.innerHTML = "";
    for (const [id, w] of wins) {
      if (w.meta.noTask) continue;
      const t = document.createElement("div");
      t.className = "taskitem bevel-out";
      if (!w.el.classList.contains("inactive") && w.el.style.display !== "none")
        t.classList.add("active");
      t.innerHTML = `<span>${w.meta.icon || "🗔"}</span><span class="nowrap">${w.meta.title}</span>`;
      t.onclick = () => {
        if (w.el.style.display === "none") { w.el.style.display = "flex"; focus(w.el); }
        else if (w.el.classList.contains("inactive")) { focus(w.el); }
        else { w.el.style.display = "none"; syncTasks(); }
      };
      bar.appendChild(t);
    }
  }

  function makeDraggable(win, handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".tbtn")) return;
      dragging = true;
      win.classList.add("dragging");
      sx = e.clientX; sy = e.clientY;
      const r = win.getBoundingClientRect();
      ox = r.left; oy = r.top;
      handle.setPointerCapture(e.pointerId);
      focus(win);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      let nx = ox + (e.clientX - sx);
      let ny = oy + (e.clientY - sy);
      nx = Math.max(-40, Math.min(nx, window.innerWidth - 60));
      ny = Math.max(0, Math.min(ny, window.innerHeight - 60));
      win.style.left = nx + "px";
      win.style.top = ny + "px";
    });
    const stop = (e) => { dragging = false; win.classList.remove("dragging"); };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function makeResizable(win, grip, minW, minH) {
    let sx, sy, ow, oh, on = false;
    grip.addEventListener("pointerdown", (e) => {
      on = true; sx = e.clientX; sy = e.clientY;
      const r = win.getBoundingClientRect(); ow = r.width; oh = r.height;
      grip.setPointerCapture(e.pointerId); e.stopPropagation();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!on) return;
      win.style.width = Math.max(minW || 220, ow + (e.clientX - sx)) + "px";
      win.style.height = Math.max(minH || 140, oh + (e.clientY - sy)) + "px";
    });
    grip.addEventListener("pointerup", () => { on = false; });
  }

  const WM = {
    /* open a window.
       opts: {title, icon, width, height, x, y, resizable, noTask, appId,
              onClose, className}  -> returns {el, body, close}  */
    open(opts) {
      opts = opts || {};
      const id = "win" + (++idSeq);
      const win = document.createElement("div");
      win.className = "win bevel-out " + (opts.className || "");
      win.dataset.id = id;
      if (opts.system) win.dataset.system = "1";
      if (opts.noFog) win.dataset.nofog = "1";
      win.style.width = (opts.width || 360) + "px";
      if (opts.height) win.style.height = opts.height + "px";

      const cx = opts.x != null ? opts.x
        : Math.max(10, (window.innerWidth - (opts.width || 360)) / 2 + (idSeq % 6) * 24 - 60);
      const cy = opts.y != null ? opts.y
        : Math.max(10, (window.innerHeight - (opts.height || 260)) / 3 + (idSeq % 6) * 22);
      win.style.left = cx + "px";
      win.style.top = cy + "px";

      const buttons = opts.buttons === false ? "" :
        `<div class="tbtn" data-act="min" title="Minimize">_</div>
         <div class="tbtn" data-act="close" title="Close">✕</div>`;

      win.innerHTML = `
        <div class="titlebar">
          <span class="tico">${opts.icon || "🗔"}</span>
          <span class="ttl">${opts.title || "Window"}</span>
          ${buttons}
        </div>
        <div class="body"></div>
        ${opts.resizable ? '<div class="resize"></div>' : ""}`;

      const body = win.querySelector(".body");
      if (opts.content) {
        if (typeof opts.content === "string") body.innerHTML = opts.content;
        else body.appendChild(opts.content);
      }

      const meta = { title: opts.title || "Window", icon: opts.icon, noTask: opts.noTask, system: !!opts.system };
      const record = { el: win, meta };
      wins.set(id, record);

      const api = {
        el: win, body, id,
        close() {
          if (opts.onClose) try { opts.onClose(); } catch (e) {}
          win.remove(); wins.delete(id); syncTasks();
          if (global.Sound) Sound.close();
        },
        setTitle(t) { meta.title = t; win.querySelector(".ttl").textContent = t; syncTasks(); },
        focus() { focus(win); }
      };

      win.querySelectorAll(".tbtn").forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          if (b.dataset.act === "close") api.close();
          else { win.style.display = "none"; syncTasks(); }
        };
      });

      win.addEventListener("pointerdown", () => focus(win), true);
      makeDraggable(win, win.querySelector(".titlebar"));
      if (opts.resizable) makeResizable(win, win.querySelector(".resize"), opts.minW, opts.minH);

      desktop().appendChild(win);
      focus(win);
      syncTasks();
      if (global.Sound && !opts.silent) Sound.open();
      return api;
    },

    /* Error popup — the signature element.
       opts: {title, msg, code, icon, buttons:[{label, primary, danger, act}],
              x, y, sound, shake}  */
    error(opts) {
      opts = opts || {};
      const win = document.createElement("div");
      win.className = "win errbox bevel-out";
      zTop += 1;
      win.style.zIndex = 500 + (zTop % 4000);
      const w = 340;
      const x = opts.x != null ? opts.x
        : 40 + Math.random() * Math.max(20, window.innerWidth - w - 80);
      const y = opts.y != null ? opts.y
        : 30 + Math.random() * Math.max(20, window.innerHeight - 240);
      win.style.left = Math.round(x) + "px";
      win.style.top = Math.round(y) + "px";
      win.style.width = w + "px";

      const btns = (opts.buttons || [{ label: "OK", primary: true }]).map((b, i) =>
        `<div class="btn ${b.primary ? "primary" : ""} ${b.danger ? "danger" : ""}" data-i="${i}">${b.label}</div>`
      ).join("");

      win.innerHTML = `
        <div class="titlebar">
          <span class="tico">${opts.tico || "⚠"}</span>
          <span class="ttl">${opts.title || "Error"}</span>
          <div class="tbtn" data-act="close">✕</div>
        </div>
        <div class="body">
          <div class="err-row">
            <div class="err-ico">${opts.icon || "❌"}</div>
            <div>
              <div class="err-msg">${opts.msg || "An unexpected error has occurred."}</div>
              ${opts.code ? `<div class="err-code">${opts.code}</div>` : ""}
            </div>
          </div>
          <div class="err-actions">${btns}</div>
        </div>`;

      const remove = () => { win.remove(); };
      win.querySelector('[data-act="close"]').onclick = remove;
      (opts.buttons || [{ label: "OK" }]).forEach((b, i) => {
        win.querySelector(`[data-i="${i}"]`).onclick = () => {
          if (global.Sound) Sound.click();
          if (b.act) try { b.act(); } catch (e) {}
          if (!b.keepOpen) remove();
        };
      });

      win.addEventListener("pointerdown", () => { zTop += 1; win.style.zIndex = 500 + (zTop % 4000); }, true);
      makeDraggable(win, win.querySelector(".titlebar"));
      desktop().appendChild(win);

      if (opts.shake) { win.classList.add("shake"); setTimeout(() => win.classList.remove("shake"), 320); }
      if (global.Sound && opts.sound !== false) (opts.sound === "critical" ? Sound.critical() : Sound.error());
      return { el: win, close: remove };
    },

    /* spawn N error popups in a cascade (the storm) */
    errorStorm(list, gap, onDone) {
      gap = gap || 260;
      let i = 0;
      const tick = () => {
        if (i >= list.length) { if (onDone) onDone(); return; }
        WM.error(Object.assign({ shake: true }, list[i]));
        i++;
        setTimeout(tick, gap);
      };
      tick();
    },

    count() { return wins.size; },
    // count only real app windows — captcha/gate windows pass {system:true}
    appCount() { let n = 0; for (const [, w] of wins) if (!w.meta.system) n++; return n; },
    focusEl: focus,
    syncTasks
  };

  global.WM = WM;
})(window);
