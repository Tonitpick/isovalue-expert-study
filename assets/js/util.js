/* 通用工具：DOM 构造、随机数、格式化、对话框、文件保存。全部挂在 window.ICU 上。 */
(function () {
  "use strict";
  const ICU = (window.ICU = window.ICU || {});

  /* ---------------- DOM ---------------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style" && typeof v === "object") {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith("--")) el.style.setProperty(sk, String(sv));
            else el.style[sk] = sv;
          }
        }
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "html") el.innerHTML = v;
        else if (k === "value") el.value = v;
        else if (k === "checked") el.checked = !!v;
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      }
    }
    append(el, kids);
    return el;
  }
  function append(el, ...kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false || k === true) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }
  /** 清空后按 h() 的规则填入（数组展平、跳过 null/false） */
  function fill(el, ...kids) {
    return append(clear(el), kids);
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------- 随机 ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function uid(prefix = "") {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- 格式化 ---------------- */
  function fmtDur(ms) {
    if (ms == null || !isFinite(ms)) return "—";
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }
  function fmtClock(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function fmtDateTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(ts)}`;
  }
  /** 等值线数值：按量级保留合适小数位 */
  function fmtVal(v, unit) {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    let s;
    if (a >= 100) s = v.toFixed(1);
    else if (a >= 10) s = v.toFixed(1);
    else if (a >= 1) s = v.toFixed(2);
    else s = v.toFixed(2);
    return unit ? `${s} ${unit}` : s;
  }
  function fmtLatLon(lat, lon) {
    const la = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
    const lo = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
    return `${la} ${lo}`;
  }
  function pct(a, b) {
    if (!b) return "—";
    return `${Math.round((a / b) * 100)}%`;
  }
  function mean(arr) {
    const v = arr.filter((x) => x != null && isFinite(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  }
  function median(arr) {
    const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function round(x, d = 2) {
    if (x == null || !isFinite(x)) return null;
    const f = 10 ** d;
    return Math.round(x * f) / f;
  }
  function debounce(fn, ms) {
    let t = null;
    const d = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn(...a);
      }, ms);
    };
    d.flush = (...a) => {
      if (t) {
        clearTimeout(t);
        t = null;
        fn(...a);
      }
    };
    d.pending = () => t != null;
    return d;
  }
  function escapeCSV(v) {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  /** 带 BOM 的 CSV：Excel 直接打开不乱码 */
  function toCSV(header, rows) {
    const lines = [header.map(escapeCSV).join(",")];
    for (const r of rows) lines.push(r.map(escapeCSV).join(","));
    return "﻿" + lines.join("\r\n");
  }

  /* ---------------- 提示 / 对话框 ---------------- */
  let toastHost = null;
  function toast(msg, kind = "info", ms = 2600) {
    if (!toastHost) {
      toastHost = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.appendChild(toastHost);
    }
    const t = h("div", { class: `toast ${kind}` }, msg);
    toastHost.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    setTimeout(() => {
      t.classList.remove("in");
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  /**
   * 模态对话框。buttons: [{label, value, kind}]，返回被点按钮的 value（Esc = null）。
   * checks: 需要全部勾选才能点主按钮的确认项。
   */
  function dialog({ title, body, buttons, checks, wide }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const boxes = (checks || []).map((c, i) =>
        h("label", { class: "check-row" }, h("input", { type: "checkbox", id: `dlg-chk-${i}` }), h("span", null, c)),
      );
      const btns = (buttons || [{ label: "好", value: true, kind: "primary" }]).map((b) =>
        h("button", { class: `btn ${b.kind || ""}`, "data-v": String(b.value), type: "button" }, b.label),
      );
      const card = h(
        "div",
        { class: `dialog${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h3", null, title),
        body ? (body instanceof Node ? body : h("div", { class: "dialog-body" }, body)) : null,
        boxes.length ? h("div", { class: "dialog-checks" }, boxes) : null,
        h("div", { class: "dialog-actions" }, btns),
      );
      const back = h("div", { class: "scrim" }, card);
      const sync = () => {
        const ok = boxes.every((b) => b.querySelector("input").checked);
        btns.forEach((b, i) => {
          if ((buttons || [])[i]?.kind === "primary" || (buttons || [])[i]?.kind === "danger") b.disabled = !ok;
        });
      };
      boxes.forEach((b) => b.querySelector("input").addEventListener("change", sync));
      sync();
      const done = (v) => {
        back.remove();
        document.removeEventListener("keydown", onKey, true);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          done(null);
        }
      };
      btns.forEach((b, i) =>
        b.addEventListener("click", () => {
          const spec = (buttons || [{ value: true }])[i];
          done(spec.value);
        }),
      );
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(back);
      setTimeout(() => (btns[btns.length - 1] || card).focus(), 30);
    });
  }
  const confirmBox = (title, body, okLabel = "确定", kind = "primary", checks) =>
    dialog({
      title,
      body,
      checks,
      buttons: [
        { label: "取消", value: false, kind: "ghost" },
        { label: okLabel, value: true, kind },
      ],
    }).then((v) => v === true);

  /* ---------------- 保存文件 ----------------
   * 在 claude.ai Artifact 里，页面自己发起的下载会被沙箱拦下，必须走 downloads 能力；
   * 本地运行时退回到普通的 <a download>。 */
  async function saveFile(filename, data, mime = "text/plain;charset=utf-8") {
    try {
      if (window.claude && window.claude.use) {
        const dl = await Promise.race([window.claude.use("downloads"), new Promise((r) => setTimeout(() => r(null), 4000))]);
        if (dl) {
          try {
            await dl.save({ filename, data: new Blob([data], { type: mime }) });
            toast(`已导出 ${filename}`, "ok");
            return true;
          } catch (e) {
            if (e && e.code === "declined") {
              toast("已取消保存", "info");
              return false;
            }
            if (e && e.code === "rate_limited") {
              toast("已有一个保存确认框未处理，请稍后再试", "warn");
              return false;
            }
            // 其他错误退回普通下载
          }
        }
      }
    } catch (_) {
      /* fallthrough */
    }
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename, style: { display: "none" } });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
    toast(`已导出 ${filename}`, "ok");
    return true;
  }

  function readFileText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  Object.assign(ICU, {
    h,
    append,
    clear,
    fill,
    $,
    $$,
    mulberry32,
    shuffle,
    uid,
    fmtDur,
    fmtClock,
    fmtDateTime,
    fmtVal,
    fmtLatLon,
    pct,
    mean,
    median,
    round,
    debounce,
    toCSV,
    toast,
    dialog,
    confirmBox,
    saveFile,
    readFileText,
    b64ToBytes,
  });
})();
