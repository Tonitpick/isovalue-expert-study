/* 专家区（设计文档第 6 节）：开场 → 凭经验选线 → 读图训练 → 找分歧 ×4 → 归因 ×3
 * → 三张图对比 → 选线对照 → 问卷 → 访谈 → 完成。
 * 这里永远不渲染方法名、文件 tag、配法序号、UMC 等算法数值，也不按画法着色。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { h, clear, Cases, Plan, Content, Store, Geo, Charts, fmtVal, fmtDur, fmtLatLon, toast, confirmBox, dialog } = ICU;
  const { MapView, styledLevels, lineStyle } = ICU.Map;

  /* =====================================================================
   * 小组件
   * ===================================================================== */
  function likert(val, onChange, opts = {}) {
    const left = opts.left || "完全不同意",
      right = opts.right || "完全同意";
    const btns = [];
    const set = (v) => {
      btns.forEach((b) => {
        const on = b.dataset.v === String(v);
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      onChange(v);
    };
    for (let k = 1; k <= 7; k++)
      btns.push(
        h("button", { type: "button", class: "lk" + (val === k ? " on" : ""), role: "radio", "aria-checked": val === k ? "true" : "false", "aria-label": `${k} 分`, dataset: { v: String(k) }, onclick: () => set(k) }, String(k)),
      );
    const na = h("button", { type: "button", class: "lk na" + (val === "NA" ? " on" : ""), role: "radio", "aria-checked": val === "NA" ? "true" : "false", "aria-label": "不适用 NA", dataset: { v: "NA" }, onclick: () => set("NA") }, "NA");
    btns.push(na);
    return h(
      "div",
      { class: "likert", role: "radiogroup", "aria-label": opts.aria || "7 点评分" },
      h("div", { class: "lk-scale" }, btns.slice(0, 7)),
      h("div", { class: "lk-ends" }, h("span", null, `1 ${left}`), h("span", null, `${right} 7`)),
      h("div", { class: "lk-na" }, na),
    );
  }
  function choice(options, val, onChange, cls = "") {
    const btns = options.map((o) =>
      h(
        "button",
        {
          type: "button",
          class: "seg" + (val === o.value ? " on" : ""),
          role: "radio",
          "aria-checked": val === o.value ? "true" : "false",
          dataset: { v: String(o.value) },
          onclick: () => {
            btns.forEach((b) => {
              const on = b.dataset.v === String(o.value);
              b.classList.toggle("on", on);
              b.setAttribute("aria-checked", on ? "true" : "false");
            });
            onChange(o.value);
          },
        },
        o.swatch ? h("span", { class: "sw", style: { background: o.swatch } }) : null,
        h("span", { class: "seg-l" }, o.label),
        o.hint ? h("span", { class: "seg-h" }, o.hint) : null,
      ),
    );
    return h("div", { class: `segs ${cls}`, role: "radiogroup" }, btns);
  }
  function textArea(val, onInput, placeholder, rows = 3, id) {
    const t = h("textarea", { class: "ta", rows, placeholder: placeholder || "", id: id || null });
    t.value = val || "";
    t.addEventListener("input", () => onInput(t.value));
    return t;
  }
  function q(label, ...kids) {
    return h("div", { class: "qblock" }, h("div", { class: "qlabel" }, label), kids);
  }

  /* =====================================================================
   * 专家区
   * ===================================================================== */
  const Expert = {
    root: null,
    s: null, // 当前会话
    steps: [],
    pos: 0,
    maps: [],
    cleanups: [],
    tick: null,

    mount(root, session) {
      this.root = root;
      this.s = session;
      this.steps = Plan.stepsFor(session);
      const cur = session.stage || { key: "intro", sub: 0 };
      this.pos = Math.max(0, this.steps.findIndex((st) => st.key === cur.key && st.sub === cur.sub));
      const last = session.log[session.log.length - 1];
      if (!last || last.end || last.stage !== this.steps[this.pos].key || last.sub !== this.steps[this.pos].sub) {
        if (last && !last.end) last.end = Date.now();
        session.log.push({ stage: this.steps[this.pos].key, sub: this.steps[this.pos].sub, start: Date.now(), resumed: !!last });
      }
      session.stage = this.steps[this.pos];
      this.commitNow();
      this._keys = (e) => {
        const tag = (e.target && e.target.tagName) || "";
        const isM = e.code === "KeyM" && e.shiftKey;
        if (isM && (e.ctrlKey || e.metaKey || !/INPUT|TEXTAREA|SELECT/.test(tag))) {
          e.preventDefault();
          this.toggleDrawer();
        }
      };
      document.addEventListener("keydown", this._keys);
      this.render();
      this.tick = setInterval(() => this.updateDrawerClock(), 1000);
    },
    unmount() {
      this.teardown();
      document.removeEventListener("keydown", this._keys);
      clearInterval(this.tick);
      const last = this.s && this.s.log[this.s.log.length - 1];
      if (last && !last.end) last.end = Date.now();
      if (this.s) this.commitNow();
      if (this.root) clear(this.root);
      this.s = null;
    },
    teardown() {
      for (const m of this.maps) m.destroy();
      this.maps = [];
      for (const f of this.cleanups) f();
      this.cleanups = [];
    },
    commit: ICU.debounce(function () {
      Expert.commitNow();
    }, 250),
    commitNow() {
      if (this.s) Store.saveSession(this.s);
    },
    map(opts) {
      // 默认让地图、标题、底部导航在一屏里放得下（远程共享 1080p 时专家不必滚动）
      if (!opts.maxHeight) opts.maxHeight = Math.max(420, window.innerHeight - 330);
      const m = new MapView(opts);
      this.maps.push(m);
      return m;
    },
    get step() {
      return this.steps[this.pos];
    },
    stepStart() {
      const last = this.s.log[this.s.log.length - 1];
      return last ? last.start : Date.now();
    },
    go(delta) {
      this.goto(this.pos + delta);
    },
    goto(i, byHost = false) {
      if (i < 0 || i >= this.steps.length) return;
      const now = Date.now();
      const last = this.s.log[this.s.log.length - 1];
      if (last && !last.end) last.end = now;
      this.pos = i;
      this.s.stage = this.steps[i];
      this.s.log.push({ stage: this.steps[i].key, sub: this.steps[i].sub, start: now, host: byHost || undefined });
      if (this.steps[i].key === "done" && !this.s.finishedAt) this.s.finishedAt = now;
      this.commitNow();
      this.render();
      window.scrollTo({ top: 0 });
    },
    canBack() {
      if (this.pos === 0) return false;
      const cur = this.step,
        prev = this.steps[this.pos - 1];
      if (!Plan.STAGE_BY_KEY[cur.key].back) return false;
      if (prev.key === "find") return false; // 找分歧提交后不可返回
      return true;
    },

    /* ---------------- 框架 ---------------- */
    render() {
      this.teardown();
      clear(this.root);
      const st = this.step;
      const body = h("main", { class: "xz-main", id: "xz-main" });
      ICU.append(this.root, this.topbar(), body, this.drawerEl());
      const fn = {
        intro: this.rIntro,
        free: this.rFree,
        train: this.rTrain,
        find: this.rFind,
        attr: this.rAttr,
        blind: this.rBlind,
        reveal: this.rReveal,
        survey: this.rSurvey,
        interview: this.rInterview,
        done: this.rDone,
      }[st.key];
      fn.call(this, body, st.sub);
    },
    topbar() {
      const groups = [];
      for (const st of Plan.STAGES) {
        if (st.key === "done") continue;
        const idx = this.steps.map((x, i) => [x, i]).filter(([x]) => x.key === st.key);
        if (!idx.length) continue;
        const done = idx.every(([, i]) => i < this.pos);
        const cur = idx.some(([, i]) => i === this.pos);
        groups.push(
          h(
            "li",
            { class: "pg" + (done ? " done" : "") + (cur ? " cur" : ""), "aria-current": cur ? "step" : null },
            h("span", { class: "pg-name" }, st.group),
            idx.length > 1
              ? h(
                  "span",
                  { class: "pg-dots", "aria-hidden": "true" },
                  idx.map(([, i]) => h("i", { class: i < this.pos ? "d" : i === this.pos ? "c" : "" })),
                )
              : null,
          ),
        );
      }
      const doneStep = this.step.key === "done";
      return h(
        "header",
        { class: "xz-top" },
        h("div", { class: "xz-brand" }, h("span", { class: "iso-mark", "aria-hidden": "true" }), "集合预报等值线 · 专家评估"),
        h("ol", { class: "progress", "aria-label": "进度" }, groups),
        h("div", { class: "xz-count" }, doneStep ? "已完成" : `第 ${this.pos + 1} / ${this.steps.length - 1} 步`),
      );
    },
    footer(opts) {
      const back = this.canBack()
        ? h("button", { type: "button", class: "btn ghost", onclick: () => this.go(-1) }, "← 上一步")
        : h("span", { class: "nav-spacer" });
      const next = h("button", { type: "button", class: "btn primary big", id: "btn-next", onclick: opts.onNext || (() => this.go(1)) }, opts.label || "继续 →");
      const hint = h("span", { class: "nav-hint", id: "nav-hint" }, "");
      const set = (ok, msg) => {
        next.disabled = !ok;
        hint.textContent = ok ? "" : msg || "";
      };
      set(opts.ok ? opts.ok() : true, opts.why ? opts.why() : "");
      const f = h("div", { class: "xz-nav" }, back, h("div", { class: "nav-r" }, hint, next));
      f.refresh = () => set(opts.ok ? opts.ok() : true, opts.why ? opts.why() : "");
      return f;
    },
    stageHead(eyebrow, title, sub) {
      return h("div", { class: "stage-head" }, h("div", { class: "eyebrow" }, eyebrow), h("h1", null, title), sub ? h("p", { class: "lede" }, sub) : null);
    },
    legend(c, idxs, opts = {}) {
      const sorted = idxs.slice().sort((a, b) => a - b);
      const items = sorted.map((idx, j) => {
        const st = lineStyle(j);
        const item = h(
          "button",
          {
            type: "button",
            class: "lg" + (opts.focus === idx ? " on" : ""),
            dataset: { idx: String(idx) },
            onpointerenter: () => opts.onHover && opts.onHover(idx),
            onpointerleave: () => opts.onHover && opts.onHover(null),
            onfocus: () => opts.onHover && opts.onHover(idx),
            onblur: () => opts.onHover && opts.onHover(null),
            onclick: () => opts.onClick && opts.onClick(idx),
          },
          h("span", { class: "lg-sw" + (st.dash ? " dashed" : ""), style: { "--c": st.color } }),
          h("span", null, `线 ${j + 1}`),
          opts.values ? h("span", { class: "lg-v" }, fmtVal(c.candidates[idx], c.unit)) : null,
        );
        return item;
      });
      return h("div", { class: "legend", role: "group", "aria-label": "图例" }, items);
    },
    caseTitle(c) {
      return `${c.element} · +${c.leadH} 小时预报`;
    },

    /* =====================================================================
     * 1 开场
     * ===================================================================== */
    rIntro(body) {
      const s = this.s;
      s.consent = s.consent || { record: false, anon: false, quit: false };
      s.bg = s.bg || {};
      if (!s.introAt) s.introAt = Date.now();
      const nav = this.footer({
        ok: () => Content.consent.every((c) => s.consent[c.key]) && Content.bg.every((b) => s.bg[b.key] != null && s.bg[b.key] !== ""),
        why: () => (!Content.consent.every((c) => s.consent[c.key]) ? "三项同意都勾选后才能继续" : "请把右侧背景信息填完"),
        label: "开始 →",
      });
      const agenda = Plan.STAGES.filter((x) => x.key !== "done" && this.steps.some((y) => y.key === x.key)).map((x) =>
        h("li", null, h("span", null, x.group), h("span", { class: "mins" }, `${x.mins} 分钟`)),
      );
      const consent = Content.consent.map((c) =>
        h(
          "label",
          { class: "check-row big" },
          h("input", {
            type: "checkbox",
            id: `consent-${c.key}`,
            checked: s.consent[c.key],
            onchange: (e) => {
              s.consent[c.key] = e.target.checked;
              s.consent.at = Date.now();
              this.commit();
              nav.refresh();
            },
          }),
          h("span", null, c.text),
        ),
      );
      const bg = Content.bg.map((b) => {
        if (b.type === "number")
          return q(
            b.q,
            h(
              "div",
              { class: "num-row" },
              h("input", {
                type: "number",
                min: "0",
                max: "60",
                step: "1",
                class: "num",
                id: `bg-${b.key}`,
                value: s.bg[b.key] != null ? String(s.bg[b.key]) : "",
                oninput: (e) => {
                  s.bg[b.key] = e.target.value === "" ? null : Number(e.target.value);
                  this.commit();
                  nav.refresh();
                },
              }),
              h("span", { class: "suffix" }, b.suffix),
            ),
          );
        const otherInput = b.other
          ? h("input", {
              type: "text",
              class: "txt other",
              id: `bg-${b.key}-other`,
              placeholder: "请说明",
              value: s.bg[b.key + "Other"] || "",
              oninput: (e) => {
                s.bg[b.key + "Other"] = e.target.value;
                this.commit();
              },
            })
          : null;
        if (otherInput) otherInput.hidden = s.bg[b.key] !== b.other;
        return q(
          b.q,
          choice(
            b.opts.map((o) => ({ value: o, label: o })),
            s.bg[b.key],
            (v) => {
              s.bg[b.key] = v;
              if (otherInput) otherInput.hidden = v !== b.other;
              this.commit();
              nav.refresh();
            },
            "wrap",
          ),
          otherInput,
        );
      });
      ICU.append(body, 
        h(
          "div",
          { class: "intro-grid" },
          h(
            "section",
            { class: "intro-left" },
            h("div", { class: "eyebrow" }, "开场 · 约 3 分钟"),
            h("h1", { class: "display" }, "感谢您抽出时间"),
            h("p", { class: "lede" }, Content.introText),
            h("ol", { class: "agenda" }, agenda),
            h("div", { class: "consent" }, h("h2", null, "知情同意"), consent),
          ),
          h("section", { class: "card intro-right" }, h("h2", null, "关于您"), h("p", { class: "muted small" }, "只用于描述参与者构成，论文中不会出现可识别身份的信息。"), bg),
        ),
        nav,
      );
    },

    /* =====================================================================
     * 2 凭经验选线
     * ===================================================================== */
    rFree(body) {
      const s = this.s;
      const c = Cases.get("free");
      const k = s.k;
      s.free = s.free || { values: [], clicks: [], reason: "" };
      const F = s.free;
      const locked = !!F.doneAt;
      let preview = null;
      if (s.opts.freeStep2 && locked && !(F.step2 && F.step2.doneAt)) return this.rFreeStep2(body, c, k);
      const m = this.map({ case: c, ariaLabel: "集合平均场", readoutValue: true });
      const draw = () => {
        const sel = F.values.slice().sort((a, b) => a - b);
        const lv = sel.map((idx) => ({ idx, color: "#15191d", members: false, mean: true, width: 2.1, label: fmtVal(c.candidates[idx]) }));
        if (preview != null && !sel.includes(preview)) lv.push({ idx: preview, color: "#6b7580", members: false, mean: true, width: 1.6, dash: [5, 4], label: fmtVal(c.candidates[preview]) });
        m.setLevels(lv);
      };
      const counter = h("div", { class: "counter" });
      const grid = h("div", { class: "cand-grid", role: "group", "aria-label": "候选值" });
      const nav = this.footer({
        ok: () => locked || F.values.length === k,
        why: () => `还需再选 ${k - F.values.length} 个`,
        label: locked ? "继续 →" : "选好了 →",
        onNext: async () => {
          if (!locked) {
            F.doneAt = Date.now();
            F.ms = F.doneAt - (F.startAt || this.stepStart());
            F.valuesV = F.values
              .slice()
              .sort((a, b) => a - b)
              .map((i) => c.candidates[i]);
            this.commitNow();
            if (s.opts.freeStep2) return this.render();
          }
          this.go(1);
        },
      });
      if (!F.startAt) F.startAt = this.stepStart();
      const refresh = () => {
        counter.innerHTML = "";
        ICU.append(counter, h("b", null, String(F.values.length)), ` / ${k}`, h("span", null, " 已选"));
        counter.classList.toggle("full", F.values.length === k);
        for (const b of grid.children) {
          const idx = Number(b.dataset.idx);
          b.classList.toggle("on", F.values.includes(idx));
          b.setAttribute("aria-pressed", F.values.includes(idx) ? "true" : "false");
        }
        draw();
        nav.refresh();
      };
      c.candidates.forEach((v, idx) => {
        ICU.append(grid, 
          h(
            "button",
            {
              type: "button",
              class: "cand",
              disabled: locked,
              dataset: { idx: String(idx) },
              onpointerenter: () => {
                preview = idx;
                draw();
              },
              onpointerleave: () => {
                preview = null;
                draw();
              },
              onclick: () => {
                const at = F.values.indexOf(idx);
                if (at >= 0) {
                  F.values.splice(at, 1);
                  F.clicks.push({ t: Date.now() - F.startAt, idx, v, op: "remove" });
                } else {
                  if (F.values.length >= k) {
                    toast(`已经选满 ${k} 条，请先取消一条再选`, "warn");
                    return;
                  }
                  F.values.push(idx);
                  F.clicks.push({ t: Date.now() - F.startAt, idx, v, op: "add" });
                }
                this.commit();
                refresh();
              },
            },
            fmtVal(v),
          ),
        );
      });

      ICU.append(body, 
        this.stageHead("凭经验选线", `假设只能画 ${k} 条等值线`, "图上只有集合平均场（灰度越深数值越高）。点右侧的数值，平均场的那条线会画出来，帮您判断它在哪；鼠标停在数值上可以先预览。"),
        h(
          "div",
          { class: "work" },
          h("div", { class: "work-map" }, h("div", { class: "map-title" }, h("span", null, this.caseTitle(c)), h("span", { class: "unit" }, c.unit)), m.el),
          h(
            "aside",
            { class: "work-side" },
            h("div", { class: "card sticky" },
              h("p", { class: "instr" }, Content.freeInstruction(k)),
              h("div", { class: "cand-head" }, h("span", { class: "qlabel" }, `候选值（${c.unit}）`), counter),
              grid,
              locked ? h("div", { class: "locked-note" }, "这一步已经提交，选值不再改动。") : null,
              q("理由（边选边说，主持人代记）", textArea(F.reason, (v) => ((F.reason = v), this.commit()), "例如：1008 这条是低压外围，成员在这里最可能散开……", 5, "free-reason")),
            ),
          ),
        ),
        nav,
      );
      refresh();
    },
    /** 可选第二步：逐级翻看成员线后可以修改 */
    rFreeStep2(body, c, k) {
      const s = this.s,
        F = s.free;
      F.step2 = F.step2 || { values: F.values.slice(), clicks: [], startAt: Date.now() };
      const S2 = F.step2;
      let cur = S2.values[0] != null ? S2.values[0] : Math.floor(c.candidates.length / 2);
      const m = this.map({ case: c, ariaLabel: "逐级翻看" });
      const valEl = h("div", { class: "slider-val" });
      const slider = h("input", { type: "range", min: "0", max: String(c.candidates.length - 1), step: "1", value: String(cur), class: "range", id: "free2-slider", "aria-label": "候选值" });
      const toggle = h("button", { type: "button", class: "btn" });
      const counter = h("div", { class: "counter" });
      const nav = this.footer({
        ok: () => S2.values.length === k,
        why: () => `需要正好 ${k} 个（现在 ${S2.values.length} 个）`,
        label: "确定 →",
        onNext: () => {
          S2.doneAt = Date.now();
          S2.ms = S2.doneAt - S2.startAt;
          S2.valuesV = S2.values
            .slice()
            .sort((a, b) => a - b)
            .map((i) => c.candidates[i]);
          this.commitNow();
          this.go(1);
        },
      });
      const draw = () => {
        const inSel = S2.values.includes(cur);
        m.setLevels([{ idx: cur, color: inSel ? "#1c6e6a" : "#b04a2f", members: true, mean: true, band: false, alpha: 0.45 }]);
        valEl.textContent = fmtVal(c.candidates[cur], c.unit);
        toggle.textContent = inSel ? "从我的选择中去掉" : "加入我的选择";
        toggle.className = "btn " + (inSel ? "ghost" : "primary");
        counter.textContent = `${S2.values.length} / ${k}`;
        nav.refresh();
      };
      slider.addEventListener("input", () => {
        cur = Number(slider.value);
        draw();
      });
      toggle.addEventListener("click", () => {
        const at = S2.values.indexOf(cur);
        if (at >= 0) S2.values.splice(at, 1);
        else {
          if (S2.values.length >= k) return toast(`已经 ${k} 个了，先去掉一个`, "warn");
          S2.values.push(cur);
        }
        S2.clicks.push({ t: Date.now() - S2.startAt, idx: cur, op: at >= 0 ? "remove" : "add" });
        this.commit();
        draw();
      });
      const keys = (e) => {
        if (/INPUT|TEXTAREA/.test(e.target.tagName) && e.target !== slider) return;
        if (e.key === "ArrowRight") cur = Math.min(c.candidates.length - 1, cur + 1);
        else if (e.key === "ArrowLeft") cur = Math.max(0, cur - 1);
        else return;
        slider.value = String(cur);
        draw();
      };
      document.addEventListener("keydown", keys);
      this.cleanups.push(() => document.removeEventListener("keydown", keys));
      ICU.append(body, 
        this.stageHead("凭经验选线 · 第二步", "逐级翻看全部成员线", "现在可以看到每个数值上全部成员的线。拖动滑条（或用 ← →）逐级翻看；如果想改，就加入或去掉。"),
        h(
          "div",
          { class: "work" },
          h("div", { class: "work-map" }, h("div", { class: "map-title" }, h("span", null, this.caseTitle(c)), valEl), m.el),
          h("aside", { class: "work-side" }, h("div", { class: "card sticky" }, h("div", { class: "qlabel" }, "候选值"), slider, h("div", { class: "row gap" }, toggle, counter), q("修改理由（主持人代记）", textArea(S2.reason, (v) => ((S2.reason = v), this.commit()), "", 4)))),
        ),
        nav,
      );
      draw();
    },

    /* =====================================================================
     * 3 读图训练（只记用时）
     * ===================================================================== */
    rTrain(body) {
      const s = this.s;
      const c = Cases.get("train");
      s.train = s.train || {};
      // 训练用均匀间隔，避免提前熟悉某一种画法的"样子"；降水 0 mm 这类画不出线的值去掉
      const idxs = c.sel.uniform.filter((i) => {
        const g = Geo.level(c, i);
        return g.mean.length > 0 || g.members.some((s) => s.length > 0);
      });
      const util = c.util || c.scu.mean;
      let focus = idxs.reduce((a, b) => (util[b] > util[a] ? b : a), idxs[0]);
      let hover = null;
      const m = this.map({ case: c, ariaLabel: "训练图" });
      const stripBox = h("div", { class: "strip-box" });
      const draw = () => {
        const f = hover != null ? hover : focus;
        m.setLevels(styledLevels(c, idxs, (idx) => ({ fade: idx === f ? 1 : 0.3, band: idx === f })));
        ICU.fill(stripBox, Charts.attrStrip(c, f, { curves: true }));
        for (const b of legend.children) b.classList.toggle("on", Number(b.dataset.idx) === focus);
      };
      const legend = this.legend(c, idxs, {
        values: true,
        focus,
        onHover: (i) => {
          hover = i;
          draw();
        },
        onClick: (i) => {
          focus = i;
          draw();
        },
      });
      const card = Content.readCard.map((r) => h("li", null, h("span", { class: `glyph g-${r.sym}`, "aria-hidden": "true" }), h("b", null, r.title), h("span", null, r.text)));
      const terms = Content.terms.map((t) => h("li", null, h("b", null, t.name), h("span", null, t.text)));
      const nav = this.footer({
        onNext: () => {
          s.train.ms = Date.now() - this.stepStart();
          this.commitNow();
          this.go(1);
        },
      });
      ICU.append(body, 
        this.stageHead("读图训练", "先熟悉一下这种图怎么看", "这一张只是练习，随便问、随便点。点下方图例里的某条线，会单独突出它，并在右侧显示它的归因条。"),
        h(
          "div",
          { class: "work" },
          h("div", { class: "work-map" }, h("div", { class: "map-title" }, h("span", null, this.caseTitle(c)), h("span", { class: "unit" }, c.unit)), m.el, legend),
          h(
            "aside",
            { class: "work-side" },
            h(
              "div",
              { class: "card sticky" },
              h("h3", null, "读图卡"),
              h("ul", { class: "readcard" }, card),
              h("h3", null, "归因条的三种说法"),
              h("ul", { class: "terms" }, terms),
              h("p", { class: "muted small" }, "归因条下方的曲线还给出每个数值上的情况；竖线指的是当前这条线。"),
              stripBox,
            ),
          ),
        ),
        nav,
      );
      draw();
    },

    /* =====================================================================
     * 4 找分歧（主要数据来源）
     * ===================================================================== */
    rFind(body, sub) {
      const s = this.s;
      const caseKey = s.plan.order[sub];
      const c = Cases.get(caseKey);
      const method = s.plan.assign[caseKey];
      const code = s.plan.codes[caseKey];
      const idxs = c.sel[method].slice().sort((a, b) => a - b);
      s.find = s.find || [];
      let F = s.find[sub];
      if (!F || F.caseKey !== caseKey) {
        F = s.find[sub] = { order: sub, caseKey, caseId: c.id, code, method, levels: idxs, values: idxs.map((i) => c.candidates[i]), marks: [], q1: null, q2: "", startedAt: Date.now(), source: c.source, showValues: !!s.opts.showValues };
        this.commitNow();
      }
      const readOnly = !!F.submittedAt;
      let selected = null;
      let hover = null;
      const m = this.map({
        case: c,
        ariaLabel: `图 ${code}`,
        onClick: (gx, gy, ev, hit) => {
          if (readOnly) return;
          if (hit) {
            selected = hit.id;
            drawMarks();
            return;
          }
          if (gx < 0 || gy < 0 || gx > c.nx - 1 || gy > c.ny - 1) return;
          const near = idxs.map((idx, j) => (Geo.bandNear(c, idx, gx, gy, 3) ? j + 1 : null)).filter((x) => x != null);
          const ll = Geo.gridToLatLon(c, gx, gy);
          const id = (F.marks.reduce((a, mk) => Math.max(a, mk.id), 0) || 0) + 1;
          F.marks.push({ id, x: +gx.toFixed(2), y: +gy.toFixed(2), lat: +ll.lat.toFixed(2), lon: +ll.lon.toFixed(2), type: null, near, t: Date.now() - F.startedAt });
          selected = id;
          this.commit();
          drawMarks();
        },
        onMarkerDrag: readOnly
          ? null
          : (id, gx, gy) => {
              const mk = F.marks.find((x) => x.id === id);
              if (!mk) return;
              mk.x = +gx.toFixed(2);
              mk.y = +gy.toFixed(2);
              const ll = Geo.gridToLatLon(c, gx, gy);
              mk.lat = +ll.lat.toFixed(2);
              mk.lon = +ll.lon.toFixed(2);
              mk.near = idxs.map((idx, j) => (Geo.bandNear(c, idx, gx, gy, 3) ? j + 1 : null)).filter((x) => x != null);
              mk.moved = (mk.moved || 0) + 1;
              selected = id;
              this.commit();
              drawMarks();
            },
      });
      const drawLines = () => m.setLevels(styledLevels(c, idxs, (idx) => ({ fade: hover == null || hover === idx ? 1 : 0.18 })));
      const list = h("ol", { class: "marks", "aria-label": "已标出的分歧" });
      const count = h("span", { class: "pill" });
      const drawMarks = () => {
        m.setMarkers(F.marks.map((mk, i) => ({ id: mk.id, x: mk.x, y: mk.y, n: i + 1, selected: mk.id === selected })));
        clear(list);
        count.textContent = `${F.marks.length} 处`;
        if (!F.marks.length) ICU.append(list, h("li", { class: "empty" }, "还没有标点。在地图上点一下即可标出一处分歧；标点可以拖动。"));
        F.marks.forEach((mk, i) => {
          ICU.append(list, 
            h(
              "li",
              { class: "mk" + (mk.id === selected ? " sel" : ""), onclick: () => ((selected = mk.id), drawMarks()) },
              h("span", { class: "mk-n" }, String(i + 1)),
              h(
                "div",
                { class: "mk-body" },
                h("div", { class: "mk-meta" }, c.hasGeo ? fmtLatLon(mk.lat, mk.lon) : `(${mk.x.toFixed(0)}, ${mk.y.toFixed(0)})`, mk.near.length ? h("span", { class: "near" }, `附近：${mk.near.map((n) => `线 ${n}`).join("、")}`) : null),
                readOnly
                  ? h("div", { class: "mk-type" }, mk.type || "未选类型")
                  : choice(
                      Content.markTypes.map((t) => ({ value: t, label: t })),
                      mk.type,
                      (v) => {
                        mk.type = v;
                        this.commit();
                      },
                      "tiny",
                    ),
              ),
              readOnly
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      class: "icon-btn",
                      "aria-label": `删除第 ${i + 1} 处`,
                      title: "删除",
                      onclick: (e) => {
                        e.stopPropagation();
                        F.marks.splice(F.marks.indexOf(mk), 1);
                        F.deleted = (F.deleted || 0) + 1;
                        this.commit();
                        drawMarks();
                      },
                    },
                    "×",
                  ),
            ),
          );
        });
      };
      const keys = (e) => {
        if (readOnly || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        if ((e.key === "Delete" || e.key === "Backspace") && selected != null) {
          const at = F.marks.findIndex((x) => x.id === selected);
          if (at >= 0) {
            F.marks.splice(at, 1);
            selected = null;
            this.commit();
            drawMarks();
          }
        }
      };
      document.addEventListener("keydown", keys);
      this.cleanups.push(() => document.removeEventListener("keydown", keys));

      const legend = this.legend(c, idxs, {
        values: F.showValues,
        onHover: (i) => {
          hover = i;
          drawLines();
        },
      });
      const nav = this.footer({
        ok: () => readOnly || F.q1 != null,
        why: () => "请先回答 Q1",
        label: readOnly ? "继续 →" : sub < s.plan.order.length - 1 ? "提交这张图 →" : "提交最后一张 →",
        onNext: async () => {
          if (!readOnly) {
            const untyped = F.marks.filter((x) => !x.type).length;
            const ok = await confirmBox(
              "提交这张图？",
              h("div", null, h("p", null, `您在图 ${code} 上标出了 ${F.marks.length} 处分歧${untyped ? `（其中 ${untyped} 处没选类型，也可以）` : ""}。`), h("p", null, "提交后不能返回修改。")),
              "提交",
            );
            if (!ok) return;
            F.submittedAt = Date.now();
            F.ms = F.submittedAt - F.startedAt;
            F.zoomed = F.zoomed || false;
            this.commitNow();
          }
          this.go(1);
        },
      });
      const q1 = likert(F.q1, (v) => {
        F.q1 = v;
        this.commit();
        nav.refresh();
      });
      if (readOnly) q1.classList.add("readonly");
      ICU.append(body, 
        h(
          "div",
          { class: "stage-head find-head" },
          h("div", { class: "eyebrow" }, `找分歧 · 第 ${sub + 1} / ${s.plan.order.length} 张`),
          h("h1", null, h("span", { class: "fig-code" }, `图 ${code}`), h("span", { class: "fig-sub" }, this.caseTitle(c))),
          h("p", { class: "lede" }, Content.findInstruction),
        ),
        h(
          "div",
          { class: "work" },
          h("div", { class: "work-map" }, h("div", { class: "map-title" }, h("span", null, `图 ${code}`), h("span", { class: "unit" }, `${idxs.length} 条等值线 · ${c.M} 个成员`)), m.el, legend),
          h(
            "aside",
            { class: "work-side" },
            h(
              "div",
              { class: "card sticky" },
              readOnly ? h("div", { class: "locked-note" }, "这张图已提交，只能查看。") : null,
              h("div", { class: "side-head" }, h("h3", null, "标出的分歧"), count),
              list,
              q(h("span", null, h("b", null, "Q1　"), Content.q1), q1),
              q(h("span", null, h("b", null, "Q2　"), Content.q2), textArea(F.q2, (v) => ((F.q2 = v), this.commit()), "例如：东北角那块低压，成员其实分成两团……", 3, `find-q2-${sub}`)),
            ),
          ),
        ),
        nav,
      );
      m.el.addEventListener("wheel", () => {
        if (!F.zoomed) {
          F.zoomed = true;
          this.commit();
        }
      }, { passive: true });
      drawLines();
      drawMarks();
    },

    /* =====================================================================
     * 5 归因
     * ===================================================================== */
    rAttr(body, sub) {
      const s = this.s;
      const caseKey = Plan.ATTR_CASES[sub];
      const c = Cases.get(caseKey);
      const idxs = c.sel.ours.slice().sort((a, b) => a - b);
      const util = c.util || c.scu.mean;
      const idx = idxs.reduce((a, b) => (util[b] > util[a] ? b : a), idxs[0]);
      s.attr = s.attr || [];
      let A = s.attr[sub];
      if (!A || A.caseKey !== caseKey) {
        const G = c.desc.G[idx],
          C = c.desc.C[idx],
          T = c.desc.T[idx];
        const sys = [
          ["G", G],
          ["C", C],
          ["T", T],
        ].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        A = s.attr[sub] = { caseKey, caseId: c.id, idx, value: c.candidates[idx], G, C, T, F: c.desc.F ? c.desc.F[idx] : undefined, sys, choice: null, agree: null, text: "", startedAt: Date.now(), source: c.source };
        this.commitNow();
      }
      const m = this.map({ case: c, ariaLabel: "归因图" });
      m.setLevels(
        styledLevels(c, idxs, (i) => (i === idx ? { fade: 1, band: true, width: 3 } : { fade: 0.22 })),
      );
      const j = idxs.indexOf(idx);
      const st = lineStyle(j);
      const nav = this.footer({
        ok: () => A.choice != null && A.agree != null,
        why: () => (A.choice == null ? "请先选择分歧主要来自哪一种" : "请给第 2 题打分"),
        onNext: () => {
          A.ms = Date.now() - this.stepStart();
          A.doneAt = Date.now();
          this.commitNow();
          this.go(1);
        },
      });
      ICU.append(body, 
        h(
          "div",
          { class: "stage-head" },
          h("div", { class: "eyebrow" }, `读归因条 · 第 ${sub + 1} / ${Plan.ATTR_CASES.length} 题`),
          h("h1", null, "请看图中加粗的这条线", h("span", { class: "line-chip", style: { "--c": st.color } }, fmtVal(c.candidates[idx], c.unit))),
          h("p", { class: "lede" }, "浅色带是这条线上成员分歧所在的区域（约一半成员认为超过这个值）。其余线已调淡。"),
        ),
        h(
          "div",
          { class: "work" },
          h("div", { class: "work-map" }, h("div", { class: "map-title" }, h("span", null, this.caseTitle(c)), h("span", { class: "unit" }, c.unit)), m.el),
          h(
            "aside",
            { class: "work-side" },
            h(
              "div",
              { class: "card sticky" },
              h("h3", null, "归因条"),
              Charts.attrStrip(c, idx, {}),
              q(
                h("span", null, h("b", null, "1　"), Content.attrQ1),
                choice(
                  Content.attrChoices.map((x) => ({ value: x.key, label: x.label, hint: x.hint })),
                  A.choice,
                  (v) => {
                    A.choice = v;
                    this.commit();
                    nav.refresh();
                  },
                  "stack",
                ),
              ),
              q(
                h("span", null, h("b", null, "2　"), Content.attrQ2),
                likert(A.agree, (v) => {
                  A.agree = v;
                  this.commit();
                  nav.refresh();
                }),
              ),
              q(h("span", null, h("b", null, "3　"), Content.attrQ3), textArea(A.text, (v) => ((A.text = v), this.commit()), "逐字记录专家的物理解释", 4, `attr-text-${sub}`)),
            ),
          ),
        ),
        nav,
      );
    },

    /* =====================================================================
     * 6 三张图对比（盲）
     * ===================================================================== */
    rBlind(body) {
      const s = this.s;
      const c = Cases.get("free");
      s.blind = s.blind || { order: s.plan.blindOrder.map((mm) => s.plan.blindCodes[mm]), r1: null, r1why: "", r2a: null, r2b: null };
      const B = s.blind;
      if (!B.startedAt) B.startedAt = Date.now();
      const codeToMethod = Object.fromEntries(Object.entries(s.plan.blindCodes).map(([mm, cd]) => [cd, mm]));
      const cards = s.plan.blindOrder.map((method) => {
        const code = s.plan.blindCodes[method];
        const idxs = c.sel[method];
        const m = this.map({ case: c, ariaLabel: `图 ${code}`, readout: false, maxHeight: 420 });
        m.setLevels(styledLevels(c, idxs));
        return h(
          "figure",
          { class: "blind-card" },
          h("figcaption", null, h("span", { class: "fig-code" }, `图 ${code}`), h("button", { type: "button", class: "btn small ghost", onclick: () => this.zoomFigure(c, idxs, code) }, "放大看")),
          m.el,
        );
      });
      const opts = s.plan.blindOrder.map((mm) => ({ value: s.plan.blindCodes[mm], label: `图 ${s.plan.blindCodes[mm]}` }));
      const decode = () => {
        B.decoded = { r1: codeToMethod[B.r1] || null, r2a: codeToMethod[B.r2a] || null, r2b: codeToMethod[B.r2b] || null };
      };
      const nav = this.footer({
        ok: () => B.r1 && B.r2a && B.r2b,
        why: () => "三个问题都选一张图后才能继续",
        onNext: () => {
          B.ms = Date.now() - B.startedAt;
          decode();
          this.commitNow();
          this.go(1);
        },
      });
      const set = (key) => (v) => {
        B[key] = v;
        decode();
        this.commit();
        nav.refresh();
      };
      ICU.append(body, 
        this.stageHead("三张图对比", "同一个场、同样多的线，三种画法", `三张图都是${this.caseTitle(c)}，都画 ${s.k} 条线，只是选的数值不同。可以点“放大看”。`),
        h("div", { class: "blind-grid" }, cards),
        h(
          "div",
          { class: "blind-qs" },
          h("div", { class: "card" }, q(h("span", null, h("b", null, "R1　"), Content.blindR1), choice(opts, B.r1, set("r1"), "wide")), textArea(B.r1why, (v) => ((B.r1why = v), this.commit()), "为什么？（主持人记录）", 3, "blind-why")),
          h("div", { class: "card" }, q(h("span", null, h("b", null, "R2a　"), Content.blindR2a), choice(opts, B.r2a, set("r2a"), "wide")), q(h("span", null, h("b", null, "R2b　"), Content.blindR2b), choice(opts, B.r2b, set("r2b"), "wide")), h("p", { class: "muted small" }, "两题可以是同一张，也可以不是。")),
        ),
        nav,
      );
    },
    zoomFigure(c, idxs, code) {
      const m = new MapView({ case: c, ariaLabel: `图 ${code}`, maxHeight: Math.round(window.innerHeight * 0.74) });
      const box = h("div", { class: "zoom-fig" }, m.el);
      m.setLevels(styledLevels(c, idxs));
      dialog({ title: `图 ${code}`, body: box, wide: true, buttons: [{ label: "关闭", value: true, kind: "primary" }] }).then(() => m.destroy());
    },

    /* =====================================================================
     * 7 选线结果对照
     * ===================================================================== */
    rReveal(body) {
      const s = this.s;
      const c = Cases.get("free");
      s.reveal = s.reveal || { t1: "", t2: "", t3: "" };
      const R = s.reveal;
      if (!R.startedAt) R.startedAt = Date.now();
      const mine = (s.free && s.free.values ? s.free.values : []).slice().sort((a, b) => a - b);
      const sys = c.sel.ours.slice().sort((a, b) => a - b);
      const shared = mine.filter((i) => sys.includes(i));
      R.overlap = shared.length;
      const mk = (idxs, title, sub) => {
        const m = this.map({ case: c, ariaLabel: title, maxHeight: 460 });
        m.setLevels(styledLevels(c, idxs));
        return h("figure", { class: "reveal-card" }, h("figcaption", null, h("b", null, title), h("span", { class: "muted" }, sub)), m.el, h("div", { class: "val-row" }, idxs.map((i) => h("span", { class: "vchip" + (shared.includes(i) ? " shared" : "") }, fmtVal(c.candidates[i]))), h("span", { class: "unit" }, c.unit)));
      };
      const nav = this.footer({
        onNext: () => {
          R.ms = Date.now() - R.startedAt;
          this.commitNow();
          this.go(1);
        },
      });
      ICU.append(body, 
        this.stageHead("选线对照", `两边共同选中 ${shared.length} 条`, "左边是您一开始凭经验选的线，右边是系统选的线，两边都画出了全部成员。"),
        mine.length
          ? h("div", { class: "reveal-grid" }, mk(mine, "您选的", `${mine.length} 条`), mk(sys, "系统选的", `${sys.length} 条`))
          : h("div", { class: "card warn-card" }, "没有找到凭经验选线的记录（这一步可能被跳过了）。"),
        h(
          "div",
          { class: "card spectrum-card" },
          h("div", { class: "side-head" }, h("h3", null, "在全部候选值上看"), h("span", { class: "legend-inline" }, h("span", { class: "key k0" }), "您选的", h("span", { class: "key k1" }), "系统选的", h("span", { class: "key ks" }), "两边都选")),
          Charts.spectrum(c, [
            { label: "您", idx: mine },
            { label: "系统", idx: sys },
          ]),
        ),
        h(
          "div",
          { class: "reveal-qs" },
          Content.revealQs.map((qq, i) => h("div", { class: "card" }, q(h("span", null, h("b", null, `${i + 1}　`), qq), textArea(R[`t${i + 1}`], (v) => ((R[`t${i + 1}`] = v), this.commit()), "主持人记录要点", 5, `reveal-t${i + 1}`)))),
        ),
        nav,
      );
    },

    /* =====================================================================
     * 8 总体问卷
     * ===================================================================== */
    rSurvey(body) {
      const s = this.s;
      s.survey = s.survey || {};
      const S = s.survey;
      const total = Plan.SURVEY_KEYS.length;
      const counter = h("div", { class: "survey-count" });
      const answered = () => Plan.SURVEY_KEYS.filter((k) => S[k] != null).length;
      const nav = this.footer({
        ok: () => answered() === total,
        why: () => `还有 ${total - answered()} 题未答（没把握可以选 NA）`,
        onNext: () => {
          S.ms = Date.now() - this.stepStart();
          this.commitNow();
          this.go(1);
        },
      });
      const refresh = () => {
        const n = answered();
        ICU.fill(counter, h("div", { class: "big-num" }, String(n), h("span", null, ` / ${total}`)), h("div", { class: "muted small" }, "已答（含 NA）"), h("div", { class: "meter" }, h("i", { style: { width: `${(n / total) * 100}%` } })));
        nav.refresh();
      };
      const groups = Content.survey.map((g) =>
        h(
          "section",
          { class: "sv-group" },
          h("h2", null, g.group),
          g.items.map((it) =>
            h(
              "div",
              { class: "sv-item" },
              h("div", { class: "sv-text" }, h("span", { class: "sv-key" }, it.key), it.text),
              likert(S[it.key], (v) => {
                S[it.key] = v;
                this.commit();
                refresh();
              }),
            ),
          ),
        ),
      );
      ICU.append(body, 
        this.stageHead("总体问卷", "最后几个判断", Content.surveyIntro),
        h("div", { class: "survey-layout" }, h("div", { class: "survey-main" }, groups), h("aside", { class: "survey-side" }, h("div", { class: "card sticky" }, counter))),
        nav,
      );
      refresh();
    },

    /* =====================================================================
     * 9 访谈
     * ===================================================================== */
    rInterview(body) {
      const s = this.s;
      s.interview = s.interview || {};
      const I = s.interview;
      const nav = this.footer({
        label: "结束访谈 →",
        onNext: () => {
          I.ms = Date.now() - this.stepStart();
          this.commitNow();
          this.go(1);
        },
      });
      ICU.append(body, 
        this.stageHead("访谈", "聊一聊", "请口头回答即可，下面的笔记由主持人记录要点。"),
        h(
          "div",
          { class: "iv-list" },
          Content.interview.map((it, i) =>
            h(
              "div",
              { class: "iv-item card" },
              h("div", { class: "iv-n" }, String(i + 1)),
              h("div", { class: "iv-body" }, h("p", { class: "iv-q" }, it.q), it.follow ? h("p", { class: "iv-follow" }, it.follow) : null, textArea(I[`q${i + 1}`], (v) => ((I[`q${i + 1}`] = v), this.commit()), "要点（主持人记录）", 3, `iv-q${i + 1}`)),
            ),
          ),
        ),
        nav,
      );
    },

    /* =====================================================================
     * 完成
     * ===================================================================== */
    rDone(body) {
      ICU.append(body, 
        h(
          "div",
          { class: "done-page" },
          h("span", { class: "iso-mark big", "aria-hidden": "true" }),
          h("h1", { class: "display" }, "非常感谢您的参与"),
          h("p", { class: "lede" }, "您的回答对我们非常重要。论文中只会以匿名编号引用，不会出现任何可识别身份的信息；录音录屏只用于研究分析。"),
          h(
            "button",
            {
              type: "button",
              class: "btn ghost",
              onclick: async () => {
                const ok = await ICU.confirmBox("回到主持人页面", "主持人页面有画法映射。请先停止共享屏幕。", "已停止共享，回去", "primary", ["我已停止共享屏幕"]);
                if (ok) ICU.App.exitToHost("results");
              },
            },
            "回到主持人页面",
          ),
        ),
      );
    },

    /* =====================================================================
     * 主持人侧栏（Shift+M）：只有计时、笔记、跳转，不含映射
     * ===================================================================== */
    drawerEl() {
      const s = this.s;
      const st = this.step;
      const stage = Plan.STAGE_BY_KEY[st.key];
      s.notes = s.notes || {};
      const noteKey = st.key;
      const ta = textArea(s.notes[noteKey], (v) => {
        s.notes[noteKey] = v;
        this.commit();
      }, "本环节笔记……", 8, "host-note");
      const insert = (txt) => {
        const pos = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        ta.value = ta.value.slice(0, pos) + txt + ta.value.slice(pos);
        s.notes[noteKey] = ta.value;
        this.commit();
        ta.focus();
      };
      const stamp = () => {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
      };
      const jumpSel = h(
        "select",
        { class: "sel", id: "host-jump", "aria-label": "跳转到" },
        this.steps.map((x, i) => h("option", { value: String(i), selected: i === this.pos ? true : null }, this.stepLabel(x))),
      );
      this.clockEls = { total: h("b", { class: "clock" }), step: h("b", { class: "clock" }), bars: h("ul", { class: "tbars" }) };
      const pal = choice(
        [
          { value: "default", label: "默认色板" },
          { value: "cvd", label: "色盲友好" },
        ],
        ICU.Map.palette,
        (v) => {
          ICU.Map.setPalette(v);
          s.opts.palette = v;
          this.commit();
        },
        "tiny",
      );
      const saveEl = h("div", { class: "save-state", id: "drawer-save" });
      this.cleanups.push(ICU.App.bindSaveState(saveEl));
      const d = h(
        "aside",
        { class: "drawer", id: "host-drawer", "aria-label": "主持人工具", hidden: !this._drawerOpen },
        h("div", { class: "drawer-head" }, h("b", null, `主持人 · ${s.pid}`), saveEl, h("button", { type: "button", class: "icon-btn", "aria-label": "关闭", onclick: () => this.toggleDrawer(false) }, "×")),
        h("div", { class: "drawer-clocks" }, h("div", null, h("span", null, "总用时"), this.clockEls.total), h("div", null, h("span", null, `本步 · 建议 ${this.suggestMins(st)} 分`), this.clockEls.step)),
        this.clockEls.bars,
        h("div", { class: "drawer-sec" }, h("div", { class: "qlabel" }, `笔记 · ${stage.group}`), ta, h("div", { class: "row gap" }, h("button", { type: "button", class: "btn small", onclick: () => insert(`[${stamp()}] `) }, "插入时间"), h("button", { type: "button", class: "btn small", onclick: () => insert(`[代操作 ${stamp()}] `) }, "标记代操作"))),
        h(
          "div",
          { class: "drawer-sec" },
          h("div", { class: "qlabel" }, "跳转"),
          h(
            "div",
            { class: "row gap" },
            jumpSel,
            h(
              "button",
              {
                type: "button",
                class: "btn small",
                onclick: async () => {
                  const i = Number(jumpSel.value);
                  if (i === this.pos) return;
                  const ok = await confirmBox("跳转环节", `跳到「${this.stepLabel(this.steps[i])}」？这会记在会话日志里。`, "跳转");
                  if (ok) this.goto(i, true);
                },
              },
              "跳转",
            ),
          ),
          h(
            "label",
            { class: "check-row" },
            h("input", {
              type: "checkbox",
              id: "opt-skip-reveal",
              checked: !!s.opts.skipReveal,
              onchange: (e) => {
                s.opts.skipReveal = e.target.checked;
                const cur = this.step;
                this.steps = Plan.stepsFor(s);
                this.pos = Math.max(0, this.steps.findIndex((x) => x.key === cur.key && x.sub === cur.sub));
                this.commitNow();
                this.render();
                this.toggleDrawer(true);
              },
            }),
            h("span", null, "超时：跳过“选线对照”"),
          ),
        ),
        h("div", { class: "drawer-sec" }, h("div", { class: "qlabel" }, "线色（专家色觉异常时切换）"), pal),
        h(
          "div",
          { class: "drawer-sec" },
          h(
            "button",
            {
              type: "button",
              class: "btn danger small",
              onclick: async () => {
                const ok = await confirmBox("中途退出到主持人区", "主持人区有画法映射。会话会保存，之后可在“新会话”页继续。", "退出", "danger", ["我已停止共享屏幕"]);
                if (ok) ICU.App.exitToHost("new");
              },
            },
            "退出到主持人区…",
          ),
        ),
      );
      this.drawer = d;
      this.updateDrawerClock();
      const handle = h("button", { type: "button", class: "drawer-handle", title: "主持人工具（Shift+M；在输入框里用 Ctrl+Shift+M）", "aria-label": "主持人工具", onclick: () => this.toggleDrawer() }, h("span", null), h("span", null), h("span", null));
      return h("div", null, handle, d);
    },
    toggleDrawer(force) {
      this._drawerOpen = force != null ? force : !this._drawerOpen;
      if (this.drawer) this.drawer.hidden = !this._drawerOpen;
      if (this._drawerOpen) {
        this.updateDrawerClock();
        const ta = this.drawer && this.drawer.querySelector("#host-note");
        if (ta) setTimeout(() => ta.focus(), 30);
      }
    },
    stepLabel(x) {
      const st = Plan.STAGE_BY_KEY[x.key];
      if (x.key === "find") return `${st.group} · 第 ${x.sub + 1} 张`;
      if (x.key === "attr") return `${st.group} · 第 ${x.sub + 1} 题`;
      return st.group;
    },
    suggestMins(x) {
      const st = Plan.STAGE_BY_KEY[x.key];
      const n = this.steps.filter((y) => y.key === x.key).length || 1;
      return +(st.mins / n).toFixed(1);
    },
    updateDrawerClock() {
      if (!this.s || !this.clockEls || !this._drawerOpen) return;
      const log = this.s.log;
      const now = Date.now();
      const used = {};
      let total = 0;
      for (const e of log) {
        const d = (e.end || now) - e.start;
        total += d;
        used[e.stage] = (used[e.stage] || 0) + d;
      }
      this.clockEls.total.textContent = fmtDur(total);
      this.clockEls.step.textContent = fmtDur(now - this.stepStart());
      const over = now - this.stepStart() > this.suggestMins(this.step) * 60000;
      this.clockEls.step.classList.toggle("over", over);
      clear(this.clockEls.bars);
      for (const st of Plan.STAGES) {
        if (st.key === "done" || !this.steps.some((x) => x.key === st.key)) continue;
        const u = used[st.key] || 0;
        const frac = Math.min(1.4, u / (st.mins * 60000 || 1));
        ICU.append(this.clockEls.bars, 
          h(
            "li",
            { class: st.key === this.step.key ? "cur" : "" },
            h("span", { class: "tb-l" }, st.group),
            h("span", { class: "tb-bar" }, h("i", { class: frac > 1 ? "over" : "", style: { width: `${Math.min(100, frac * 100)}%` } })),
            h("span", { class: "tb-v" }, `${fmtDur(u)} / ${st.mins}′`),
          ),
        );
      }
    },
  };

  ICU.Expert = Expert;
  ICU.UI = { likert, choice, textArea, q };
})();
