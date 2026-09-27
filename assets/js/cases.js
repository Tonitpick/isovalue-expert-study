/* 案例数据：6 个角色、载入（上传 > 随页面发布 > 演示）、校验、解码、等值线几何缓存、演示数据。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { b64ToBytes, mulberry32 } = ICU;

  /** 设计文档第 6 节 / questionnaire.md 的 6 个角色。id 决定角色。 */
  const ROLES = [
    { key: "train", id: "msl_fh006_na", label: "读图训练", use: "教专家读图，内容不进论文", elementHint: "EC 海平面气压 +6h" },
    { key: "free", id: "gefs_PRMSL_fh084", label: "凭经验选线 · 盲对比 · 结果对照", use: "决定全体专家的 k", elementHint: "GEFS 海平面气压 +84h" },
    { key: "C1", id: "gefs_PRMSL_fh024", label: "找分歧 C1 · 归因", use: "气压场；论文 5.5 节案例", elementHint: "GEFS 海平面气压 +24h" },
    { key: "C2", id: "gefs_tmp850_fh084", label: "找分歧 C2 · 归因", use: "温度场，GEFS（与 C3 同时效、不同系统）", elementHint: "GEFS 850 hPa 温度 +84h" },
    { key: "C3", id: "ect850_fh084", label: "找分歧 C3", use: "温度场，长时效；超时先砍", elementHint: "EC 850 hPa 温度 +84h" },
    { key: "C4", id: "gefs_RH_fh024", label: "找分歧 C4 · 归因", use: "湿度场，归因最难；必须保留", elementHint: "GEFS 850 hPa 相对湿度 +24h" },
  ];
  const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));
  const ROLE_BY_KEY = Object.fromEntries(ROLES.map((r) => [r.key, r]));
  const METHODS = ["ours", "uniform", "js"];

  /* =====================================================================
   * 校验（设计文档 5.2）
   * ===================================================================== */
  function validate(j) {
    const errs = [];
    const need = ["id", "title", "unit", "nx", "ny", "candidates", "selections", "scu", "desc"];
    for (const k of need) if (j[k] == null) errs.push(`缺少字段 ${k}`);
    if (!j.members && !j.members_q) errs.push("缺少字段 members（或压缩形式 members_q）");
    if (errs.length) return errs;
    const n = j.nx * j.ny;
    if (!(j.nx > 2 && j.ny > 2)) errs.push(`nx、ny 不合法：${j.nx}×${j.ny}`);
    if (j.members) {
      if (!Array.isArray(j.members) || j.members.length < 2) errs.push("members 至少要有 2 个成员");
      else
        j.members.forEach((m, i) => {
          if (!m || m.length !== n) errs.push(`成员 ${i} 长度 ${m ? m.length : 0} ≠ nx×ny = ${n}`);
        });
    } else {
      const q = j.members_q;
      const bytes = Math.floor((q.b64.length * 3) / 4) - (q.b64.endsWith("==") ? 2 : q.b64.endsWith("=") ? 1 : 0);
      if (bytes !== q.n * n * 2) errs.push(`members_q 字节数 ${bytes} ≠ 成员数×nx×ny×2 = ${q.n * n * 2}`);
    }
    const nv = j.candidates.length;
    if (nv < 3) errs.push("candidates 少于 3 个");
    for (let i = 1; i < nv; i++)
      if (!(j.candidates[i] > j.candidates[i - 1])) {
        errs.push("candidates 必须严格递增");
        break;
      }
    const counts = METHODS.map((m) => (j.selections[m] || []).length);
    METHODS.forEach((m, i) => {
      if (!j.selections[m]) errs.push(`selections 缺少 ${m}`);
      else if (!counts[i]) errs.push(`selections.${m} 为空`);
    });
    if (new Set(counts).size > 1) errs.push(`三种画法条数不同：ours ${counts[0]} / uniform ${counts[1]} / js ${counts[2]}`);
    const span = j.candidates[nv - 1] - j.candidates[0] || 1;
    for (const m of METHODS)
      for (const v of j.selections[m] || []) {
        const d = Math.min(...j.candidates.map((c) => Math.abs(c - v)));
        if (d > span * 1e-4) errs.push(`selections.${m} 里的值 ${v} 不在 candidates 中`);
      }
    for (const f of ["mean", "lo", "hi"])
      if (!j.scu[f] || j.scu[f].length !== nv) errs.push(`scu.${f} 长度 ${(j.scu[f] || []).length} ≠ 候选数 ${nv}`);
    for (const f of ["G", "C", "T"])
      if (!j.desc[f] || j.desc[f].length !== nv) errs.push(`desc.${f} 长度 ${(j.desc[f] || []).length} ≠ 候选数 ${nv}`);
    if (j.desc.F && j.desc.F.length !== nv) errs.push(`desc.F 长度 ≠ 候选数 ${nv}`);
    if (j.util && j.util.length !== nv) errs.push(`util 长度 ≠ 候选数 ${nv}`);
    return errs;
  }

  /* =====================================================================
   * 解码成运行时对象
   * ===================================================================== */
  function decode(j, source) {
    const nx = j.nx,
      ny = j.ny,
      n = nx * ny;
    let members;
    if (j.members) {
      members = j.members.map((m) => Float32Array.from(m));
    } else {
      const q = j.members_q;
      const bytes = b64ToBytes(q.b64);
      const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      members = [];
      for (let m = 0; m < q.n; m++) {
        const out = new Float32Array(n);
        const o = m * n;
        for (let i = 0; i < n; i++) out[i] = q.offset + u16[o + i] * q.scale;
        members.push(out);
      }
    }
    const M = members.length;
    const meanF = new Float32Array(n);
    for (const f of members) for (let i = 0; i < n; i++) meanF[i] += f[i];
    for (let i = 0; i < n; i++) meanF[i] /= M;
    let vmin = Infinity,
      vmax = -Infinity;
    for (let i = 0; i < n; i++) {
      if (meanF[i] < vmin) vmin = meanF[i];
      if (meanF[i] > vmax) vmax = meanF[i];
    }
    const cand = j.candidates.slice();
    const toIdx = (v) => {
      let best = 0,
        bd = Infinity;
      cand.forEach((c, i) => {
        const d = Math.abs(c - v);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    const sel = {};
    for (const m of METHODS) sel[m] = (j.selections[m] || []).map(toIdx).sort((a, b) => a - b);
    const lat = j.lat || [0, ny - 1];
    const lon = j.lon || [0, nx - 1];
    const c = {
      id: j.id,
      role: ROLE_BY_ID[j.id] ? ROLE_BY_ID[j.id].key : j.role || null,
      title: j.title,
      element: j.element || j.title,
      system: j.system || "",
      leadH: j.lead_h,
      initTime: j.init_time || "",
      unit: j.unit,
      nx,
      ny,
      M,
      members,
      mean: meanF,
      meanRange: [vmin, vmax],
      candidates: cand,
      sel,
      k: sel.ours.length,
      scu: j.scu,
      desc: j.desc,
      util: j.util || null,
      coast: j.coast || [],
      geo: j.geo || {},
      lat, // [南, 北]
      lon, // [西, 东]
      hasGeo: !!j.lat,
      source,
      provenance: j.provenance || null,
      _cache: new Map(),
    };
    c.dLon = (lon[1] - lon[0]) / (nx - 1);
    c.dLat = (lat[1] - lat[0]) / (ny - 1);
    return c;
  }

  /* =====================================================================
   * 几何：marching squares、成员超越概率、25–75% 分歧带
   * ===================================================================== */
  /** 返回扁平线段数组 [x0,y0,x1,y1, ...]，坐标 = (列, 行)，行 0 在北。 */
  function marchingSquares(f, nx, ny, v) {
    const out = [];
    for (let y = 0; y < ny - 1; y++) {
      const r0 = y * nx,
        r1 = r0 + nx;
      for (let x = 0; x < nx - 1; x++) {
        const a = f[r0 + x],
          b = f[r0 + x + 1],
          c = f[r1 + x + 1],
          d = f[r1 + x];
        let code = 0;
        if (a >= v) code |= 8;
        if (b >= v) code |= 4;
        if (c >= v) code |= 2;
        if (d >= v) code |= 1;
        if (code === 0 || code === 15) continue;
        // 四条边上的交点
        const top = () => [x + (v - a) / (b - a), y];
        const right = () => [x + 1, y + (v - b) / (c - b)];
        const bottom = () => [x + (v - d) / (c - d), y + 1];
        const left = () => [x, y + (v - a) / (d - a)];
        const seg = (p, q) => out.push(p[0], p[1], q[0], q[1]);
        switch (code) {
          case 1:
          case 14:
            seg(left(), bottom());
            break;
          case 2:
          case 13:
            seg(bottom(), right());
            break;
          case 3:
          case 12:
            seg(left(), right());
            break;
          case 4:
          case 11:
            seg(top(), right());
            break;
          case 6:
          case 9:
            seg(top(), bottom());
            break;
          case 7:
          case 8:
            seg(left(), top());
            break;
          case 5:
          case 10: {
            // 鞍点：用格心均值消歧
            const center = (a + b + c + d) / 4;
            const hi = center >= v;
            if ((code === 5) === hi) {
              seg(left(), top());
              seg(bottom(), right());
            } else {
              seg(top(), right());
              seg(left(), bottom());
            }
            break;
          }
        }
      }
    }
    return new Float32Array(out);
  }

  /** 一个候选值的全部几何（懒计算、缓存） */
  function level(c, idx) {
    const key = `L${idx}`;
    if (c._cache.has(key)) return c._cache.get(key);
    const v = c.candidates[idx];
    const n = c.nx * c.ny;
    const p = new Float32Array(n);
    for (const f of c.members) for (let i = 0; i < n; i++) if (f[i] >= v) p[i] += 1;
    const band = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      p[i] /= c.M;
      band[i] = p[i] >= 0.25 && p[i] <= 0.75 ? 1 : 0;
    }
    const g = {
      idx,
      v,
      mean: marchingSquares(c.mean, c.nx, c.ny, v),
      members: c.members.map((f) => marchingSquares(f, c.nx, c.ny, v)),
      p,
      band,
    };
    c._cache.set(key, g);
    return g;
  }

  /** 点击点附近（半径 r 格）是否有该值的分歧带 */
  function bandNear(c, idx, gx, gy, r = 3) {
    const g = level(c, idx);
    const x0 = Math.max(0, Math.floor(gx - r)),
      x1 = Math.min(c.nx - 1, Math.ceil(gx + r));
    const y0 = Math.max(0, Math.floor(gy - r)),
      y1 = Math.min(c.ny - 1, Math.ceil(gy + r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if ((x - gx) ** 2 + (y - gy) ** 2 > r * r) continue;
        if (g.band[y * c.nx + x]) return true;
      }
    return false;
  }

  function gridToLatLon(c, gx, gy) {
    return { lon: c.lon[0] + gx * c.dLon, lat: c.lat[1] - gy * c.dLat };
  }
  /** 双线性取值 */
  function sampleMean(c, gx, gy) {
    const x = Math.max(0, Math.min(c.nx - 1.001, gx)),
      y = Math.max(0, Math.min(c.ny - 1.001, gy));
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0;
    const i = y0 * c.nx + x0;
    const f = c.mean;
    return f[i] * (1 - fx) * (1 - fy) + f[i + 1] * fx * (1 - fy) + f[i + c.nx] * (1 - fx) * fy + f[i + c.nx + 1] * fx * fy;
  }
  /** 格距（km），按域中心纬度 */
  function cellKm(c) {
    const midLat = ((c.lat[0] + c.lat[1]) / 2) * (Math.PI / 180);
    const kmLat = Math.abs(c.dLat) * 111.2;
    const kmLon = Math.abs(c.dLon) * 111.2 * Math.cos(midLat);
    return { kmLat, kmLon, km: (kmLat + kmLon) / 2 };
  }

  /* =====================================================================
   * 演示数据：没载入真实案例时的兜底（主持人页面标黄）
   * 注意：这里的"选线"是简化公式（三个描述子简单平均 + 平滑 + 贪心），
   * 不是层次贝叶斯 SCU，绝不能进论文。
   * ===================================================================== */
  const DEMO_KIND = { train: "pressure", free: "pressure", C1: "pressure", C2: "temp", C3: "temp", C4: "rh" };
  const DEMO_META = {
    precip: { element: "总降水", unit: "mm", M: 31 },
    pressure: { element: "海平面气压", unit: "hPa", M: 31 },
    temp: { element: "850 hPa 温度", unit: "°C", M: 31 },
    rh: { element: "850 hPa 相对湿度", unit: "%", M: 31 },
  };

  function makeDemo(roleKey) {
    const role = ROLE_BY_KEY[roleKey];
    const kind = DEMO_KIND[roleKey];
    const meta = DEMO_META[kind];
    const seed = { train: 11, free: 23, C1: 37, C2: 41, C3: 53, C4: 67 }[roleKey];
    const rng = mulberry32(seed);
    const nx = 181,
      ny = 95,
      n = nx * ny,
      M = meta.M;
    const gauss = () => {
      let u = 0,
        v = 0;
      while (!u) u = rng();
      while (!v) v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    // 基础系统：若干高低压 / 暖冷舌 / 湿区
    const nSys = kind === "temp" ? 4 : 5;
    const systems = [];
    for (let s = 0; s < nSys; s++)
      systems.push({
        x: 20 + rng() * (nx - 40),
        y: 12 + rng() * (ny - 24),
        amp: (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.8),
        r: 10 + rng() * 16,
        spread: 1.5 + rng() * 5.5, // 成员位置扰动（格）
        split: rng() < 0.35, // 部分成员分裂成两个中心 -> 系统个数不同
      });
    const lead = { train: 18, free: 84, C1: 24, C2: 24, C3: 84, C4: 24 }[roleKey];
    const growth = lead > 48 ? 1.8 : 1;
    const members = [];
    for (let m = 0; m < M; m++) {
      const f = new Float32Array(n);
      const ms = systems.map((s) => ({
        x: s.x + gauss() * s.spread * growth,
        y: s.y + gauss() * s.spread * 0.6 * growth,
        amp: s.amp * (1 + gauss() * 0.15),
        r: s.r * (1 + gauss() * 0.12),
        split: s.split && rng() < 0.45,
      }));
      const tilt = gauss() * 0.15;
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          let v = 0;
          for (const s of ms) {
            if (s.split) {
              const d1 = ((x - s.x - s.r * 0.55) ** 2 + (y - s.y) ** 2) / (s.r * 0.7) ** 2;
              const d2 = ((x - s.x + s.r * 0.55) ** 2 + (y - s.y) ** 2) / (s.r * 0.7) ** 2;
              v += s.amp * 0.8 * (Math.exp(-d1) + Math.exp(-d2));
            } else v += s.amp * Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / s.r ** 2);
          }
          const lat = 1 - y / (ny - 1); // 北 1 南 0
          let val;
          if (kind === "pressure") val = 1012 + 14 * v + 3 * Math.sin(x / 17 + tilt);
          else if (kind === "temp") val = 22 - 34 * lat + 6 * v + 2 * Math.sin(x / 13 + tilt);
          else if (kind === "rh") val = Math.max(3, Math.min(100, 62 + 38 * v + 8 * Math.sin(x / 9 + y / 7 + tilt)));
          else val = Math.max(0, 22 * Math.max(0, v) ** 1.6 + 1.5 * Math.sin(x / 8 + y / 9 + tilt) - 1.2);
          f[y * nx + x] = val;
        }
      members.push(f);
    }
    // 候选谱 P5–P95，28 个
    const all = new Float32Array(n * M);
    members.forEach((f, m) => all.set(f, m * n));
    const sorted = Float32Array.from(all).sort();
    const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
    let lo = q(0.05),
      hi = q(0.95);
    if (hi - lo < 1e-6) hi = lo + 1;
    const nv = 28;
    const cand = Array.from({ length: nv }, (_, i) => +(lo + ((hi - lo) * i) / (nv - 1)).toFixed(3));
    // 简化描述子
    const G = [],
      C = [],
      T = [];
    const tmp = {
      nx,
      ny,
      M,
      members,
      candidates: cand,
      mean: null,
      _cache: new Map(),
    };
    const meanF = new Float32Array(n);
    for (const f of members) for (let i = 0; i < n; i++) meanF[i] += f[i] / M;
    tmp.mean = meanF;
    for (let i = 0; i < nv; i++) {
      const v = cand[i];
      let bandCells = 0;
      const p = new Float32Array(n);
      for (const f of members) for (let j = 0; j < n; j++) if (f[j] >= v) p[j] += 1 / M;
      for (let j = 0; j < n; j++) if (p[j] >= 0.25 && p[j] <= 0.75) bandCells++;
      const areas = members.map((f) => {
        let a = 0;
        for (let j = 0; j < n; j++) if (f[j] >= v) a++;
        return a;
      });
      const am = areas.reduce((s, x) => s + x, 0) / M;
      const comps = members.map((f) => countComponents(f, nx, ny, v));
      const cm = comps.reduce((s, x) => s + x, 0) / M;
      G.push(Math.sqrt(areas.reduce((s, x) => s + (x - am) ** 2, 0) / M) / (am + 50));
      C.push(bandCells);
      T.push(Math.sqrt(comps.reduce((s, x) => s + (x - cm) ** 2, 0) / M));
    }
    const z = (a) => {
      const mu = a.reduce((s, x) => s + x, 0) / a.length;
      const sd = Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length) || 1;
      return a.map((x) => +((x - mu) / sd).toFixed(4));
    };
    const zG = z(G),
      zC = z(C),
      zT = z(T);
    let score = zG.map((_, i) => (zG[i] + zC[i] + zT[i]) / 3);
    score = score.map((_, i) => 0.25 * (score[i - 1] ?? score[i]) + 0.5 * score[i] + 0.25 * (score[i + 1] ?? score[i]));
    const util = score.map((s) => +Math.exp(s).toFixed(5));
    const k = roleKey === "free" ? 7 : 6 + (seed % 3);
    const ours = greedy(util, k, 1);
    const uniform = Array.from({ length: k }, (_, i) => Math.round((i * (nv - 1)) / (k - 1)));
    const js = greedy(
      C.map((x, i) => x * (1 + 0.3 * Math.sin(i))),
      k,
      2,
    );
    const w = score.map((_, i) => 0.35 + 0.25 * Math.abs(Math.sin(i * 1.7)));
    return {
      schema: "icu-study-case/1",
      id: role.id,
      title: `演示 · ${meta.element} · +${lead}h`,
      element: meta.element,
      system: "演示",
      lead_h: lead,
      unit: meta.unit,
      nx,
      ny,
      lat: [12, 82],
      lon: [-180, -45],
      _members32: members,
      candidates: cand,
      selections: {
        ours: ours.map((i) => cand[i]),
        uniform: uniform.map((i) => cand[i]),
        js: js.map((i) => cand[i]),
      },
      scu: { mean: score.map((s) => +s.toFixed(4)), lo: score.map((s, i) => +(s - w[i]).toFixed(4)), hi: score.map((s, i) => +(s + w[i]).toFixed(4)) },
      desc: { G: zG, C: zC, T: zT },
      util,
      coast: [],
      provenance: { demo: true, note: "浏览器内合成的演示场与简化选线，不可用于正式会话" },
    };
  }
  function greedy(score, k, gap) {
    const idx = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
    const out = [];
    for (const [, i] of idx) {
      if (out.every((j) => Math.abs(j - i) > gap)) out.push(i);
      if (out.length >= k) break;
    }
    if (out.length < k) for (const [, i] of idx) if (!out.includes(i) && out.length < k) out.push(i);
    return out.sort((a, b) => a - b);
  }
  function countComponents(f, nx, ny, v) {
    const seen = new Uint8Array(nx * ny);
    let count = 0;
    const stack = [];
    for (let s = 0; s < nx * ny; s++) {
      if (seen[s] || f[s] < v) continue;
      count++;
      let size = 0;
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const i = stack.pop();
        size++;
        const x = i % nx,
          y = (i / nx) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1];
        for (const j of nb)
          if (j >= 0 && !seen[j] && f[j] >= v) {
            seen[j] = 1;
            stack.push(j);
          }
      }
      if (size < 6) count--; // 过小的碎片不计
    }
    return count;
  }
  function decodeDemo(j) {
    const c = decode(
      {
        ...j,
        members: [[0]], // 占位，下面覆盖
      },
      "demo",
    );
    // decode 会从 members 计算均值，这里直接替换
    c.members = j._members32;
    c.M = c.members.length;
    const n = c.nx * c.ny;
    const meanF = new Float32Array(n);
    for (const f of c.members) for (let i = 0; i < n; i++) meanF[i] += f[i] / c.M;
    c.mean = meanF;
    let vmin = Infinity,
      vmax = -Infinity;
    for (let i = 0; i < n; i++) {
      vmin = Math.min(vmin, meanF[i]);
      vmax = Math.max(vmax, meanF[i]);
    }
    c.meanRange = [vmin, vmax];
    c.hasGeo = false;
    return c;
  }

  /* =====================================================================
   * IndexedDB：上传的案例 JSON 存本机，刷新后仍在
   * ===================================================================== */
  const IDB = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        let req;
        try {
          req = indexedDB.open("icu-expert-study", 1);
        } catch (e) {
          rej(e);
          return;
        }
        req.onupgradeneeded = () => req.result.createObjectStore("cases", { keyPath: "id" });
        req.onsuccess = () => {
          this._db = req.result;
          res(this._db);
        };
        req.onerror = () => rej(req.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction("cases", mode);
        const st = t.objectStore("cases");
        const r = fn(st);
        t.oncomplete = () => res(r && "result" in r ? r.result : undefined);
        t.onerror = () => rej(t.error);
      });
    },
    get(id) {
      return this.tx("readonly", (s) => s.get(id)).catch(() => null);
    },
    put(rec) {
      return this.tx("readwrite", (s) => s.put(rec));
    },
    del(id) {
      return this.tx("readwrite", (s) => s.delete(id)).catch(() => null);
    },
  };

  /* =====================================================================
   * 管理器
   * ===================================================================== */
  const Cases = {
    ROLES,
    ROLE_BY_ID,
    ROLE_BY_KEY,
    METHODS,
    state: {}, // roleKey -> {status, source, case, error, file, bytes}
    listeners: new Set(),
    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    },
    emit() {
      for (const fn of this.listeners) fn();
    },
    get(roleKey) {
      const s = this.state[roleKey];
      return s && s.case ? s.case : null;
    },
    ready() {
      return ROLES.every((r) => this.state[r.key] && this.state[r.key].case);
    },
    allReal() {
      return ROLES.every((r) => this.state[r.key] && this.state[r.key].source !== "demo" && this.state[r.key].case);
    },
    async init() {
      for (const r of ROLES) this.state[r.key] = { status: "loading" };
      this.emit();
      await Promise.all(ROLES.map((r) => this.loadRole(r.key)));
    },
    async loadRole(roleKey) {
      const role = ROLE_BY_KEY[roleKey];
      // 1) 本机上传
      try {
        const rec = await IDB.get(role.id);
        if (rec && rec.text) {
          const j = JSON.parse(rec.text);
          const errs = validate(j);
          if (!errs.length) {
            this.state[roleKey] = { status: "ok", source: "upload", case: decode(j, "upload"), file: rec.name, bytes: rec.text.length, addedAt: rec.addedAt };
            this.emit();
            return;
          }
        }
      } catch (_) {
        /* 忽略，退到下一级 */
      }
      // 2) 随页面发布的流水线导出
      try {
        const resp = await fetch(`cases/${role.id}.json`, { cache: "no-cache" });
        if (resp.ok) {
          const text = await resp.text();
          const j = JSON.parse(text);
          const errs = validate(j);
          if (!errs.length) {
            this.state[roleKey] = { status: "ok", source: "pipeline", case: decode(j, "pipeline"), file: `cases/${role.id}.json`, bytes: text.length };
            this.emit();
            return;
          }
          this.state[roleKey] = { status: "error", error: errs.join("；") };
        }
      } catch (_) {
        /* 本地 file:// 打开时 fetch 会失败，退到演示 */
      }
      // 3) 演示
      await new Promise((r) => setTimeout(r, 0));
      const demo = decodeDemo(makeDemo(roleKey));
      const prevErr = this.state[roleKey] && this.state[roleKey].error;
      this.state[roleKey] = { status: "demo", source: "demo", case: demo, error: prevErr || null };
      this.emit();
    },
    /** 上传：返回 [{name, ok, msg}] */
    async upload(files) {
      const out = [];
      for (const file of files) {
        let text, j;
        try {
          text = await ICU.readFileText(file);
          j = JSON.parse(text);
        } catch (e) {
          out.push({ name: file.name, ok: false, msg: "不是合法的 JSON" });
          continue;
        }
        const role = ROLE_BY_ID[j.id];
        if (!role) {
          out.push({ name: file.name, ok: false, msg: `id「${j.id}」不属于 6 个角色（应为 ${ROLES.map((r) => r.id).join(" / ")}）` });
          continue;
        }
        const errs = validate(j);
        if (errs.length) {
          out.push({ name: file.name, ok: false, msg: errs.slice(0, 4).join("；") + (errs.length > 4 ? ` 等 ${errs.length} 项` : "") });
          continue;
        }
        try {
          await IDB.put({ id: j.id, text, name: file.name, addedAt: Date.now() });
        } catch (e) {
          out.push({ name: file.name, ok: false, msg: "写入本机数据库失败（浏览器可能禁止了存储）" });
          continue;
        }
        this.state[role.key] = { status: "ok", source: "upload", case: decode(j, "upload"), file: file.name, bytes: text.length, addedAt: Date.now() };
        out.push({ name: file.name, ok: true, msg: `已载入为「${role.key === "free" ? "凭经验选线" : role.key === "train" ? "读图训练" : role.key}」` });
        this.emit();
      }
      return out;
    },
    async removeUpload(roleKey) {
      const role = ROLE_BY_KEY[roleKey];
      await IDB.del(role.id);
      this.state[roleKey] = { status: "loading" };
      this.emit();
      await this.loadRole(roleKey);
    },
  };

  Object.assign(ICU, {
    Cases,
    Geo: { level, bandNear, gridToLatLon, sampleMean, marchingSquares, cellKm },
  });
})();
