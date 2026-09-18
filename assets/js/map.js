/* 地图渲染（设计文档第 9 节）：三种画法共用完全相同的渲染，差别只来自"选了哪些值"。
 *   底图：集合平均场去饱和灰度填色 + 海岸线 / 湖泊 / 国界 + 经纬网
 *   线束：成员细线 ~0.9 px、不透明度 0.4；均值粗线 ~2.6 px（白色衬边）
 *   分歧带：25–75% 超越概率区域，只在归因、参照标注里显示
 * 坐标：网格坐标 (列 x, 行 y)，行 0 在北；等距圆柱投影。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { h, Geo } = ICU;

  /* 线色：10 色分类色板（已用 dataviz 校验：相邻 CVD ΔE ≥ 9.1、正常视觉 ≥ 19.6）。
   * 第 j 条（按数值从小到大）总用第 j 个颜色，与画法无关。 */
  const PALETTES = {
    default: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948", "#0f9bb5", "#9c5a1a"],
    // 色盲友好：Okabe–Ito 为主，另加虚线型作第二编码
    cvd: ["#0072b2", "#e69f00", "#56b4e9", "#d55e00", "#009e73", "#cc79a7", "#6a3d9a", "#b8a000", "#1b7837", "#e05a8a"],
  };
  const DASHES = [null, [7, 3], null, [2, 2.5], null, [9, 3, 2, 3], null, [4, 4], null, [1.5, 3]];
  let paletteName = "default";
  function lineStyle(j) {
    const pal = PALETTES[paletteName];
    return { color: pal[j % pal.length], dash: paletteName === "cvd" ? DASHES[j % DASHES.length] : null };
  }
  function setPalette(name) {
    paletteName = PALETTES[name] ? name : "default";
    for (const m of MapView.instances) m.redraw();
    document.dispatchEvent(new CustomEvent("icu-palette"));
  }

  const FILL_STEPS = 12;
  const MARK_RED = "#d7263d";

  /* 每个 (案例, 候选) 的 Path2D 缓存：网格坐标，重绘时只换变换矩阵 */
  function pathsFor(c, idx) {
    const g = Geo.level(c, idx);
    if (!g.meanPath) {
      const toPath = (segs) => {
        const p = new Path2D();
        for (let i = 0; i < segs.length; i += 4) {
          p.moveTo(segs[i], segs[i + 1]);
          p.lineTo(segs[i + 2], segs[i + 3]);
        }
        return p;
      };
      g.meanPath = toPath(g.mean);
      g.memberPaths = g.members.map(toPath);
    }
    return g;
  }
  function bandImage(c, idx, color, alpha = 0.26) {
    const g = Geo.level(c, idx);
    const key = `${color}|${alpha}`;
    g.bandImgs = g.bandImgs || {};
    if (g.bandImgs[key]) return g.bandImgs[key];
    const cv = document.createElement("canvas");
    cv.width = c.nx;
    cv.height = c.ny;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(c.nx, c.ny);
    const r = parseInt(color.slice(1, 3), 16),
      gg = parseInt(color.slice(3, 5), 16),
      b = parseInt(color.slice(5, 7), 16);
    for (let i = 0; i < c.nx * c.ny; i++) {
      if (!g.band[i]) continue;
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(img, 0, 0);
    g.bandImgs[key] = cv;
    return cv;
  }
  function geoPaths(c) {
    if (c._geoPaths) return c._geoPaths;
    const mk = (polys) => {
      const p = new Path2D();
      for (const poly of polys || []) {
        p.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) p.lineTo(poly[i], poly[i + 1]);
      }
      return p;
    };
    c._geoPaths = {
      coast: mk(c.coast),
      lakes: mk(c.geo.lakes),
      border: mk(c.geo.border),
      states: mk(c.geo.states),
    };
    return c._geoPaths;
  }

  class MapView {
    /**
     * opts: {case, interactive=true, maxHeight, onClick(gx,gy,ev), onHover(info),
     *        onMarkerDrag(id,gx,gy), readout=true, zoom=true, cursor}
     */
    constructor(opts) {
      this.o = Object.assign({ interactive: true, readout: true, zoom: true, maxHeight: 820, fill: true }, opts);
      this.c = opts.case;
      this.levels = [];
      this.markers = [];
      this.rings = []; // 判定半径示意 [{x,y,r}]
      this.view = { x0: 0, y0: 0, s: 1 }; // s = 放大倍数
      this.W = 0;
      this.H = 0;
      this.el = h("div", { class: "map" + (this.o.interactive ? " interactive" : "") });
      this.stack = h("div", { class: "map-stack" });
      this.cvBase = h("canvas", { class: "map-cv", "aria-hidden": "true" });
      this.cvLines = h("canvas", { class: "map-cv", "aria-hidden": "true" });
      this.cvOver = h("canvas", { class: "map-cv over", role: "img", "aria-label": opts.ariaLabel || "等值线地图" });
      this.stack.append(this.cvBase, this.cvLines, this.cvOver);
      this.el.append(this.stack);
      if (this.o.readout && this.o.interactive) {
        this.readout = h("div", { class: "map-readout", "aria-live": "off" }, "");
        this.el.append(this.readout);
      }
      if (this.o.zoom && this.o.interactive) {
        const zb = (label, title, fn) =>
          h("button", { class: "zbtn", type: "button", title, "aria-label": title, onclick: (e) => (e.stopPropagation(), fn()) }, label);
        this.zoomBar = h(
          "div",
          { class: "map-zoom" },
          zb("+", "放大", () => this.zoomBy(1.6)),
          zb("−", "缩小", () => this.zoomBy(1 / 1.6)),
          zb("⟲", "复位", () => this.resetView()),
        );
        this.el.append(this.zoomBar);
      }
      if (this.c && this.c.source === "demo") this.el.append(h("div", { class: "map-demo-tag" }, "演示数据"));
      this._bind();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this.el);
      MapView.instances.add(this);
    }
    destroy() {
      this._ro.disconnect();
      MapView.instances.delete(this);
    }
    setCase(c) {
      this.c = c;
      this.view = { x0: 0, y0: 0, s: 1 };
      this._resize(true);
    }

    /* ---------- 数据 ---------- */
    setLevels(levels) {
      this.levels = levels || [];
      this._drawLines();
    }
    setMarkers(markers, rings) {
      this.markers = markers || [];
      if (rings) this.rings = rings;
      this._drawOver();
    }
    redraw() {
      this._drawBase();
      this._drawLines();
      this._drawOver();
    }

    /* ---------- 几何 ---------- */
    get aspect() {
      const c = this.c;
      return ((c.ny - 1) * Math.abs(c.dLat)) / ((c.nx - 1) * Math.abs(c.dLon));
    }
    /** 每网格单位的屏幕像素（x、y 方向） */
    get kx() {
      return (this.W / (this.c.nx - 1)) * this.view.s;
    }
    get ky() {
      return (this.H / (this.c.ny - 1)) * this.view.s;
    }
    toScreen(gx, gy) {
      return [(gx - this.view.x0) * this.kx, (gy - this.view.y0) * this.ky];
    }
    toGrid(px, py) {
      return [px / this.kx + this.view.x0, py / this.ky + this.view.y0];
    }
    _clampView() {
      const c = this.c,
        v = this.view;
      v.s = Math.max(1, Math.min(10, v.s));
      const vw = (c.nx - 1) / v.s,
        vh = (c.ny - 1) / v.s;
      v.x0 = Math.max(0, Math.min(c.nx - 1 - vw, v.x0));
      v.y0 = Math.max(0, Math.min(c.ny - 1 - vh, v.y0));
    }
    zoomBy(f, px, py) {
      const v = this.view;
      if (px == null) {
        px = this.W / 2;
        py = this.H / 2;
      }
      const [gx, gy] = this.toGrid(px, py);
      v.s *= f;
      this._clampView();
      v.x0 = gx - px / this.kx;
      v.y0 = gy - py / this.ky;
      this._clampView();
      this._schedule();
    }
    resetView() {
      this.view = { x0: 0, y0: 0, s: 1 };
      this._schedule();
    }
    _schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.redraw();
        if (this.zoomBar) this.zoomBar.classList.toggle("zoomed", this.view.s > 1.01);
      });
    }
    _resize(force) {
      if (!this.c) return;
      const w = Math.floor(this.el.clientWidth);
      if (!w) return;
      let H = Math.round(w * this.aspect);
      let W = w;
      if (this.o.maxHeight && H > this.o.maxHeight) {
        H = this.o.maxHeight;
        W = Math.round(H / this.aspect);
      }
      if (!force && W === this.W && H === this.H) return;
      this.W = W;
      this.H = H;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.dpr = dpr;
      for (const cv of [this.cvBase, this.cvLines, this.cvOver]) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        cv.style.width = W + "px";
        cv.style.height = H + "px";
      }
      this.stack.style.width = W + "px";
      this.stack.style.height = H + "px";
      this.redraw();
    }
    _worldCtx(cv, clear = true) {
      const ctx = cv.getContext("2d");
      const d = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (clear) ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(this.kx * d, 0, 0, this.ky * d, -this.view.x0 * this.kx * d, -this.view.y0 * this.ky * d);
      return ctx;
    }
    /** 屏幕像素 -> 世界线宽 */
    _px(p) {
      return p / Math.sqrt(this.kx * this.ky);
    }

    /* ---------- 底图 ---------- */
    _drawBase() {
      if (!this.W) return;
      const c = this.c,
        cv = this.cvBase,
        d = this.dpr;
      const ctx = cv.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const Wd = cv.width,
        Hd = cv.height;
      const img = ctx.createImageData(Wd, Hd);
      const [vmin, vmax] = c.meanRange;
      const span = vmax - vmin || 1;
      const f = c.mean,
        nx = c.nx,
        ny = c.ny;
      const kx = this.kx * d,
        ky = this.ky * d,
        x0 = this.view.x0,
        y0 = this.view.y0;
      // 灰阶：浅 (246) -> 深 (176)，带极轻的冷色偏
      const lut = [];
      for (let s = 0; s < FILL_STEPS; s++) {
        const t = s / (FILL_STEPS - 1);
        const g = Math.round(247 - t * 70);
        lut.push([g - 2, g, g + 3]);
      }
      const data = img.data;
      for (let py = 0; py < Hd; py++) {
        const gy = Math.min(ny - 1.0001, Math.max(0, (py + 0.5) / ky + y0));
        const yi = Math.floor(gy),
          fy = gy - yi;
        for (let px = 0; px < Wd; px++) {
          const gx = Math.min(nx - 1.0001, Math.max(0, (px + 0.5) / kx + x0));
          const xi = Math.floor(gx),
            fx = gx - xi;
          const i = yi * nx + xi;
          const v = f[i] * (1 - fx) * (1 - fy) + f[i + 1] * fx * (1 - fy) + f[i + nx] * (1 - fx) * fy + f[i + nx + 1] * fx * fy;
          let s = Math.floor(((v - vmin) / span) * FILL_STEPS);
          if (s < 0) s = 0;
          else if (s >= FILL_STEPS) s = FILL_STEPS - 1;
          const col = lut[s];
          const o = (py * Wd + px) * 4;
          data[o] = col[0];
          data[o + 1] = col[1];
          data[o + 2] = col[2];
          data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      // 经纬网 + 地理要素（世界坐标）
      const w = this._worldCtx(cv, false);
      if (c.hasGeo) {
        const gp = geoPaths(c);
        w.lineJoin = "round";
        w.strokeStyle = "rgba(38,48,56,0.16)";
        w.lineWidth = this._px(0.5);
        w.stroke(gp.states);
        w.setLineDash([this._px(3), this._px(2.5)]);
        w.strokeStyle = "rgba(38,48,56,0.42)";
        w.lineWidth = this._px(0.7);
        w.stroke(gp.border);
        w.setLineDash([]);
        w.strokeStyle = "rgba(30,38,46,0.72)";
        w.lineWidth = this._px(0.85);
        w.stroke(gp.coast);
        w.lineWidth = this._px(0.6);
        w.stroke(gp.lakes);
        this._graticule(w);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    _graticule(w) {
      const c = this.c;
      const step = this.view.s >= 3 ? 5 : 10;
      w.save();
      w.strokeStyle = "rgba(40,52,62,0.13)";
      w.lineWidth = this._px(0.6);
      w.setLineDash([this._px(2), this._px(3)]);
      w.beginPath();
      const lonToX = (lon) => (lon - c.lon[0]) / c.dLon;
      const latToY = (lat) => (c.lat[1] - lat) / c.dLat;
      const lons = [],
        lats = [];
      for (let lon = Math.ceil(c.lon[0] / step) * step; lon <= c.lon[1]; lon += step) {
        const x = lonToX(lon);
        w.moveTo(x, 0);
        w.lineTo(x, c.ny - 1);
        lons.push([lon, x]);
      }
      for (let lat = Math.ceil(c.lat[0] / step) * step; lat <= c.lat[1]; lat += step) {
        const y = latToY(lat);
        w.moveTo(0, y);
        w.lineTo(c.nx - 1, y);
        lats.push([lat, y]);
      }
      w.stroke();
      w.restore();
      // 刻度标签（屏幕坐标）
      const ctx = this.cvBase.getContext("2d");
      const d = this.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.font = "500 10px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.fillStyle = "rgba(34,44,52,0.62)";
      ctx.textBaseline = "bottom";
      for (const [lon, x] of lons) {
        const [sx] = this.toScreen(x, 0);
        if (sx < 24 || sx > this.W - 24) continue;
        const t = `${Math.abs(lon)}°${lon < 0 ? "W" : lon > 0 ? "E" : ""}`;
        ctx.textAlign = "center";
        ctx.fillText(t, sx, this.H - 3);
      }
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (const [lat, y] of lats) {
        const [, sy] = this.toScreen(0, y);
        if (sy < 12 || sy > this.H - 18) continue;
        ctx.fillText(`${lat}°N`, 4, sy);
      }
    }

    /* ---------- 线束 ---------- */
    _drawLines() {
      if (!this.W) return;
      const c = this.c;
      const w = this._worldCtx(this.cvLines);
      w.lineJoin = "round";
      w.lineCap = "round";
      // 分歧带（最底）
      w.imageSmoothingEnabled = true;
      for (const L of this.levels) {
        if (!L.band) continue;
        w.globalAlpha = L.fade != null ? L.fade : 1;
        w.drawImage(bandImage(c, L.idx, L.bandColor || L.color, L.bandAlpha || 0.26), -0.5, -0.5, c.nx, c.ny);
      }
      w.globalAlpha = 1;
      // 成员细线
      for (const L of this.levels) {
        if (!L.members) continue;
        const g = pathsFor(c, L.idx);
        w.strokeStyle = L.color;
        w.globalAlpha = (L.alpha != null ? L.alpha : 0.4) * (L.fade != null ? L.fade : 1);
        w.lineWidth = this._px(L.memberWidth || 0.9);
        w.setLineDash([]);
        for (const p of g.memberPaths) w.stroke(p);
      }
      w.globalAlpha = 1;
      // 均值粗线：白色衬边 + 色线
      for (const L of this.levels) {
        if (!L.mean) continue;
        const g = pathsFor(c, L.idx);
        const fade = L.fade != null ? L.fade : 1;
        const width = L.width || 2.6;
        w.setLineDash([]);
        w.globalAlpha = 0.85 * fade;
        w.strokeStyle = "#ffffff";
        w.lineWidth = this._px(width + 2.2);
        w.stroke(g.meanPath);
        w.globalAlpha = fade;
        w.strokeStyle = L.meanColor || L.color;
        w.lineWidth = this._px(width);
        if (L.dash) w.setLineDash(L.dash.map((x) => this._px(x)));
        w.stroke(g.meanPath);
        w.setLineDash([]);
      }
      w.globalAlpha = 1;
      // 等值线数值标注
      const labeled = this.levels.filter((L) => L.label);
      if (labeled.length) this._labels(labeled);
    }
    _labels(levels) {
      const c = this.c;
      const ctx = this.cvLines.getContext("2d");
      const d = this.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const placed = [];
      // 每条线最多标几处、彼此至少隔多远（屏幕像素）：像天气图那样稀疏地标
      const perLevel = Math.max(2, Math.round((this.W * this.H) / 160000));
      const minGap = 190;
      for (const L of levels) {
        const segs = Geo.level(c, L.idx).mean;
        let n = 0;
        // 从线段序列里等间隔取样，避免标签都挤在第一段
        const nSeg = segs.length / 4;
        const stride = Math.max(1, Math.floor(nSeg / 400));
        const order = [];
        for (let k = 0; k < nSeg; k += stride) order.push(k);
        order.sort((a, b) => ((a * 7919) % 997) - ((b * 7919) % 997)); // 固定伪随机顺序，重绘时标签位置不跳
        for (const k of order) {
          if (n >= perLevel) break;
          const i = k * 4;
          const mx = (segs[i] + segs[i + 2]) / 2,
            my = (segs[i + 1] + segs[i + 3]) / 2;
          const [sx, sy] = this.toScreen(mx, my);
          if (sx < 40 || sy < 20 || sx > this.W - 60 || sy > this.H - 24) continue;
          if (placed.some(([px, py, lv]) => (lv === L.idx ? Math.hypot(px - sx, py - sy) < minGap : Math.abs(px - sx) < 54 && Math.abs(py - sy) < 20))) continue;
          n++;
          placed.push([sx, sy, L.idx]);
          const t = L.label;
          const tw = ctx.measureText(t).width + 8;
          ctx.fillStyle = "rgba(255,255,255,0.88)";
          ctx.beginPath();
          ctx.roundRect(sx - tw / 2, sy - 8, tw, 16, 3);
          ctx.fill();
          ctx.fillStyle = L.labelColor || "#111";
          ctx.fillText(t, sx, sy + 0.5);
        }
      }
    }

    /* ---------- 标注层 ---------- */
    _drawOver() {
      if (!this.W) return;
      const ctx = this.cvOver.getContext("2d");
      const d = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.cvOver.width, this.cvOver.height);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      // 判定半径示意
      for (const r of this.rings) {
        const [sx, sy] = this.toScreen(r.x, r.y);
        ctx.beginPath();
        ctx.ellipse(sx, sy, r.r * this.kx, r.r * this.ky, 0, 0, Math.PI * 2);
        ctx.fillStyle = r.fill || "rgba(215,38,61,0.07)";
        ctx.fill();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = r.stroke || "rgba(215,38,61,0.45)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const m of this.markers) {
        const [sx, sy] = this.toScreen(m.x, m.y);
        if (sx < -20 || sy < -20 || sx > this.W + 20 || sy > this.H + 20) continue;
        const col = m.color || MARK_RED;
        if (m.kind === "ghost") {
          ctx.beginPath();
          ctx.arc(sx, sy, 6, 0, Math.PI * 2);
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.75;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          if (m.n != null) {
            ctx.font = "600 10px 'IBM Plex Mono', monospace";
            ctx.fillStyle = col;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(String(m.n), sx + 8, sy);
          }
          continue;
        }
        const r = m.kind === "small" ? 6 : 10;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        if (m.selected) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (m.n != null && m.kind !== "small") {
          ctx.font = "700 11px 'IBM Plex Mono', ui-monospace, monospace";
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(m.n), sx, sy + 0.5);
        }
      }
    }
    _hitMarker(px, py) {
      let best = null,
        bd = 14 * 14;
      for (const m of this.markers) {
        if (m.kind === "ghost" || m.id == null) continue;
        const [sx, sy] = this.toScreen(m.x, m.y);
        const dd = (sx - px) ** 2 + (sy - py) ** 2;
        if (dd < bd) {
          bd = dd;
          best = m;
        }
      }
      return best;
    }

    /* ---------- 交互 ---------- */
    _bind() {
      if (!this.o.interactive) return;
      const cv = this.cvOver;
      let down = null;
      const pos = (e) => {
        const r = cv.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      cv.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const [px, py] = pos(e);
        const hit = this.o.onMarkerDrag ? this._hitMarker(px, py) : null;
        down = { px, py, x0: this.view.x0, y0: this.view.y0, moved: false, marker: hit, id: e.pointerId };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener("pointermove", (e) => {
        const [px, py] = pos(e);
        if (down) {
          const dx = px - down.px,
            dy = py - down.py;
          if (!down.moved && dx * dx + dy * dy > 16) down.moved = true;
          if (down.moved) {
            if (down.marker) {
              const [gx, gy] = this.toGrid(px, py);
              down.marker.x = Math.max(0, Math.min(this.c.nx - 1, gx));
              down.marker.y = Math.max(0, Math.min(this.c.ny - 1, gy));
              this._drawOver();
            } else if (this.view.s > 1.01) {
              this.view.x0 = down.x0 - dx / this.kx;
              this.view.y0 = down.y0 - dy / this.ky;
              this._clampView();
              this.el.classList.add("panning");
              this._schedule();
            }
          }
        }
        this._hover(px, py);
      });
      const up = (e) => {
        if (!down) return;
        const [px, py] = pos(e);
        const d0 = down;
        down = null;
        this.el.classList.remove("panning");
        if (d0.moved) {
          if (d0.marker && this.o.onMarkerDrag) this.o.onMarkerDrag(d0.marker.id, d0.marker.x, d0.marker.y);
          return;
        }
        if (this.o.onClick) {
          const [gx, gy] = this.toGrid(px, py);
          this.o.onClick(gx, gy, e, this._hitMarker(px, py));
        }
      };
      cv.addEventListener("pointerup", up);
      cv.addEventListener("pointercancel", () => {
        down = null;
        this.el.classList.remove("panning");
      });
      cv.addEventListener("pointerleave", () => {
        if (this.readout) this.readout.classList.remove("on");
        if (this.o.onHover) this.o.onHover(null);
      });
      if (this.o.zoom)
        cv.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            const [px, py] = pos(e);
            this.zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, px, py);
          },
          { passive: false },
        );
    }
    _hover(px, py) {
      const [gx, gy] = this.toGrid(px, py);
      const c = this.c;
      if (gx < 0 || gy < 0 || gx > c.nx - 1 || gy > c.ny - 1) return;
      if (this.readout) {
        const v = Geo.sampleMean(c, gx, gy);
        const ll = Geo.gridToLatLon(c, gx, gy);
        this.readout.textContent = c.hasGeo ? `${ICU.fmtLatLon(ll.lat, ll.lon)}` : `x ${gx.toFixed(0)}  y ${gy.toFixed(0)}`;
        if (this.o.readoutValue) this.readout.textContent += ` · 平均 ${ICU.fmtVal(v, c.unit)}`;
        this.readout.classList.add("on");
      }
      if (this.o.onHover) this.o.onHover({ gx, gy });
    }
  }
  MapView.instances = new Set();

  /** 按数值顺序给一组候选下标配色：第 j 条用第 j 色 */
  function styledLevels(c, idxs, extra = {}) {
    const sorted = idxs.slice().sort((a, b) => a - b);
    return sorted.map((idx, j) => {
      const st = lineStyle(j);
      return Object.assign({ idx, j, color: st.color, dash: st.dash, members: true, mean: true }, typeof extra === "function" ? extra(idx, j) : extra);
    });
  }

  ICU.Map = { MapView, PALETTES, lineStyle, setPalette, styledLevels, MARK_RED, get palette() { return paletteName; } };
})();
