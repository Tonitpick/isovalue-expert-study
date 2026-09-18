/* 启动与两区切换。
 * 两区之间只有两个入口：「开始会话」进入专家区，完成页 / 侧栏的「回到主持人页面」退出。
 * 专家区中途刷新 → 直接回到专家区的同一环节（绝不先闪出主持人区，否则共享屏幕会泄露映射）。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { h, clear, Store, Cases, Host, Expert, fmtClock } = ICU;
  const ACTIVE_KEY = "icu-study/v1/_active";

  function getActive() {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch (_) {
      return null;
    }
  }
  function setActive(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  const App = {
    zone: "boot",
    prevTheme: undefined,

    async init() {
      const boot = document.getElementById("boot");
      const active = getActive();
      const list = h("ul", { class: "boot-list" });
      ICU.fill(boot, 
        h("div", { class: "boot-card" }, h("span", { class: "iso-mark big spin", "aria-hidden": "true" }), h("h1", null, "正在准备…"), h("p", { class: "muted" }, "载入集合预报数据，第一次可能需要十几秒。"), active ? null : list),
      );
      const offCases = Cases.onChange(() => {
        if (active) return; // 专家可能正看着屏幕：不显示案例名
        ICU.fill(list, 
          Cases.ROLES.map((r) => {
            const st = Cases.state[r.key] || {};
            return h("li", { class: st.status === "loading" ? "" : st.source === "demo" ? "warn" : "ok" }, h("span", null, r.key === "train" ? "训练" : r.key === "free" ? "选线" : r.key), h("span", { class: "muted" }, st.status === "loading" ? "载入中…" : st.source === "demo" ? "演示数据" : "已载入"));
          }),
        );
      });
      await Promise.all([Store.init(), Cases.init()]);
      offCases();
      Cases.onChange(() => {
        if (this.zone === "host") this.renderHost();
      });
      document.addEventListener("icu-palette", () => {});
      boot.hidden = true;
      const s = active ? Store.sessions.get(active) : null;
      if (s && !s._deleted) this.startSession(s, true);
      else {
        setActive(null);
        this.renderHost();
      }
    },

    renderHost(tab) {
      this.zone = "host";
      document.getElementById("expert-root").hidden = true;
      const root = document.getElementById("host-root");
      root.hidden = false;
      Host.mount(root, tab);
    },

    startSession(s, resumed) {
      Host.unmount();
      document.getElementById("host-root").hidden = true;
      const root = document.getElementById("expert-root");
      root.hidden = false;
      this.zone = "expert";
      setActive(s.id);
      // 会话时固定浅色：保证不同专家看到的图完全一样
      if (Store.config.lightMap !== false) {
        const de = document.documentElement;
        if (this.prevTheme === undefined) this.prevTheme = de.getAttribute("data-theme");
        de.setAttribute("data-theme", "light");
        de.classList.add("session-light");
      }
      ICU.Map.setPalette((s.opts && s.opts.palette) || "default");
      Expert.mount(root, s);
      if (resumed) ICU.toast("已从中断处继续", "info", 2000);
    },

    exitToHost(tab) {
      Expert.unmount();
      setActive(null);
      const de = document.documentElement;
      if (de.classList.contains("session-light")) {
        if (this.prevTheme) de.setAttribute("data-theme", this.prevTheme);
        else de.removeAttribute("data-theme");
        de.classList.remove("session-light");
        this.prevTheme = undefined;
      }
      ICU.Map.setPalette("default");
      this.renderHost(tab || "new");
    },

    /** 保存状态小标签；返回解绑函数 */
    bindSaveState(el) {
      const paint = () => {
        const st = Store.status;
        const cloud = Store.mode === "cloud";
        let text = "",
          cls = "";
        if (st === "syncing") text = "同步中…";
        else if (st === "pending") text = "待保存…";
        else if (st === "saving") text = "保存中…";
        else if (st === "saved") {
          text = `已保存 · 云端 ${fmtClock(Store.lastSaved)}`;
          cls = "ok";
        } else if (st === "local") {
          text = "已保存 · 仅本机";
          cls = cloud ? "ok" : "local";
        } else if (st === "error") {
          text = "保存出错";
          cls = "err";
        } else text = cloud ? "云端" : "本机";
        el.className = `save-state ${cls}`;
        el.textContent = text;
        el.title = Store.statusMsg || (cloud ? "主存储：主持人账号下的数据库；本机另有备份" : "本地运行：数据存在这台电脑的浏览器里，会后请导出");
      };
      paint();
      return Store.onStatus(paint);
    },
  };

  ICU.App = App;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
  else App.init();
})();
