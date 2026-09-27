/* SVG 图表：归因条、候选谱（SCU 曲线 + 两组选值）、结果页的逐人点图。
 * 图表文字一律用主题墨色；归因三通道不用颜色区分（地图线已经用掉 10 色），
 * 靠标签 + 线型区分，最大者用强调色。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { h } = ICU;
  const NS = "http://www.w3.org/2000/svg";

  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    if (attrs)
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        el.setAttribute(k, v);
      }
    for (const k of kids.flat()) if (k != null) el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  const lin = (d0, d1, r0, r1) => (x) => r0 + ((x - d0) / (d1 - d0 || 1)) * (r1 - r0);

  const CH = [
    { key: "G", name: "位置摆动", dash: null },
    { key: "C", name: "边界模糊", dash: "5 3" },
    { key: "T", name: "分块个数不同", dash: "1.5 3" },
  ];

  /* ---------------------------------------------------------------
   * 归因条：三根横条 + 候选谱上三条曲线（竖线标当前值）
   * --------------------------------------------------------------- */
  function attrStrip(c, idx, opts = {}) {
    const wrap = h("div", { class: "attr-strip" });
    const zs = CH.map((ch) => c.desc[ch.key][idx]);
    const top = zs.indexOf(Math.max(...zs));
    const lim = Math.max(2.5, Math.ceil(Math.max(...CH.flatMap((ch) => c.desc[ch.key].map(Math.abs)))));
    // 横条
    const W = 320,
      rowH = 30,
      padL = 96,
      padR = 38;
    const x = lin(-lim, lim, padL, W - padR);
    const svg = s("svg", { viewBox: `0 0 ${W} ${rowH * 3 + 26}`, class: "chart bars", role: "img", "aria-label": "归因条" });
    // 零线与刻度
    for (const t of [-2, 0, 2]) {
      svg.append(s("line", { x1: x(t), x2: x(t), y1: 4, y2: rowH * 3 + 6, class: t === 0 ? "axis" : "grid" }));
      svg.append(s("text", { x: x(t), y: rowH * 3 + 20, class: "tick", "text-anchor": "middle" }, t > 0 ? `+${t}` : `${t}`));
    }
    CH.forEach((ch, i) => {
      const z = zs[i];
      const y = 6 + i * rowH;
      const x0 = x(0),
        x1 = x(Math.max(-lim, Math.min(lim, z)));
      svg.append(s("text", { x: padL - 10, y: y + rowH / 2 - 1, class: "row-label" + (i === top && opts.showTop ? " strong" : ""), "text-anchor": "end", "dominant-baseline": "middle" }, ch.name));
      svg.append(
        s("rect", {
          x: Math.min(x0, x1),
          y: y + 5,
          width: Math.max(2, Math.abs(x1 - x0)),
          height: rowH - 12,
          rx: 3,
          class: "bar" + (i === top ? " top" : ""),
        }),
      );
      svg.append(
        s("text", { x: z >= 0 ? x1 + 5 : x1 - 5, y: y + rowH / 2 - 1, class: "val", "text-anchor": z >= 0 ? "start" : "end", "dominant-baseline": "middle" }, (z >= 0 ? "+" : "") + z.toFixed(2)),
      );
    });
    wrap.append(h("div", { class: "chart-cap" }, "这条线上三种分歧各有多强（标准分，0 = 全部候选值的平均水平）"), svg);
    if (opts.curves !== false) wrap.append(channelCurves(c, idx, opts));
    return wrap;
  }

  function channelCurves(c, idx, opts = {}) {
    const W = 320,
      H = 150,
      pad = { l: 30, r: 78, t: 10, b: 30 };
    const nv = c.candidates.length;
    const all = CH.flatMap((ch) => c.desc[ch.key]);
    const lo = Math.min(-1, Math.floor(Math.min(...all))),
      hi = Math.max(1, Math.ceil(Math.max(...all)));
    const x = lin(0, nv - 1, pad.l, W - pad.r);
    const y = lin(lo, hi, H - pad.b, pad.t);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart curves", role: "img", "aria-label": "候选谱上的三条归因曲线" });
    for (let t = lo; t <= hi; t++) {
      if (t % 1) continue;
      svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: t === 0 ? "axis" : "grid" }));
      if (t % 2 === 0) svg.append(s("text", { x: pad.l - 5, y: y(t), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, t));
    }
    // 当前值
    svg.append(s("line", { x1: x(idx), x2: x(idx), y1: pad.t - 4, y2: H - pad.b + 4, class: "cursor" }));
    // x 轴：两端与当前值
    const lab = (i, anchor) => s("text", { x: x(i), y: H - pad.b + 16, class: "tick", "text-anchor": anchor }, ICU.fmtVal(c.candidates[i]));
    svg.append(lab(0, "start"), lab(nv - 1, "end"));
    svg.append(s("text", { x: x(idx), y: H - 4, class: "tick strong", "text-anchor": "middle" }, `当前 ${ICU.fmtVal(c.candidates[idx], c.unit)}`));
    // 三条曲线 + 端点直接标注（避免标签相撞）
    const ends = [];
    CH.forEach((ch) => {
      const d = c.desc[ch.key].map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
      svg.append(s("path", { d, class: "series", "stroke-dasharray": ch.dash }));
      svg.append(s("circle", { cx: x(idx), cy: y(c.desc[ch.key][idx]), r: 3.2, class: "dot" }));
      ends.push({ ch, y: y(c.desc[ch.key][nv - 1]) });
    });
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    for (const e of ends) svg.append(s("text", { x: W - pad.r + 6, y: e.y, class: "end-label", "dominant-baseline": "middle" }, e.ch.name));
    // 悬停读数
    hoverLayer(svg, W, H, pad, nv, x, (i) => `${ICU.fmtVal(c.candidates[i], c.unit)}　${CH.map((ch) => `${ch.name} ${c.desc[ch.key][i] >= 0 ? "+" : ""}${c.desc[ch.key][i].toFixed(2)}`).join("　")}`);
    const box = h("div", { class: "chart-wrap" }, h("div", { class: "chart-cap" }, "整个候选谱上的三条曲线；竖线 = 这条线的数值"), svg);
    return box;
  }

  /* 悬停读数：一个透明矩形接事件，最近的候选下标 */
  function hoverLayer(svg, W, H, pad, nv, x, text) {
    const g = s("g", { class: "hover" });
    const rule = s("line", { y1: pad.t, y2: H - pad.b, class: "hover-rule", visibility: "hidden" });
    const tipBg = s("rect", { rx: 4, class: "tip-bg", visibility: "hidden" });
    const tip = s("text", { class: "tip", visibility: "hidden", "dominant-baseline": "middle" });
    const hit = s("rect", { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: "transparent" });
    g.append(rule, tipBg, tip, hit);
    svg.append(g);
    const show = (e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      let best = 0,
        bd = Infinity;
      for (let i = 0; i < nv; i++) {
        const d = Math.abs(x(i) - p.x);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      const xx = x(best);
      rule.setAttribute("x1", xx);
      rule.setAttribute("x2", xx);
      tip.textContent = text(best);
      const bb = tip.getComputedTextLength ? tip.getComputedTextLength() : 120;
      const tx = Math.min(W - bb - 8, Math.max(4, xx - bb / 2));
      tip.setAttribute("x", tx);
      tip.setAttribute("y", 10);
      tipBg.setAttribute("x", tx - 4);
      tipBg.setAttribute("y", 1);
      tipBg.setAttribute("width", bb + 8);
      tipBg.setAttribute("height", 18);
      for (const el of [rule, tip, tipBg]) el.setAttribute("visibility", "visible");
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", () => {
      for (const el of [rule, tip, tipBg]) el.setAttribute("visibility", "hidden");
    });
  }

  /* ---------------------------------------------------------------
   * 候选谱：SCU 后验均值 + 90% 区间；上方您的选值、下方系统选值
   * --------------------------------------------------------------- */
  function spectrum(c, groups, opts = {}) {
    const W = opts.width || 1400,
      H = 210,
      pad = { l: 44, r: 24, t: 34, b: 58 };
    const nv = c.candidates.length;
    const x = lin(0, nv - 1, pad.l, W - pad.r);
    const lo = Math.min(...c.scu.lo),
      hi = Math.max(...c.scu.hi);
    const y = lin(lo, hi, H - pad.b, pad.t);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart spectrum", role: "img", "aria-label": "候选谱" });
    // 网格
    for (const t of [lo, (lo + hi) / 2, hi]) svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: "grid" }));
    svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: "axis" }));
    // 区间 + 均值
    const band =
      c.scu.hi.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") +
      c.scu.lo
        .map((v, i) => [i, v])
        .reverse()
        .map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
        .join("") +
      "Z";
    svg.append(s("path", { d: band, class: "scu-band" }));
    svg.append(s("path", { d: c.scu.mean.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""), class: "scu-line" }));
    svg.append(s("text", { x: pad.l, y: pad.t - 14, class: "axis-title" }, "系统估计的分歧程度（线 = 估计值，阴影 = 把握区间，越窄越有把握）"));
    // 每个候选的刻度
    for (let i = 0; i < nv; i++) svg.append(s("line", { x1: x(i), x2: x(i), y1: H - pad.b, y2: H - pad.b + 3, class: "axis" }));
    const step = nv > 20 ? 3 : 2;
    for (let i = 0; i < nv; i += step) svg.append(s("text", { x: x(i), y: H - pad.b + 14, class: "tick", "text-anchor": "middle" }, ICU.fmtVal(c.candidates[i])));
    svg.append(s("text", { x: W - pad.r, y: H - pad.b + 14, class: "tick", "text-anchor": "end" }, c.unit));
    // 两组选值
    (groups || []).forEach((g, gi) => {
      const yy = gi === 0 ? pad.t - 2 : H - pad.b + 24;
      svg.append(s("text", { x: pad.l - 8, y: yy + 6, class: "group-label", "text-anchor": "end" }, g.label));
      for (const i of g.idx) {
        const shared = groups.every((gg) => gg.idx.includes(i));
        if (gi === 0) svg.append(s("line", { x1: x(i), x2: x(i), y1: yy + 10, y2: H - pad.b, class: `sel-rule g${gi}` }));
        svg.append(s("rect", { x: x(i) - 5, y: yy, width: 10, height: 12, rx: 2.5, class: `sel-mark g${gi}${shared ? " shared" : ""}` }));
      }
    });
    hoverLayer(svg, W, H, pad, nv, x, (i) => `${ICU.fmtVal(c.candidates[i], c.unit)}　分歧程度 ${c.scu.mean[i].toFixed(2)}（${c.scu.lo[i].toFixed(2)} ~ ${c.scu.hi[i].toFixed(2)}）`);
    return h("div", { class: "chart-wrap wide-chart" }, svg);
  }

  /* ---------------------------------------------------------------
   * 结果页：每种画法一行，每位专家一个点（找到参照分歧的比例）
   * --------------------------------------------------------------- */
  function dotPlot(rows, opts = {}) {
    // rows: [{label, points:[{v, pid}], mean}]
    const W = 560,
      rowH = 44,
      pad = { l: 96, r: 30, t: 16, b: 30 };
    const H = pad.t + rows.length * rowH + pad.b;
    const x = lin(0, 1, pad.l, W - pad.r);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart dots", role: "img", "aria-label": opts.aria || "逐人点图" });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      svg.append(s("line", { x1: x(t), x2: x(t), y1: pad.t - 4, y2: H - pad.b, class: t === 0 ? "axis" : "grid" }));
      svg.append(s("text", { x: x(t), y: H - pad.b + 16, class: "tick", "text-anchor": "middle" }, `${t * 100}%`));
    }
    rows.forEach((r, i) => {
      const yy = pad.t + i * rowH + rowH / 2;
      svg.append(s("text", { x: pad.l - 12, y: yy, class: "row-label", "text-anchor": "end", "dominant-baseline": "middle" }, r.label));
      // 同值抖开
      const seen = {};
      for (const p of r.points) {
        const key = Math.round(p.v * 50);
        const k = (seen[key] = (seen[key] || 0) + 1) - 1;
        const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 7;
        const dot = s("circle", { cx: x(p.v), cy: yy + dy, r: 5, class: `pdot m-${r.key}` });
        dot.append(s("title", null, `${p.pid}：${Math.round(p.v * 100)}%`));
        svg.append(dot);
      }
      if (r.mean != null) {
        svg.append(s("line", { x1: x(r.mean), x2: x(r.mean), y1: yy - 13, y2: yy + 13, class: "mean-tick" }));
        svg.append(s("text", { x: x(r.mean), y: yy - 16, class: "tick strong", "text-anchor": "middle" }, `${Math.round(r.mean * 100)}%`));
      }
    });
    return h("div", { class: "chart-wrap" }, svg);
  }

  ICU.Charts = { attrStrip, channelCurves, spectrum, dotPlot, CH };
})();
