/* 评分、结果与导出（设计文档 5.4 / 8.4）。评分只在主持人区离线进行，专家看不到对错。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { h, clear, Cases, Plan, Content, Store, Charts, fmtVal, fmtDur, mean, median, round, toCSV, saveFile, toast } = ICU;
  const ML = Plan.METHOD_LABEL;
  const TYPE_KEYS = Content.markTypes;
  const CH_LABEL = { G: "位置摆动", C: "边界模糊", T: "分块个数不同", U: "说不清" };

  /* =====================================================================
   * 评分
   * ===================================================================== */
  function refsFor(caseId) {
    const r = Store.refs[caseId];
    return r && r.points ? r.points : [];
  }
  function scoreFind(item) {
    const R = Store.config.R;
    const tol = Store.config.coverTol;
    const refs = refsFor(item.caseId);
    const marks = item.marks || [];
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const foundRefs = refs.filter((rp) => marks.some((mk) => d2(mk, rp) <= R * R));
    const hitMarks = marks.filter((mk) => refs.some((rp) => d2(mk, rp) <= R * R));
    const visible = refs.filter((rp) => (item.levels || []).some((i) => Math.abs(i - rp.idx) <= tol));
    const foundVisible = visible.filter((rp) => foundRefs.includes(rp));
    const byType = {};
    for (const t of TYPE_KEYS) {
      const all = refs.filter((rp) => rp.type === t);
      byType[t] = { n: all.length, found: all.filter((rp) => foundRefs.includes(rp)).length };
    }
    return {
      nRefs: refs.length,
      nFound: foundRefs.length,
      rate: refs.length ? foundRefs.length / refs.length : null,
      nMarks: marks.length,
      falseAlarms: marks.length - hitMarks.length,
      nVisible: visible.length,
      nFoundVisible: foundVisible.length,
      byType,
    };
  }
  /** 选线覆盖参照分歧：参照点所在候选值 ± coverTol 内有选中的值 */
  function coverage(caseId, idxs) {
    const refs = refsFor(caseId);
    if (!refs.length || !idxs) return null;
    const tol = Store.config.coverTol;
    const n = refs.filter((rp) => idxs.some((i) => Math.abs(i - rp.idx) <= tol)).length;
    return { n, of: refs.length };
  }
  function survey(s, key) {
    const v = s.survey ? s.survey[key] : null;
    return v == null ? null : v;
  }
  const revKeys = new Set(Content.survey.flatMap((g) => g.items.filter((i) => i.reverse).map((i) => i.key)));

  function sessionsFiltered(opts) {
    return Store.listSessions().filter((s) => (opts.pilot || !s.pilot) && (opts.unfinished || s.finishedAt));
  }
  function findRows(sessions) {
    const rows = [];
    for (const s of sessions)
      for (const f of s.find || []) {
        if (!f || !f.submittedAt) continue;
        rows.push({ s, f, sc: scoreFind(f) });
      }
    return rows;
  }

  /* =====================================================================
   * 结果页
   * ===================================================================== */
  const Results = {
    opts: { pilot: false, unfinished: true },
    render(root) {
      clear(root);
      const sessions = sessionsFiltered(this.opts);
      const rows = findRows(sessions);
      const toggles = h(
        "div",
        { class: "row gap wrap" },
        h("label", { class: "check-row" }, h("input", { type: "checkbox", id: "res-pilot", checked: this.opts.pilot, onchange: (e) => ((this.opts.pilot = e.target.checked), this.render(root)) }), h("span", null, "包含预实验会话")),
        h("label", { class: "check-row" }, h("input", { type: "checkbox", id: "res-unfinished", checked: this.opts.unfinished, onchange: (e) => ((this.opts.unfinished = e.target.checked), this.render(root)) }), h("span", null, "包含未完成的会话")),
        h("span", { class: "muted small" }, `判定半径 R = ${Store.config.R} 格 · 覆盖容差 ±${Store.config.coverTol} 级（在“参照标注”页修改）`),
      );
      const missing = Plan.FIND_CASES.filter((k) => {
        const c = Cases.get(k);
        return c && !refsFor(c.id).length;
      });
      ICU.append(root, 
        h("div", { class: "tab-intro" }, h("h2", null, "结果与导出"), h("p", { class: "muted" }, `${sessions.length} 个会话 · ${rows.length} 张已提交的找分歧图`), toggles),
        missing.length ? h("div", { class: "banner warn" }, `${missing.join("、")} 还没有参照标注，这些图的“找到比例”暂时算不出来。`) : null,
        this.summary(rows),
        this.byType(rows),
        this.detail(rows),
        this.attr(sessions),
        this.free(sessions),
        this.surveyTable(sessions),
        this.exports(sessions),
      );
    },

    section(title, sub, ...kids) {
      return h("section", { class: "res-sec" }, h("div", { class: "res-head" }, h("h3", null, title), sub ? h("p", { class: "muted small" }, sub) : null), kids);
    },
    table(head, body, cls = "") {
      return h("div", { class: "tbl-wrap" }, h("table", { class: `tbl ${cls}` }, h("thead", null, h("tr", null, head.map((x) => h("th", null, x)))), h("tbody", null, body.length ? body : h("tr", null, h("td", { colspan: head.length, class: "empty" }, "暂无数据")))));
    },

    summary(rows) {
      const per = {};
      for (const m of Cases.METHODS) per[m] = rows.filter((r) => r.f.method === m);
      const stat = (m) => {
        const rs = per[m];
        const refs = rs.reduce((a, r) => a + r.sc.nRefs, 0);
        const found = rs.reduce((a, r) => a + r.sc.nFound, 0);
        return {
          n: rs.length,
          marks: mean(rs.map((r) => r.sc.nMarks)),
          rate: refs ? found / refs : null,
          found,
          refs,
          fa: mean(rs.map((r) => r.sc.falseAlarms)),
          q1: mean(rs.map((r) => (typeof r.f.q1 === "number" ? r.f.q1 : null))),
          q1na: rs.filter((r) => r.f.q1 === "NA").length,
          ms: median(rs.map((r) => r.f.ms)),
        };
      };
      const st = Object.fromEntries(Cases.METHODS.map((m) => [m, stat(m)]));
      const body = Cases.METHODS.map((m) => {
        const x = st[m];
        return h(
          "tr",
          null,
          h("td", null, h("span", { class: `mchip m-${m}` }, ML[m])),
          h("td", { class: "num" }, x.n),
          h("td", { class: "num" }, x.marks != null ? x.marks.toFixed(1) : "—"),
          h("td", { class: "num" }, x.rate != null ? `${Math.round(x.rate * 100)}%` : "—", h("span", { class: "muted" }, x.refs ? ` (${x.found}/${x.refs})` : "")),
          h("td", { class: "num" }, x.fa != null ? x.fa.toFixed(1) : "—"),
          h("td", { class: "num" }, x.q1 != null ? x.q1.toFixed(2) : "—", x.q1na ? h("span", { class: "muted" }, ` · NA ${x.q1na}`) : null),
          h("td", { class: "num" }, fmtDur(x.ms)),
        );
      });
      // 关键对照
      const u = st.uniform,
        o = st.ours;
      let verdict = "数据还不够，不作判断。";
      let cls = "neutral";
      if (u.n && o.n && u.q1 != null && o.q1 != null && u.rate != null && o.rate != null) {
        if (u.q1 > o.q1 && u.rate < o.rate) {
          verdict = `目前：均匀间隔 Q1 = ${u.q1.toFixed(2)}（高于本文 ${o.q1.toFixed(2)}），找到比例 ${Math.round(u.rate * 100)}%（低于本文 ${Math.round(o.rate * 100)}%）——符合“漏了还看不出来”。`;
          cls = "good";
        } else verdict = `目前：均匀间隔 Q1 ${u.q1.toFixed(2)} / 找到 ${Math.round(u.rate * 100)}%；本文 Q1 ${o.q1.toFixed(2)} / 找到 ${Math.round(o.rate * 100)}%。尚未出现上述模式，如实报告。`;
      }
      // 逐人点图
      const pids = [...new Set(rows.map((r) => r.s.pid))];
      const dots = Cases.METHODS.map((m) => {
        const pts = [];
        for (const pid of pids) {
          const rs = rows.filter((r) => r.s.pid === pid && r.f.method === m && r.sc.nRefs);
          const refs = rs.reduce((a, r) => a + r.sc.nRefs, 0);
          if (refs) pts.push({ pid, v: rs.reduce((a, r) => a + r.sc.nFound, 0) / refs });
        }
        return { key: m, label: ML[m], points: pts, mean: st[m].rate };
      });
      return this.section(
        "按画法汇总（问题 1）",
        "找到比例 = 被专家标点命中（R 格以内）的参照分歧 / 该案例全部参照分歧。人数少，逐人报告，不做显著性检验。",
        this.table(["画法", "图数", "平均标出处数", "找到参照分歧", "平均误报", "Q1 平均（基本一致）", "用时中位数"], body),
        h("div", { class: `callout ${cls}` }, h("b", null, "最关键的对照　"), "均匀间隔若 Q1 偏高、而找到比例偏低，说明它不只漏了分歧，还让人以为没分歧。", h("br"), verdict),
        pids.length ? h("div", { class: "dot-box" }, h("div", { class: "chart-cap" }, "每个点 = 一位专家在该画法图上的找到比例；竖线 = 汇总比例"), Charts.dotPlot(dots, { aria: "逐人找到比例" })) : null,
      );
    },

    byType(rows) {
      const body = Cases.METHODS.map((m) => {
        const rs = rows.filter((r) => r.f.method === m);
        return h(
          "tr",
          null,
          h("td", null, h("span", { class: `mchip m-${m}` }, ML[m])),
          TYPE_KEYS.map((t) => {
            const n = rs.reduce((a, r) => a + r.sc.byType[t].n, 0);
            const f = rs.reduce((a, r) => a + r.sc.byType[t].found, 0);
            return h("td", { class: "num" }, n ? `${f}/${n}` : "—");
          }),
          h("td", { class: "num" }, (() => {
            const n = rs.reduce((a, r) => a + r.sc.nVisible, 0);
            const f = rs.reduce((a, r) => a + r.sc.nFoundVisible, 0);
            return n ? `${f}/${n}` : "—";
          })()),
        );
      });
      return this.section("差异集中在哪类分歧", "按参照标注的分歧类型拆开；最后一列只算“所在候选值被这张图画出（±容差）”的参照分歧。", this.table(["画法", ...TYPE_KEYS, "可见的参照分歧"], body));
    },

    detail(rows) {
      const body = rows
        .slice()
        .sort((a, b) => (a.s.createdAt || 0) - (b.s.createdAt || 0) || a.f.order - b.f.order)
        .map((r) =>
          h(
            "tr",
            null,
            h("td", null, r.s.pid, r.s.pilot ? h("span", { class: "tag" }, "预") : null),
            h("td", { class: "num" }, r.f.order + 1),
            h("td", null, r.f.caseKey),
            h("td", { class: "mono" }, r.f.code),
            h("td", null, h("span", { class: `mchip m-${r.f.method}` }, Plan.METHOD_SHORT[r.f.method])),
            h("td", { class: "num" }, r.sc.nMarks),
            h("td", { class: "num" }, r.sc.nRefs ? `${r.sc.nFound}/${r.sc.nRefs}` : "—"),
            h("td", { class: "num" }, r.sc.falseAlarms),
            h("td", { class: "num" }, r.f.q1 ?? "—"),
            h("td", { class: "wrap-cell" }, r.f.q2 || ""),
            h("td", { class: "num" }, fmtDur(r.f.ms)),
            h("td", null, r.f.source === "demo" ? h("span", { class: "tag warn" }, "演示") : ""),
          ),
        );
      return this.section("逐图明细", null, this.table(["专家", "顺序", "案例", "编号", "画法", "标出", "找到/参照", "误报", "Q1", "Q2", "用时", ""], body, "dense"));
    },

    attr(sessions) {
      const items = [];
      for (const s of sessions) for (const a of s.attr || []) if (a && a.choice) items.push({ s, a });
      const byCase = Plan.ATTR_CASES.map((k) => {
        const xs = items.filter((x) => x.a.caseKey === k);
        const match = xs.filter((x) => x.a.choice === x.a.sys).length;
        const ag = mean(xs.map((x) => (typeof x.a.agree === "number" ? x.a.agree : null)));
        return h("div", { class: "kpi" }, h("div", { class: "kpi-k" }, k), h("div", { class: "kpi-v" }, xs.length ? `${match}/${xs.length}` : "—"), h("div", { class: "kpi-s" }, `单选与系统一致 · 一致度均值 ${ag != null ? ag.toFixed(2) : "—"}`));
      });
      const body = items.map(({ s, a }) =>
        h(
          "tr",
          null,
          h("td", null, s.pid),
          h("td", null, a.caseKey),
          h("td", { class: "num" }, fmtVal(a.value)),
          h("td", { class: "mono small" }, `G ${a.G.toFixed(2)} · C ${a.C.toFixed(2)} · T ${a.T.toFixed(2)}`),
          h("td", null, CH_LABEL[a.sys]),
          h("td", { class: a.choice === a.sys ? "ok" : "" }, CH_LABEL[a.choice] || "—"),
          h("td", { class: "num" }, a.agree ?? "—"),
          h("td", { class: "wrap-cell" }, a.text || ""),
        ),
      );
      return this.section("归因（问题 2）", "系统答案 = 三个标准分里最大的那个。湿度场（C4）上 C 与 T 同时升高，论文 4.1 节已说明归因只能缩到两者之一。", h("div", { class: "kpis" }, byCase), this.table(["专家", "案例", "线值", "描述子", "系统答案", "专家判断", "一致度", "物理解释原文"], body));
    },

    free(sessions) {
      const c = Cases.get("free");
      const sys = c ? c.sel.ours : [];
      const sysCov = c ? coverage(c.id, sys) : null;
      const body = sessions
        .filter((s) => s.free && s.free.doneAt)
        .map((s) => {
          const vals = s.free.values.slice().sort((a, b) => a - b);
          const ov = vals.filter((i) => sys.includes(i)).length;
          const cov = c ? coverage(c.id, vals) : null;
          const s2 = s.free.step2 && s.free.step2.doneAt ? s.free.step2 : null;
          const cov2 = s2 && c ? coverage(c.id, s2.values) : null;
          return h(
            "tr",
            null,
            h("td", null, s.pid),
            h("td", { class: "mono small" }, vals.map((i) => fmtVal(c ? c.candidates[i] : i)).join("  ")),
            h("td", { class: "num" }, `${ov}/${sys.length}`),
            h("td", { class: "num" }, cov ? `${cov.n}/${cov.of}` : "—"),
            h("td", { class: "num" }, fmtDur(s.free.ms)),
            h("td", { class: "num" }, s.free.clicks ? s.free.clicks.filter((x) => x.op === "remove").length : 0),
            h("td", { class: "num" }, s2 ? `${cov2 ? `${cov2.n}/${cov2.of}` : "—"} · ${fmtDur(s2.ms)}` : "—"),
            h("td", { class: "wrap-cell" }, s.free.reason || ""),
          );
        });
      // 专家之间的重合
      const done = sessions.filter((s) => s.free && s.free.doneAt);
      let pairOv = null;
      if (done.length > 1) {
        const xs = [];
        for (let i = 0; i < done.length; i++) for (let j = i + 1; j < done.length; j++) xs.push(done[i].free.values.filter((v) => done[j].free.values.includes(v)).length);
        pairOv = mean(xs);
      }
      return this.section(
        "凭经验选线对照（问题 3）",
        `系统 S* 覆盖参照分歧：${sysCov ? `${sysCov.n}/${sysCov.of}` : "（free 案例没有参照标注，可在“参照标注”页补标）"} · 专家两两平均重合 ${pairOv != null ? pairOv.toFixed(1) : "—"} 条`,
        this.table(["专家", "所选值", "与 S* 重合", "覆盖参照分歧", "用时", "改选次数", "第二步覆盖 · 用时", "理由"], body),
      );
    },

    surveyTable(sessions) {
      const keys = Plan.SURVEY_KEYS;
      const body = sessions.map((s) =>
        h(
          "tr",
          null,
          h("td", null, s.pid),
          h("td", null, s.bg ? s.bg.role || "—" : "—"),
          keys.map((k) => h("td", { class: "num" + (revKeys.has(k) ? " rev" : "") }, survey(s, k) ?? "·")),
          h("td", null, s.blind && s.blind.decoded ? Plan.METHOD_SHORT[s.blind.decoded.r1] || "—" : "—"),
          h("td", null, s.blind && s.blind.decoded ? Plan.METHOD_SHORT[s.blind.decoded.r2a] || "—" : "—"),
          h("td", null, s.blind && s.blind.decoded ? Plan.METHOD_SHORT[s.blind.decoded.r2b] || "—" : "—"),
        ),
      );
      const med = h(
        "tr",
        { class: "foot" },
        h("td", null, "中位数"),
        h("td", null, ""),
        keys.map((k) => {
          const v = median(sessions.map((s) => (typeof survey(s, k) === "number" ? survey(s, k) : null)));
          return h("td", { class: "num" }, v != null ? v : "—");
        }),
        h("td", { colspan: 3 }, ""),
      );
      const tally = (key) =>
        Cases.METHODS.map((m) => `${Plan.METHOD_SHORT[m]} ${sessions.filter((s) => s.blind && s.blind.decoded && s.blind.decoded[key] === m).length}`).join(" · ");
      return this.section(
        "问卷与盲对比",
        `S4、A2 为反向题（表中标斜体，原始分未翻转；CSV 另给翻转列）。R1 会商用：${tally("r1")}　R2a 最能看出分歧：${tally("r2a")}　R2b 最好读：${tally("r2b")}`,
        this.table(["专家", "岗位", ...keys, "R1", "R2a", "R2b"], [...body, med], "dense"),
      );
    },

    exports(sessions) {
      const all = Store.listSessions();
      const btn = (label, sub, fn) => h("button", { type: "button", class: "export-btn", onclick: fn }, h("b", null, label), h("span", null, sub));
      const importInput = h("input", {
        type: "file",
        accept: ".json,application/json",
        id: "import-json",
        hidden: true,
        onchange: async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            const obj = JSON.parse(await ICU.readFileText(f));
            const r = Store.importAll(obj);
            toast(`已合并 ${r.ns} 个会话、${r.nr} 个参照标注`, "ok");
            ICU.App.renderHost();
          } catch (err) {
            toast("文件无法解析：" + err.message, "error", 5000);
          }
          e.target.value = "";
        },
      });
      return this.section(
        "导出",
        "导出的是全部会话（不受上面两个筛选框影响），每行带 pilot 列；CSV 带 BOM，Excel 直接打开不乱码。",
        h(
          "div",
          { class: "export-grid" },
          btn("study_all.json", "全部会话 + 参照标注 + 配法，存档与补充材料", () => saveFile(`study_all_${stamp()}.json`, JSON.stringify(buildAll(all), null, 1), "application/json")),
          btn("find.csv", "每张图一行：问题 1 的统计与作图", () => saveFile(`find_${stamp()}.csv`, findCSV(all), "text/csv;charset=utf-8")),
          btn("attr.csv", "每题一行：问题 2", () => saveFile(`attr_${stamp()}.csv`, attrCSV(all), "text/csv;charset=utf-8")),
          btn("survey.csv", "每人一行：背景、问卷、盲对比、选线", () => saveFile(`survey_${stamp()}.csv`, surveyCSV(all), "text/csv;charset=utf-8")),
          btn("reference.csv", "参照标注点", () => saveFile(`reference_${stamp()}.csv`, refCSV(), "text/csv;charset=utf-8")),
          btn("notes.md", "按专家分节的笔记与访谈要点", () => saveFile(`notes_${stamp()}.md`, notesMD(all), "text/markdown;charset=utf-8")),
        ),
        h("div", { class: "row gap" }, h("button", { type: "button", class: "btn ghost", onclick: () => importInput.click() }, "导入 study_all.json（合并到本机 / 云端）"), importInput),
      );
    },
  };

  /* =====================================================================
   * 导出格式
   * ===================================================================== */
  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function caseSummary() {
    const out = {};
    for (const r of Cases.ROLES) {
      const c = Cases.get(r.key);
      if (!c) continue;
      out[r.key] = {
        id: c.id,
        source: c.source,
        k: c.k,
        unit: c.unit,
        candidates: c.candidates,
        selections: Object.fromEntries(Cases.METHODS.map((m) => [m, c.sel[m].map((i) => c.candidates[i])])),
        provenance: c.provenance,
      };
    }
    return out;
  }
  function buildAll(sessions) {
    return {
      schema: "icu-expert-study/1",
      exportedAt: new Date().toISOString(),
      config: Store.config,
      cases: caseSummary(),
      balance: Array.from({ length: 8 }, (_, i) => {
        const p = Plan.makePlan(i);
        return { seq: i, assign: p.assign, order: p.order };
      }),
      reference: Store.refs,
      sessions: sessions.map((s) => ({ ...s, _score: (s.find || []).filter(Boolean).map((f) => ({ order: f.order, ...scoreFind(f) })) })),
    };
  }
  function findCSV(sessions) {
    const head = ["pid", "seq", "pilot", "order", "case", "case_id", "code", "method", "k", "values", "n_marks", "n_refs", "n_found", "found_rate", "false_alarms", "n_visible_refs", "n_found_visible", "q1", "q2", "ms", "zoomed", "source", "marks"];
    const rows = [];
    for (const s of sessions)
      for (const f of s.find || []) {
        if (!f || !f.submittedAt) continue;
        const sc = scoreFind(f);
        rows.push([s.pid, s.seq, s.pilot ? 1 : 0, f.order + 1, f.caseKey, f.caseId, f.code, f.method, (f.levels || []).length, (f.values || []).join(" "), sc.nMarks, sc.nRefs, sc.nFound, sc.rate != null ? round(sc.rate, 4) : "", sc.falseAlarms, sc.nVisible, sc.nFoundVisible, f.q1 ?? "", f.q2 || "", f.ms ?? "", f.zoomed ? 1 : 0, f.source || "", JSON.stringify((f.marks || []).map((m) => ({ x: m.x, y: m.y, lat: m.lat, lon: m.lon, type: m.type, near: m.near, t: m.t })))]);
      }
    return toCSV(head, rows);
  }
  function attrCSV(sessions) {
    const head = ["pid", "seq", "pilot", "case", "case_id", "value", "G", "C", "T", "F", "system_answer", "system_label", "expert_choice", "expert_label", "match", "agree", "explanation", "ms", "source"];
    const rows = [];
    for (const s of sessions)
      for (const a of s.attr || []) {
        if (!a || !a.choice) continue;
        rows.push([s.pid, s.seq, s.pilot ? 1 : 0, a.caseKey, a.caseId, a.value, round(a.G, 4), round(a.C, 4), round(a.T, 4), a.F != null ? round(a.F, 4) : "", a.sys, CH_LABEL[a.sys], a.choice, CH_LABEL[a.choice], a.choice === a.sys ? 1 : 0, a.agree ?? "", a.text || "", a.ms ?? "", a.source || ""]);
      }
    return toCSV(head, rows);
  }
  function surveyCSV(sessions) {
    const keys = Plan.SURVEY_KEYS;
    const c = Cases.get("free");
    const sys = c ? c.sel.ours : [];
    const bgKeys = Content.bg.map((b) => b.key);
    const head = [
      "pid", "seq", "pilot", "finished", "total_min",
      ...bgKeys, "role_other", "interval_other",
      ...keys, "S4_rev", "A2_rev",
      "R1_code", "R1_method", "R1_why", "R2a_code", "R2a_method", "R2b_code", "R2b_method",
      "free_values", "free_overlap_Sstar", "free_cover_refs", "free_ms", "free_changes", "free_reason",
      "free2_values", "free2_ms",
    ];
    const rev = (v) => (typeof v === "number" ? 8 - v : v ?? "");
    const rows = sessions.map((s) => {
      const total = (s.log || []).reduce((a, e) => a + ((e.end || e.start) - e.start), 0);
      const B = s.blind || {};
      const D = B.decoded || {};
      const F = s.free || {};
      const vals = (F.values || []).slice().sort((a, b) => a - b);
      const cov = c && vals.length ? coverage(c.id, vals) : null;
      return [
        s.pid, s.seq, s.pilot ? 1 : 0, s.finishedAt ? 1 : 0, round(total / 60000, 1),
        ...bgKeys.map((k) => (s.bg ? s.bg[k] ?? "" : "")), s.bg ? s.bg.roleOther || "" : "", s.bg ? s.bg.intervalOther || "" : "",
        ...keys.map((k) => survey(s, k) ?? ""), rev(survey(s, "S4")), rev(survey(s, "A2")),
        B.r1 || "", D.r1 || "", B.r1why || "", B.r2a || "", D.r2a || "", B.r2b || "", D.r2b || "",
        vals.map((i) => (c ? c.candidates[i] : i)).join(" "), vals.filter((i) => sys.includes(i)).length, cov ? `${cov.n}/${cov.of}` : "", F.ms ?? "", (F.clicks || []).filter((x) => x.op === "remove").length, F.reason || "",
        F.step2 && F.step2.valuesV ? F.step2.valuesV.join(" ") : "", F.step2 ? F.step2.ms ?? "" : "",
      ];
    });
    return toCSV(head, rows);
  }
  function refCSV() {
    const head = ["case_id", "idx", "value", "type", "x", "y", "lat", "lon", "annotator", "t"];
    const rows = [];
    for (const r of Object.values(Store.refs)) for (const p of r.points || []) rows.push([r.caseId, p.idx, p.value, p.type, p.x, p.y, p.lat ?? "", p.lon ?? "", r.annotator || "", p.t ? new Date(p.t).toISOString() : ""]);
    return toCSV(head, rows);
  }
  function notesMD(sessions) {
    const L = [];
    L.push(`# 专家评估 · 主持人笔记与访谈要点`, "", `导出于 ${new Date().toLocaleString()}　共 ${sessions.length} 个会话`, "");
    for (const s of sessions) {
      L.push(`## ${s.pid}${s.pilot ? "（预实验）" : ""}`, "");
      const bg = s.bg || {};
      L.push(`- 配法序号 ${s.seq}；开始 ${new Date(s.createdAt).toLocaleString()}；${s.finishedAt ? "已完成" : "未完成"}`);
      L.push(`- 背景：${[bg.role === "其他" ? bg.roleOther : bg.role, bg.years != null ? `${bg.years} 年` : null, bg.freq ? `集合预报${bg.freq}` : null, bg.spaghetti ? `面条图${bg.spaghetti}` : null, bg.interval ? `间隔：${bg.interval === "其他" ? bg.intervalOther : bg.interval}` : null, bg.color ? `色觉${bg.color}` : null].filter(Boolean).join("；")}`, "");
      const notes = s.notes || {};
      const section = (title, lines) => {
        const xs = lines.filter((x) => x && String(x).trim());
        if (!xs.length) return;
        L.push(`### ${title}`, "", ...xs, "");
      };
      for (const st of Plan.STAGES) if (notes[st.key]) section(`笔记 · ${st.group}`, [notes[st.key]]);
      if (s.free) section("凭经验选线 · 理由", [s.free.reason, s.free.step2 && s.free.step2.reason ? `（第二步）${s.free.step2.reason}` : ""]);
      section(
        "找分歧 · Q2",
        (s.find || []).filter((f) => f && f.q2).map((f) => `- 第 ${f.order + 1} 张（${f.caseKey}，图 ${f.code}）：${f.q2}`),
      );
      section(
        "归因 · 物理解释",
        (s.attr || []).filter((a) => a && a.text).map((a) => `- ${a.caseKey}（${fmtVal(a.value)}，系统：${CH_LABEL[a.sys]}，专家：${CH_LABEL[a.choice] || "—"}，一致度 ${a.agree ?? "—"}）：${a.text}`),
      );
      if (s.blind) section("盲对比 · R1 理由", [s.blind.r1why ? `- 选图 ${s.blind.r1}：${s.blind.r1why}` : ""]);
      if (s.reveal) section("选线对照", Content.revealQs.map((qq, i) => (s.reveal[`t${i + 1}`] ? `- **${qq}** ${s.reveal[`t${i + 1}`]}` : "")));
      if (s.interview) section("访谈", Content.interview.map((it, i) => (s.interview[`q${i + 1}`] ? `**Q${i + 1} ${it.q}**\n\n${s.interview[`q${i + 1}`]}\n` : "")));
    }
    return L.join("\n");
  }

  ICU.Results = Results;
  ICU.Score = { scoreFind, coverage, refsFor };
})();
