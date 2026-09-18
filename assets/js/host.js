/* 主持人区（设计文档第 5 节）：新会话 / 案例数据 / 参照标注 / 结果与导出。
 * 这里能看到画法映射，顶部常驻黄色提醒。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { h, clear, Cases, Plan, Content, Store, Geo, fmtVal, fmtDateTime, fmtDur, toast, confirmBox, dialog, uid } = ICU;
  const { MapView, styledLevels } = ICU.Map;
  const { choice } = ICU.UI;
  const ML = Plan.METHOD_LABEL;
  const mchip = (m, short) => h("span", { class: `mchip m-${m}` }, short ? Plan.METHOD_SHORT[m] : ML[m]);
  const sourceChip = (src) =>
    src === "pipeline" ? h("span", { class: "chip ok" }, "流水线") : src === "upload" ? h("span", { class: "chip ok" }, "流水线 · 上传") : src === "demo" ? h("span", { class: "chip warn" }, "演示数据") : h("span", { class: "chip" }, "载入中…");

  const Host = {
    tab: "new",
    maps: [],
    cleanups: [],
    root: null,
    form: null,

    mount(root, tab) {
      this.root = root;
      if (tab) this.tab = tab;
      this.render();
    },
    unmount() {
      this.teardown();
      if (this.root) clear(this.root);
    },
    teardown() {
      for (const m of this.maps) m.destroy();
      this.maps = [];
      for (const f of this.cleanups) f();
      this.cleanups = [];
    },
    map(opts) {
      const m = new MapView(opts);
      this.maps.push(m);
      return m;
    },
    render() {
      this.teardown();
      clear(this.root);
      const tabs = [
        ["new", "新会话"],
        ["cases", "案例数据"],
        ["ref", "参照标注"],
        ["results", "结果与导出"],
      ];
      const demo = Cases.ROLES.some((r) => Cases.state[r.key] && Cases.state[r.key].source === "demo");
      const saveEl = h("div", { class: "save-state" });
      this.cleanups.push(ICU.App.bindSaveState(saveEl));
      const body = h("div", { class: "hz-body", id: "hz-body" });
      ICU.append(this.root, 
        h("div", { class: "hz-warn", role: "note" }, h("span", { class: "stripe", "aria-hidden": "true" }), h("b", null, "这一页有画法映射"), "，共享屏幕前先点「开始会话」。"),
        h(
          "header",
          { class: "hz-top" },
          h("div", { class: "hz-brand" }, h("span", { class: "iso-mark", "aria-hidden": "true" }), h("div", null, h("b", null, "等值线选值 · 专家评估"), h("span", null, "主持人区"))),
          h(
            "nav",
            { class: "tabs", role: "tablist" },
            tabs.map(([k, label]) =>
              h(
                "button",
                {
                  type: "button",
                  role: "tab",
                  class: "tab" + (this.tab === k ? " on" : ""),
                  "aria-selected": this.tab === k ? "true" : "false",
                  onclick: () => {
                    this.tab = k;
                    this.render();
                  },
                },
                label,
                k === "cases" && demo ? h("span", { class: "dot warn", title: "有角色在用演示数据" }) : null,
              ),
            ),
          ),
          saveEl,
        ),
        body,
      );
      ({ new: this.rNew, cases: this.rCases, ref: this.rRef, results: this.rResults })[this.tab].call(this, body);
    },

    /* =====================================================================
     * 5.1 新会话
     * ===================================================================== */
    nextDefaults(pilot) {
      const all = Store.listSessions();
      const formal = all.filter((s) => !s.pilot);
      if (pilot) return { pid: `T${all.filter((s) => s.pilot).length + 1}`, seq: 0 };
      let n = formal.length + 1;
      while (formal.some((s) => s.pid === `P${n}`)) n++;
      return { pid: `P${n}`, seq: formal.length };
    },
    rNew(body) {
      if (!this.form) {
        const d = this.nextDefaults(false);
        this.form = { pid: d.pid, seq: d.seq, pilot: false, dropC3: false, showValues: false, freeStep2: false, skipReveal: false, touched: false };
      }
      const F = this.form;
      const free = Cases.get("free");
      const k = free ? free.k : "—";
      const preview = h("div", { class: "plan-preview" });
      const checks = h("ul", { class: "checks" });
      const startBtn = h("button", { type: "button", class: "btn primary big", id: "btn-start", onclick: () => this.start() }, "开始会话 →");
      const warn = h("div", { class: "start-warn" });

      const refresh = () => {
        const plan = Plan.makePlan(F.seq, { dropC3: F.dropC3 });
        ICU.fill(preview, 
          h("h3", null, `配法 ${F.seq}`, h("span", { class: "muted small" }, `　模板 ${F.seq % 8 < 4 ? "A" : "B"} · Williams 第 ${(F.seq % 4) + 1} 行`)),
          h(
            "table",
            { class: "tbl compact" },
            h("thead", null, h("tr", null, ["出场", "案例", "盲化编号", "画法", "线数"].map((x) => h("th", null, x)))),
            h(
              "tbody",
              null,
              plan.order.map((ck, i) => {
                const c = Cases.get(ck);
                return h("tr", null, h("td", { class: "num" }, i + 1), h("td", null, h("b", null, ck), h("span", { class: "muted small" }, `　${c ? c.id : ""}`)), h("td", { class: "mono big-code" }, plan.codes[ck]), h("td", null, mchip(plan.assign[ck])), h("td", { class: "num" }, c ? c.sel[plan.assign[ck]].length : "—"));
              }),
            ),
          ),
          F.dropC3 ? h("p", { class: "muted small" }, `已去掉 C3（原本分到 ${ML[Plan.assignFor(F.seq).C3]}）。`) : null,
          h("h4", null, "三张图对比（左 → 右）"),
          h(
            "div",
            { class: "blind-preview" },
            plan.blindOrder.map((m, i) => h("div", { class: "bp" }, h("span", { class: "muted small" }, ["左", "中", "右"][i]), h("span", { class: "mono big-code" }, plan.blindCodes[m]), mchip(m))),
          ),
        );
        // 会前检查
        const demoRoles = Cases.ROLES.filter((r) => !Cases.state[r.key] || Cases.state[r.key].source === "demo");
        const refMissing = Plan.FIND_CASES.filter((ck) => {
          const c = Cases.get(ck);
          return !c || (Store.refs[c.id] ? Store.refs[c.id].points.length : 0) < 3;
        });
        const dupPid = Store.listSessions().some((s) => s.pid === F.pid && !s._deleted);
        const items = [
          { ok: !demoRoles.length, text: demoRoles.length ? `${demoRoles.map((r) => r.key).join("、")} 还在用演示数据` : "6 个角色都已载入流水线数据" },
          { ok: !refMissing.length, text: refMissing.length ? `参照标注未完成：${refMissing.join("、")}（每个案例至少 3 处）` : "参照标注已完成 C1–C4" },
          { ok: !dupPid, text: dupPid ? `编号 ${F.pid} 已存在` : `编号 ${F.pid} 可用` },
          { ok: Store.mode === "cloud", soft: true, text: Store.mode === "cloud" ? "数据写入主持人账号下的数据库" : "当前只存本机浏览器（本地运行）；记得会后导出" },
        ];
        ICU.fill(checks, items.map((it) => h("li", { class: it.ok ? "ok" : it.soft ? "soft" : "bad" }, h("span", { class: "ck", "aria-hidden": "true" }), it.text)));
        const hard = items.filter((it) => !it.ok && !it.soft);
        clear(warn);
        if (hard.length && !F.pilot) ICU.append(warn, h("span", { class: "chip warn" }, "有未满足的会前检查"), h("span", { class: "muted small" }, "不阻止开始；预实验可以用演示数据。"));
        if (F.pilot) ICU.append(warn, h("span", { class: "chip" }, "预实验：结果默认不进汇总"));
      };

      const inp = (id, label, val, onInput, attrs = {}) =>
        h("label", { class: "field" }, h("span", null, label), h("input", Object.assign({ id, class: "txt", value: String(val), oninput: (e) => onInput(e.target.value) }, attrs)));
      const opt = (id, key, label, hint) =>
        h(
          "label",
          { class: "check-row" },
          h("input", {
            type: "checkbox",
            id,
            checked: F[key],
            onchange: (e) => {
              F[key] = e.target.checked;
              refresh();
            },
          }),
          h("span", null, label, hint ? h("span", { class: "muted small" }, `　${hint}`) : null),
        );
      const pidInput = inp("new-pid", "参与者编号", F.pid, (v) => {
        F.pid = v.trim();
        F.touched = true;
        refresh();
      });
      const seqInput = inp(
        "new-seq",
        "配法序号",
        F.seq,
        (v) => {
          F.seq = Math.max(0, parseInt(v, 10) || 0);
          refresh();
        },
        { type: "number", min: "0", step: "1" },
      );
      const pilotBox = h(
        "label",
        { class: "check-row" },
        h("input", {
          type: "checkbox",
          id: "new-pilot",
          checked: F.pilot,
          onchange: (e) => {
            F.pilot = e.target.checked;
            if (!F.touched) {
              const d = this.nextDefaults(F.pilot);
              F.pid = d.pid;
              F.seq = d.seq;
              pidInput.querySelector("input").value = F.pid;
              seqInput.querySelector("input").value = String(F.seq);
            }
            refresh();
          },
        }),
        h("span", null, "预实验会话", h("span", { class: "muted small" }, "　结果不进论文，汇总时默认排除")),
      );

      ICU.append(body, 
        h(
          "div",
          { class: "new-grid" },
          h(
            "section",
            { class: "card" },
            h("h2", null, "新会话"),
            h("div", { class: "fields" }, pidInput, seqInput),
            pilotBox,
            h("div", { class: "kv" }, h("span", null, "凭经验选线的条数 k"), h("b", { class: "mono" }, String(k)), h("span", { class: "muted small" }, `= 流水线在 ${free ? free.id : "gefs_PRMSL_fh084"} 上的 |S*|，全体专家相同`)),
            h("h3", null, "选项"),
            opt("opt-drop-c3", "dropC3", "超时方案：去掉 C3", "找分歧只看 3 张；C4 湿度场始终保留"),
            opt("opt-show-values", "showValues", "找分歧时显示等值线数值", "默认关，关着盲化更强"),
            opt("opt-free-step2", "freeStep2", "凭经验选线后再逐级翻看成员线", "可选第二步，记录修改"),
            opt("opt-skip-reveal", "skipReveal", "跳过“选线对照”", "超时时先砍这一环；会话中也可在侧栏切换"),
            h("h3", null, "会前检查"),
            checks,
            h("div", { class: "start-row" }, warn, startBtn),
            h("p", { class: "muted small" }, "点「开始会话」后进入专家区，再开始共享屏幕、交出远程控制。专家区里按 Shift+M（光标在输入框里时按 Ctrl+Shift+M，或点右下角的小按钮）打开主持人侧栏：计时、笔记、跳转，不含映射。"),
          ),
          h("section", { class: "card" }, preview, this.balanceTable(F.seq)),
        ),
        this.sessionList(),
        this.checklist(),
      );
      refresh();
    },
    balanceTable(cur) {
      const done = {};
      for (const s of Store.listSessions()) if (!s.pilot) done[s.seq % 8] = (done[s.seq % 8] || 0) + 1;
      return h(
        "details",
        { class: "balance" },
        h("summary", null, "配法平衡表（8 人一轮）"),
        h(
          "table",
          { class: "tbl compact" },
          h("thead", null, h("tr", null, ["序号", "C1", "C2", "C3", "C4", "出场顺序", "已用"].map((x) => h("th", null, x)))),
          h(
            "tbody",
            null,
            Array.from({ length: 8 }, (_, i) => {
              const p = Plan.makePlan(i);
              return h("tr", { class: i === cur % 8 ? "hl" : "" }, h("td", { class: "num" }, i), Plan.FIND_CASES.map((ck) => h("td", null, mchip(p.assign[ck], true))), h("td", { class: "mono" }, p.order.join(" ")), h("td", { class: "num" }, done[i] || ""));
            }),
          ),
        ),
        h("p", { class: "muted small" }, "8 人下来每个案例配到本文方法 4 次、另两种各 2 次；出场顺序为 4×4 Williams 拉丁方。"),
      );
    },
    async start() {
      const F = this.form;
      if (!F.pid) return toast("请填写参与者编号", "warn");
      if (!Cases.ready()) return toast("案例还在载入，请稍等", "warn");
      if (Store.listSessions().some((s) => s.pid === F.pid)) {
        const ok = await confirmBox("编号重复", `已经有一个 ${F.pid} 的会话。仍然新建一个同编号的会话吗？（通常应该在下面列表里“继续”原会话）`, "仍然新建");
        if (!ok) return;
      }
      const plan = Plan.makePlan(F.seq, { dropC3: F.dropC3 });
      const free = Cases.get("free");
      const now = Date.now();
      const s = {
        id: `${F.pid.replace(/[^A-Za-z0-9_-]/g, "")}-${uid()}`,
        pid: F.pid,
        seq: F.seq,
        pilot: F.pilot,
        createdAt: now,
        updatedAt: now,
        opts: { dropC3: F.dropC3, showValues: F.showValues, freeStep2: F.freeStep2, skipReveal: F.skipReveal, palette: ICU.Map.palette },
        plan,
        k: free.k,
        cases: Object.fromEntries(Cases.ROLES.map((r) => [r.key, Cases.get(r.key).id])),
        caseSources: Object.fromEntries(Cases.ROLES.map((r) => [r.key, Cases.get(r.key).source])),
        stage: { key: "intro", sub: 0 },
        log: [],
        notes: {},
        app: { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}` },
      };
      Store.saveSession(s);
      this.form = null;
      ICU.App.startSession(s);
    },
    sessionList() {
      const list = Store.listSessions().slice().reverse();
      const stepName = (s) => {
        if (s.finishedAt) return h("span", { class: "chip ok" }, "已完成");
        const st = s.stage && Plan.STAGE_BY_KEY[s.stage.key];
        return h("span", { class: "chip" }, st ? `中断于：${st.group}${s.stage.key === "find" || s.stage.key === "attr" ? ` ${s.stage.sub + 1}` : ""}` : "未开始");
      };
      const rows = list.map((s) =>
        h(
          "tr",
          null,
          h("td", null, h("b", null, s.pid), s.pilot ? h("span", { class: "tag" }, "预实验") : null),
          h("td", { class: "num" }, s.seq),
          h("td", null, fmtDateTime(s.createdAt)),
          h("td", null, stepName(s)),
          h("td", { class: "num" }, fmtDur((s.log || []).reduce((a, e) => a + ((e.end || e.updatedAt || e.start) - e.start), 0))),
          h("td", null, Object.values(s.caseSources || {}).includes("demo") ? h("span", { class: "chip warn" }, "含演示数据") : ""),
          h(
            "td",
            { class: "actions" },
            !s.finishedAt ? h("button", { type: "button", class: "btn small", onclick: () => this.resume(s) }, "继续") : null,
            h("button", { type: "button", class: "btn small ghost", onclick: () => this.view(s) }, "查看"),
            h(
              "button",
              {
                type: "button",
                class: "btn small ghost danger-text",
                onclick: async () => {
                  const ok = await confirmBox("删除会话", `删除 ${s.pid} 的会话记录？此操作不能撤销（建议先导出 study_all.json）。`, "删除", "danger", [`确认删除 ${s.pid}`]);
                  if (ok) {
                    Store.deleteSession(s.id);
                    this.render();
                  }
                },
              },
              "删除",
            ),
          ),
        ),
      );
      return h(
        "section",
        { class: "card" },
        h("h2", null, "已有会话"),
        h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["编号", "配法", "开始", "进度", "用时", "", ""].map((x) => h("th", null, x)))), h("tbody", null, rows.length ? rows : h("tr", null, h("td", { colspan: 7, class: "empty" }, "还没有会话。"))))),
      );
    },
    async resume(s) {
      const changed = Cases.ROLES.filter((r) => s.cases && s.cases[r.key] && Cases.get(r.key) && Cases.get(r.key).source !== (s.caseSources || {})[r.key]);
      if (changed.length) {
        const ok = await confirmBox("案例来源变了", `${changed.map((r) => r.key).join("、")} 的数据来源和会话开始时不同（例如从演示换成了流水线）。继续会用现在的数据。`, "继续");
        if (!ok) return;
      }
      ICU.App.startSession(s);
    },
    view(s) {
      const sc = (s.find || []).filter(Boolean).map((f) => ({ f, sc: ICU.Score.scoreFind(f) }));
      const body = h(
        "div",
        { class: "view-session" },
        h("p", null, `配法 ${s.seq} · 开始 ${fmtDateTime(s.createdAt)} · ${s.finishedAt ? "已完成" : "未完成"}`),
        h(
          "table",
          { class: "tbl compact" },
          h("thead", null, h("tr", null, ["顺序", "案例", "编号", "画法", "标出", "找到/参照", "Q1", "用时"].map((x) => h("th", null, x)))),
          h(
            "tbody",
            null,
            sc.map(({ f, sc: x }) => h("tr", null, h("td", { class: "num" }, f.order + 1), h("td", null, f.caseKey), h("td", { class: "mono" }, f.code), h("td", null, mchip(f.method, true)), h("td", { class: "num" }, x.nMarks), h("td", { class: "num" }, x.nRefs ? `${x.nFound}/${x.nRefs}` : "—"), h("td", { class: "num" }, f.q1 ?? "—"), h("td", { class: "num" }, fmtDur(f.ms)))),
          ),
        ),
        h("h4", null, "环节用时"),
        h(
          "ul",
          { class: "plain" },
          Plan.STAGES.filter((st) => st.key !== "done").map((st) => {
            const u = (s.log || []).filter((e) => e.stage === st.key).reduce((a, e) => a + ((e.end || e.start) - e.start), 0);
            return u ? h("li", null, `${st.group}：${fmtDur(u)}（建议 ${st.mins}′）`) : null;
          }),
        ),
      );
      dialog({ title: `会话 ${s.pid}`, body, wide: true, buttons: [{ label: "关闭", value: true, kind: "primary" }] });
    },
    checklist() {
      const cfg = Store.config;
      cfg.checklist = cfg.checklist || {};
      const autoReal = Cases.allReal();
      const autoK = Cases.ROLES.every((r) => {
        const c = Cases.get(r.key);
        return c && new Set(Cases.METHODS.map((m) => c.sel[m].length)).size === 1;
      });
      const autoRef = Plan.FIND_CASES.every((ck) => {
        const c = Cases.get(ck);
        return c && Store.refs[c.id] && Store.refs[c.id].points.length >= 3;
      });
      const items = [
        { key: "real", auto: autoReal, text: "6 个案例都已换成流水线导出的数据，主持人页面没有黄色“演示数据”" },
        { key: "k", auto: autoK, text: "三种画法在同一案例上条数相同，凭经验选线的 k = gefs_PRMSL_fh084 的 |S*|" },
        { key: "ref", auto: autoRef, text: "参照标注已完成 C1–C4，每个案例至少 3 处" },
        { key: "share", text: "腾讯会议 1080p 共享下，成员细线清晰可辨；远程控制能正常点击地图" },
        { key: "pilot", text: "用 1–2 位同学走完整流程，实际用时不超过 70 分钟；超时则确定砍哪一环" },
        { key: "reload", text: "故意中途刷新一次，确认能从中断处继续、数据不丢" },
        { key: "excel", text: "导出的 CSV 用 Excel 打开中文不乱码" },
        { key: "blind", text: "专家区从头到尾截图检查一遍：没有方法名、文件 tag、UMC 数值" },
      ];
      return h(
        "details",
        { class: "card checklist", open: !items.every((it) => it.auto || cfg.checklist[it.key]) || null },
        h("summary", null, h("h2", null, "正式会话前的检查"), h("span", { class: "muted small" }, `${items.filter((it) => it.auto || cfg.checklist[it.key]).length} / ${items.length}`)),
        h(
          "ul",
          { class: "checks big" },
          items.map((it) =>
            it.auto != null
              ? h("li", { class: it.auto ? "ok" : "bad" }, h("span", { class: "ck" }), it.text, h("span", { class: "muted small" }, "　自动检查"))
              : h(
                  "li",
                  null,
                  h(
                    "label",
                    { class: "check-row" },
                    h("input", {
                      type: "checkbox",
                      id: `chk-${it.key}`,
                      checked: !!cfg.checklist[it.key],
                      onchange: (e) => {
                        cfg.checklist[it.key] = e.target.checked ? Date.now() : false;
                        Store.saveConfig();
                      },
                    }),
                    h("span", null, it.text),
                  ),
                ),
          ),
        ),
      );
    },

    /* =====================================================================
     * 5.2 案例数据
     * ===================================================================== */
    rCases(body) {
      const rows = Cases.ROLES.map((r) => {
        const st = Cases.state[r.key] || {};
        const c = st.case;
        const thumb = h("div", { class: "thumb" });
        if (c) {
          const m = this.map({ case: c, interactive: false, readout: false, zoom: false, maxHeight: 120 });
          m.setLevels(styledLevels(c, c.sel.ours, { members: false, width: 1.6 }));
          ICU.append(thumb, m.el);
        }
        return h(
          "tr",
          { class: st.source === "demo" ? "demo-row" : "" },
          h("td", null, h("b", { class: "role-key" }, r.key === "train" ? "训练" : r.key === "free" ? "选线" : r.key)),
          h("td", null, h("div", null, r.label), h("div", { class: "muted small" }, r.use)),
          h("td", { class: "mono small" }, r.id, h("div", { class: "muted" }, r.elementHint)),
          h("td", null, c ? h("div", null, c.title) : "—", st.file ? h("div", { class: "muted small mono" }, st.file) : null, st.error ? h("div", { class: "err small" }, st.error) : null),
          h("td", { class: "num" }, c ? c.k : "—", c ? h("div", { class: "muted small" }, `${c.M} 成员 · ${c.nx}×${c.ny}`) : null),
          h("td", null, sourceChip(st.source)),
          h("td", null, thumb),
          h("td", { class: "actions" }, st.source === "upload" ? h("button", { type: "button", class: "btn small ghost", onclick: async () => (await Cases.removeUpload(r.key), this.render()) }, "移除上传") : null),
        );
      });
      const results = h("ul", { class: "upload-results" });
      const fileInput = h("input", {
        type: "file",
        accept: ".json,application/json",
        multiple: true,
        id: "case-upload",
        hidden: true,
        onchange: async (e) => {
          await doUpload([...e.target.files]);
          e.target.value = "";
        },
      });
      const doUpload = async (files) => {
        if (!files.length) return;
        toast(`正在校验 ${files.length} 个文件…`);
        const out = await Cases.upload(files);
        this.render();
        const res = this.root.querySelector(".upload-results");
        if (res) ICU.append(res, ...out.map((o) => h("li", { class: o.ok ? "ok" : "bad" }, h("b", null, o.name), "　", o.msg)));
      };
      const drop = h(
        "div",
        {
          class: "dropzone",
          tabindex: "0",
          role: "button",
          "aria-label": "选择或拖入案例 JSON",
          onclick: () => fileInput.click(),
          onkeydown: (e) => (e.key === "Enter" || e.key === " ") && fileInput.click(),
          ondragover: (e) => (e.preventDefault(), e.currentTarget.classList.add("over")),
          ondragleave: (e) => e.currentTarget.classList.remove("over"),
          ondrop: (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("over");
            doUpload([...e.dataTransfer.files]);
          },
        },
        h("b", null, "选择或拖入案例 JSON（可多选）"),
        h("span", { class: "muted small" }, "文件存进本机 IndexedDB，刷新后仍在；优先级：上传 > 随页面发布 > 演示"),
        fileInput,
      );
      ICU.append(body, 
        h("div", { class: "tab-intro" }, h("h2", null, "案例数据"), h("p", { class: "muted" }, "k、三种画法的选线、SCU 曲线和描述子都由流水线给出，网页只负责展示和记录，不再重算。")),
        h(
          "section",
          { class: "card" },
          h("div", { class: "tbl-wrap" }, h("table", { class: "tbl cases" }, h("thead", null, h("tr", null, ["角色", "用途", "应有案例", "当前使用", "k", "来源", "均值场 + S*", ""].map((x) => h("th", null, x)))), h("tbody", null, rows))),
        ),
        h("div", { class: "cases-grid" }, h("section", { class: "card" }, h("h3", null, "上传"), drop, results), h("section", { class: "card" }, h("h3", null, "从流水线导出"), h("p", { class: "small" }, "在项目根目录运行："), h("pre", { class: "code" }, "python -m pipeline.export_study_cases"), h("p", { class: "muted small" }, "对 6 个案例各跑一次现有流程（读 results/vis_eval/*.npz 的后验，重算论文协议档位的 S*，同 k 生成均匀间隔与 JS 散度法），输出到 paper_notes/user_study/app/cases/。载入时检查：成员长度 = nx×ny；三种画法条数相同；selections 的值都在 candidates 中；scu、desc 长度 = 候选数。"))),
        this.selectionOverview(),
      );
    },
    selectionOverview() {
      const blocks = Cases.ROLES.map((r) => {
        const c = Cases.get(r.key);
        if (!c) return null;
        const nv = c.candidates.length;
        const row = (m) =>
          h(
            "div",
            { class: "sel-row" },
            h("span", { class: "sel-l" }, mchip(m, true)),
            h(
              "div",
              { class: "sel-cells", style: { "--n": nv } },
              c.candidates.map((v, i) => h("i", { class: c.sel[m].includes(i) ? `on m-${m}` : "", title: `${fmtVal(v, c.unit)}` })),
            ),
          );
        return h("div", { class: "sel-block" }, h("div", { class: "sel-title" }, h("b", null, r.key), h("span", { class: "muted small" }, `${fmtVal(c.candidates[0])} … ${fmtVal(c.candidates[nv - 1])} ${c.unit} · ${nv} 个候选`)), Cases.METHODS.map(row));
      });
      return h("section", { class: "card" }, h("h3", null, "三种画法选中的候选值一览"), h("div", { class: "sel-grid" }, blocks));
    },

    /* =====================================================================
     * 5.3 参照标注
     * ===================================================================== */
    refState: { caseKey: "C1", idx: null, type: "位置不一致", selected: null },
    rRef(body) {
      const RS = this.refState;
      const cfg = Store.config;
      const keys = [...Plan.FIND_CASES, "free"];
      const c = Cases.get(RS.caseKey);
      if (!c) return ICU.append(body, h("p", null, "案例还在载入…"));
      if (RS.idx == null || RS.idx >= c.candidates.length) RS.idx = Math.floor(c.candidates.length / 2);
      const ref = Store.getRef(c.id);
      const km = Geo.cellKm(c);
      const m = this.map({
        case: c,
        ariaLabel: "参照标注",
        readoutValue: true,
        onClick: (gx, gy, ev, hit) => {
          if (hit) {
            RS.selected = hit.id;
            draw();
            return;
          }
          if (gx < 0 || gy < 0 || gx > c.nx - 1 || gy > c.ny - 1) return;
          const ll = Geo.gridToLatLon(c, gx, gy);
          const id = (ref.points.reduce((a, p) => Math.max(a, p.id || 0), 0) || 0) + 1;
          ref.points.push({ id, x: +gx.toFixed(2), y: +gy.toFixed(2), lat: +ll.lat.toFixed(2), lon: +ll.lon.toFixed(2), idx: RS.idx, value: c.candidates[RS.idx], type: RS.type, t: Date.now() });
          RS.selected = id;
          Store.saveRef(c.id);
          draw();
        },
        onMarkerDrag: (id, gx, gy) => {
          const p = ref.points.find((x) => x.id === id);
          if (!p) return;
          const ll = Geo.gridToLatLon(c, gx, gy);
          Object.assign(p, { x: +gx.toFixed(2), y: +gy.toFixed(2), lat: +ll.lat.toFixed(2), lon: +ll.lon.toFixed(2) });
          Store.saveRef(c.id);
          draw();
        },
      });
      const valEl = h("div", { class: "slider-val" });
      const slider = h("input", { type: "range", class: "range", id: "ref-slider", min: "0", max: String(c.candidates.length - 1), step: "1", value: String(RS.idx), "aria-label": "候选值" });
      const list = h("div", { class: "ref-list" });
      const ticks = h("div", { class: "ref-ticks", style: { "--n": c.candidates.length } });
      const refCount = h("span", { class: "pill" });
      const draw = () => {
        m.setLevels([{ idx: RS.idx, color: "#1f5f9e", members: true, mean: true, band: true, alpha: 0.42, bandColor: "#c2410c", bandAlpha: 0.22 }]);
        const here = ref.points.filter((p) => p.idx === RS.idx);
        const near = ref.points.filter((p) => p.idx !== RS.idx && Math.abs(p.idx - RS.idx) <= 2);
        m.setMarkers(
          [...near.map((p) => ({ x: p.x, y: p.y, kind: "ghost", n: p.idx > RS.idx ? `+${p.idx - RS.idx}` : `${p.idx - RS.idx}`, color: "#5b6670" })), ...here.map((p) => ({ id: p.id, x: p.x, y: p.y, n: ref.points.indexOf(p) + 1, selected: p.id === RS.selected }))],
          here.map((p) => ({ x: p.x, y: p.y, r: cfg.R })),
        );
        valEl.textContent = `${RS.idx + 1} / ${c.candidates.length}　${fmtVal(c.candidates[RS.idx], c.unit)}`;
        slider.value = String(RS.idx);
        clear(ticks);
        c.candidates.forEach((_, i) => {
          const n = ref.points.filter((p) => p.idx === i).length;
          ICU.append(ticks, h("button", { type: "button", class: "rt" + (i === RS.idx ? " cur" : "") + (n ? " has" : ""), title: `${fmtVal(c.candidates[i], c.unit)}${n ? ` · ${n} 处` : ""}`, onclick: () => ((RS.idx = i), draw()) }, n ? String(n) : ""));
        });
        clear(list);
        refCount.textContent = `${ref.points.length} 处`;
        if (!ref.points.length) ICU.append(list, h("p", { class: "muted small" }, "还没有标注。"));
        const byIdx = {};
        ref.points.forEach((p, i) => (byIdx[p.idx] = byIdx[p.idx] || []).push([p, i]));
        for (const idx of Object.keys(byIdx).map(Number).sort((a, b) => a - b)) {
          ICU.append(list, 
            h("div", { class: "ref-group" + (idx === RS.idx ? " cur" : "") }, h("button", { type: "button", class: "ref-lv", onclick: () => ((RS.idx = idx), draw()) }, fmtVal(c.candidates[idx], c.unit)),
              byIdx[idx].map(([p, i]) =>
                h(
                  "div",
                  { class: "ref-pt" + (p.id === RS.selected ? " sel" : "") },
                  h("span", { class: "mk-n" }, String(i + 1)),
                  h("span", { class: "small" }, c.hasGeo ? ICU.fmtLatLon(p.lat, p.lon) : `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`),
                  h(
                    "select",
                    {
                      class: "sel small",
                      "aria-label": "类型",
                      onchange: (e) => {
                        p.type = e.target.value;
                        Store.saveRef(c.id);
                      },
                    },
                    Content.markTypes.map((t) => h("option", { value: t, selected: p.type === t ? true : null }, t)),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "icon-btn",
                      "aria-label": "删除",
                      onclick: () => {
                        ref.points.splice(ref.points.indexOf(p), 1);
                        Store.saveRef(c.id);
                        draw();
                      },
                    },
                    "×",
                  ),
                ),
              ),
            ),
          );
        }
        for (const b of caseSeg.querySelectorAll(".seg")) {
          const cc = Cases.get(b.dataset.v);
          const n = cc && Store.refs[cc.id] ? Store.refs[cc.id].points.length : 0;
          const badge = b.querySelector(".seg-h");
          if (badge) badge.textContent = n ? `${n} 处${n >= 3 || b.dataset.v === "free" ? " ✓" : ""}` : "未标";
        }
      };
      slider.addEventListener("input", () => {
        RS.idx = Number(slider.value);
        draw();
      });
      const keysH = (e) => {
        if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target !== slider) return;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") RS.idx = Math.min(c.candidates.length - 1, RS.idx + 1);
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") RS.idx = Math.max(0, RS.idx - 1);
        else if ((e.key === "Delete" || e.key === "Backspace") && RS.selected != null) {
          const at = ref.points.findIndex((p) => p.id === RS.selected);
          if (at >= 0) {
            ref.points.splice(at, 1);
            RS.selected = null;
            Store.saveRef(c.id);
          }
        } else return;
        e.preventDefault();
        draw();
      };
      document.addEventListener("keydown", keysH);
      this.cleanups.push(() => document.removeEventListener("keydown", keysH));

      const caseSeg = choice(
        keys.map((k) => ({ value: k, label: k === "free" ? "选线案例（可选）" : k, hint: " " })),
        RS.caseKey,
        (v) => {
          RS.caseKey = v;
          RS.idx = null;
          RS.selected = null;
          this.render();
        },
        "cases-seg",
      );
      const typeSeg = choice(
        Content.markTypes.map((t) => ({ value: t, label: t })),
        RS.type,
        (v) => {
          RS.type = v;
          const p = ref.points.find((x) => x.id === RS.selected);
          if (p && p.idx === RS.idx) {
            p.type = v;
            Store.saveRef(c.id);
            draw();
          }
        },
        "tiny",
      );
      const num = (id, label, val, on, attrs) => h("label", { class: "field inline" }, h("span", null, label), h("input", Object.assign({ id, class: "txt num", type: "number", value: String(val), oninput: (e) => on(e.target.value) }, attrs)));
      const kmEl = h("span", { class: "muted small" }, `≈ ${Math.round(cfg.R * km.km)} km（格距约 ${Math.abs(c.dLat).toFixed(2)}°，${Math.round(km.km)} km）`);
      ICU.append(body, 
        h(
          "div",
          { class: "tab-intro" },
          h("h2", null, "参照标注"),
          h("p", { class: "muted" }, "给参照标注专家用，产生评分的“标准答案”。标注员看到的是全部候选值，不是任何一种画法的选线，因此标准答案不依赖我们的算法。"),
          h(
            "div",
            { class: "row gap wrap" },
            h("label", { class: "field inline" }, h("span", null, "标注员"), h("input", { id: "ref-annotator", class: "txt", value: cfg.annotator || "", placeholder: "姓名或代号", oninput: (e) => ((cfg.annotator = e.target.value), Store.saveConfig()) })),
            num("ref-R", "判定半径 R（格点）", cfg.R, (v) => {
              cfg.R = Math.max(1, Number(v) || 6);
              kmEl.textContent = `≈ ${Math.round(cfg.R * km.km)} km（格距约 ${Math.abs(c.dLat).toFixed(2)}°，${Math.round(km.km)} km）`;
              Store.saveConfig();
              draw();
            }, { min: "1", max: "30", step: "1" }),
            kmEl,
            num("ref-tol", "选线覆盖容差（级）", cfg.coverTol, (v) => ((cfg.coverTol = Math.max(0, Number(v) || 0)), Store.saveConfig()), { min: "0", max: "3", step: "1" }),
          ),
        ),
        h("div", { class: "row gap wrap" }, caseSeg),
        h(
          "div",
          { class: "work" },
          h(
            "div",
            { class: "work-map" },
            h("div", { class: "map-title" }, h("span", null, `${RS.caseKey} · ${c.title}`), valEl),
            m.el,
            h("div", { class: "ref-slider" }, h("button", { type: "button", class: "btn small", onclick: () => ((RS.idx = Math.max(0, RS.idx - 1)), draw()) }, "← 上一级"), slider, h("button", { type: "button", class: "btn small", onclick: () => ((RS.idx = Math.min(c.candidates.length - 1, RS.idx + 1)), draw()) }, "下一级 →")),
            ticks,
          ),
          h(
            "aside",
            { class: "work-side" },
            h(
              "div",
              { class: "card sticky" },
              h("div", { class: "rules" }, h("b", null, "规则"), h("ul", null, h("li", null, "在真实分歧处点一下：记录位置、所在候选值、分歧类型。"), h("li", null, "同一处分歧跨几个相邻值时，只在最明显的一级标一次（虚线小圈 = 相邻 ±2 级已有的标注）。"), h("li", null, `参与专家的标点落在参照点 R = ${cfg.R} 格以内即算找到（红色虚线圈）。`), h("li", null, "每个案例至少 3 处。← → 键翻级，Delete 删除选中点，点可拖动。"))),
              h("div", { class: "qlabel" }, "新标注的类型"),
              typeSeg,
              h("div", { class: "side-head" }, h("h3", null, "已标注"), refCount),
              list,
            ),
          ),
        ),
      );
      draw();
    },

    /* =====================================================================
     * 5.4 结果与导出
     * ===================================================================== */
    rResults(body) {
      ICU.Results.render(body);
    },
  };

  ICU.Host = Host;
})();
