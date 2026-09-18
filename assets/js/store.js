/* 存储：主存储 = Artifact 自带数据库（db 能力，只允许主持人账号读写）；
 * 本机备份 = localStorage（每次变化立即写）。本地运行时只有本机备份。
 * 云端写入按文档去抖 1.2 s，同一文档串行写。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const LS = "icu-study/v1/";

  function lsGet(key) {
    try {
      const s = localStorage.getItem(LS + key);
      return s ? JSON.parse(s) : null;
    } catch (_) {
      return null;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(LS + key, JSON.stringify(val));
      return true;
    } catch (_) {
      return false;
    }
  }
  function lsDel(key) {
    try {
      localStorage.removeItem(LS + key);
    } catch (_) {
      /* ignore */
    }
  }
  function lsKeys(prefix) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS + prefix)) out.push(k.slice(LS.length));
      }
    } catch (_) {
      /* ignore */
    }
    return out;
  }

  const DEFAULT_CONFIG = {
    R: 6, // 判定半径（格点）
    coverTol: 1, // 选线覆盖参照分歧：相邻几级内算覆盖
    annotator: "",
    checklist: {},
    lightMap: true, // 会话时专家区固定浅色
    updatedAt: 0,
  };

  const Store = {
    mode: "local",
    db: null,
    status: "idle",
    statusMsg: "",
    lastSaved: 0,
    localOK: true,
    sessions: new Map(),
    refs: {},
    config: { ...DEFAULT_CONFIG },
    _listeners: new Set(),
    _timers: new Map(),
    _writing: new Map(),
    _pending: new Map(),

    onStatus(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },
    _emit() {
      for (const fn of this._listeners) fn();
    },
    _setStatus(s, msg = "") {
      this.status = s;
      this.statusMsg = msg;
      if (s === "saved") this.lastSaved = Date.now();
      this._emit();
    },

    /* ---------------- 初始化 ---------------- */
    async init() {
      // 本机
      this.localOK = lsSet("_probe", 1);
      for (const k of lsKeys("sessions/")) {
        const s = lsGet(k);
        if (s && s.id) this.sessions.set(s.id, s);
      }
      for (const k of lsKeys("reference/")) {
        const r = lsGet(k);
        if (r && r.caseId) this.refs[r.caseId] = r;
      }
      const cfg = lsGet("config/study");
      if (cfg) this.config = { ...DEFAULT_CONFIG, ...cfg };

      // 云端
      let db = null;
      try {
        if (window.claude && typeof window.claude.use === "function") {
          db = await Promise.race([window.claude.use("db"), new Promise((r) => setTimeout(() => r(null), 10000))]);
        }
      } catch (_) {
        db = null;
      }
      if (!db) {
        this.mode = "local";
        this._setStatus(this.localOK ? "local" : "error", this.localOK ? "" : "浏览器禁止了本机存储，数据只在内存里");
        return;
      }
      this.db = db;
      this.mode = "cloud";
      this._setStatus("syncing");
      try {
        const [ss, rs, cf] = await Promise.all([
          db.collection("sessions").get(),
          db.collection("reference").get(),
          db.doc("config/study").get(),
        ]);
        const pushSessions = [];
        const seen = new Set();
        for (const d of ss.docs) {
          const remote = d.data();
          if (!remote || !remote.id) continue;
          seen.add(remote.id);
          const local = this.sessions.get(remote.id);
          if (!local || (remote.updatedAt || 0) >= (local.updatedAt || 0)) {
            this.sessions.set(remote.id, JSON.parse(JSON.stringify(remote)));
            lsSet(`sessions/${remote.id}`, remote);
          } else pushSessions.push(local);
        }
        for (const [id, s] of this.sessions) if (!seen.has(id) && !s._deleted) pushSessions.push(s);
        const pushRefs = [];
        const seenR = new Set();
        for (const d of rs.docs) {
          const remote = d.data();
          if (!remote || !remote.caseId) continue;
          seenR.add(remote.caseId);
          const local = this.refs[remote.caseId];
          if (!local || (remote.updatedAt || 0) >= (local.updatedAt || 0)) {
            this.refs[remote.caseId] = JSON.parse(JSON.stringify(remote));
            lsSet(`reference/${remote.caseId}`, remote);
          } else pushRefs.push(local);
        }
        for (const [cid, r] of Object.entries(this.refs)) if (!seenR.has(cid)) pushRefs.push(r);
        if (cf.exists) {
          const remote = cf.data();
          if ((remote.updatedAt || 0) >= (this.config.updatedAt || 0)) {
            this.config = { ...DEFAULT_CONFIG, ...remote };
            lsSet("config/study", this.config);
          } else this._queue("config/study", this.config);
        }
        for (const s of pushSessions) this._queue(`sessions/${s.id}`, s);
        for (const r of pushRefs) this._queue(`reference/${r.caseId}`, r);
        this._setStatus("saved");
      } catch (e) {
        this._setStatus("error", `云端读取失败：${(e && e.message) || e}；本机备份仍在`);
      }
    },

    /* ---------------- 写 ---------------- */
    _queue(path, obj) {
      if (!this.db) return;
      this._pending.set(path, obj);
      clearTimeout(this._timers.get(path));
      this._setStatus("pending");
      this._timers.set(
        path,
        setTimeout(() => this._flush(path), 1200),
      );
    },
    async _flush(path) {
      this._timers.delete(path);
      if (this._writing.get(path)) {
        // 上一个写还没回来：等它结束后再写最新值
        this._timers.set(
          path,
          setTimeout(() => this._flush(path), 400),
        );
        return;
      }
      const obj = this._pending.get(path);
      if (!obj) return;
      this._pending.delete(path);
      this._writing.set(path, true);
      this._setStatus("saving");
      const body = JSON.parse(JSON.stringify(obj));
      let attempt = 0;
      for (;;) {
        try {
          if (obj._deleted) await this.db.doc(path).delete();
          else await this.db.doc(path).set(body);
          break;
        } catch (e) {
          attempt++;
          const code = e && e.code;
          if (code === "unavailable" && attempt < 3) {
            await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
            continue;
          }
          this._writing.set(path, false);
          this._setStatus("error", `云端保存失败（${code || "未知"}）：${(e && e.message) || ""}。本机备份已保存`);
          return;
        }
      }
      this._writing.set(path, false);
      if (!this._pending.size && ![...this._writing.values()].some(Boolean)) this._setStatus("saved");
    },
    flushAll() {
      for (const path of [...this._timers.keys()]) {
        clearTimeout(this._timers.get(path));
        this._flush(path);
      }
    },

    saveSession(s) {
      s.updatedAt = Date.now();
      this.sessions.set(s.id, s);
      const ok = lsSet(`sessions/${s.id}`, s);
      if (this.db) this._queue(`sessions/${s.id}`, s);
      else this._setStatus(ok ? "local" : "error", ok ? "" : "本机存储已满或被禁用");
    },
    deleteSession(id) {
      this.sessions.delete(id);
      lsDel(`sessions/${id}`);
      if (this.db) this._queue(`sessions/${id}`, { _deleted: true });
    },
    getRef(caseId) {
      if (!this.refs[caseId]) this.refs[caseId] = { caseId, points: [], updatedAt: 0 };
      return this.refs[caseId];
    },
    saveRef(caseId) {
      const r = this.getRef(caseId);
      r.updatedAt = Date.now();
      r.annotator = this.config.annotator || r.annotator || "";
      lsSet(`reference/${caseId}`, r);
      if (this.db) this._queue(`reference/${caseId}`, r);
      else this._setStatus("local");
    },
    saveConfig() {
      this.config.updatedAt = Date.now();
      lsSet("config/study", this.config);
      if (this.db) this._queue("config/study", this.config);
      else this._setStatus("local");
    },
    listSessions() {
      return [...this.sessions.values()].filter((s) => !s._deleted).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },
    /** 导入 study_all.json：按 updatedAt 合并 */
    importAll(obj) {
      let ns = 0,
        nr = 0;
      for (const s of obj.sessions || []) {
        const cur = this.sessions.get(s.id);
        if (!cur || (s.updatedAt || 0) > (cur.updatedAt || 0)) {
          this.sessions.set(s.id, s);
          lsSet(`sessions/${s.id}`, s);
          if (this.db) this._queue(`sessions/${s.id}`, s);
          ns++;
        }
      }
      for (const r of Object.values(obj.reference || {})) {
        const cur = this.refs[r.caseId];
        if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) {
          this.refs[r.caseId] = r;
          lsSet(`reference/${r.caseId}`, r);
          if (this.db) this._queue(`reference/${r.caseId}`, r);
          nr++;
        }
      }
      return { ns, nr };
    },
  };

  window.addEventListener("beforeunload", () => Store.flushAll());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") Store.flushAll();
  });

  ICU.Store = Store;
})();
