/* 配法（设计文档第 7 节）、环节定义、问卷与访谈文字。 */
(function () {
  "use strict";
  const ICU = window.ICU;
  const { mulberry32, shuffle } = ICU;

  const METHOD_LABEL = { ours: "本文方法", uniform: "均匀间隔", js: "JS 散度法" };
  const METHOD_SHORT = { ours: "本文", uniform: "均匀", js: "JS" };

  /* 画法分配：4 人一轮，模板 A 在序号 0–3 上循环移位（每个案例配到本文 2 次、另两种各 1 次）。
   * 模板 B 是原 8 人方案的后半轮，现不再使用，保留备查。 */
  const ROUND = 4;
  const TEMPLATE_A = ["ours", "uniform", "js", "ours"];
  const TEMPLATE_B = ["ours", "js", "uniform", "ours"];
  /* 4×4 Williams 拉丁方（每张图在每个位置各一次，前后相邻关系平衡） */
  const WILLIAMS = [
    ["C1", "C2", "C4", "C3"],
    ["C2", "C3", "C1", "C4"],
    ["C3", "C4", "C2", "C1"],
    ["C4", "C1", "C3", "C2"],
  ];
  const FIND_CASES = ["C1", "C2", "C3", "C4"];
  const ATTR_CASES = ["C1", "C2", "C4"]; // 气压 / 温度 / 湿度
  /* 归因题问哪一条线：在本文方法选出的线里，找目标来源最突出的那条，让三道题的答案不全一样。
   * C1、C4 取“分块个数不同”（T）最突出的线，C2 取“边界模糊”（C）最突出的线；找不到就退回效用最高的线。 */
  const ATTR_TARGET = { C1: "T", C2: "C", C4: "T" };
  /* 读图训练的三个示例（练习图 = EC 海平面气压 +6h，均匀间隔的线）：网格坐标 + 所在候选下标 */
  const TRAIN_EXAMPLES = {
    msl_fh006_na: [
      { idx: 13, x: 169, y: 105, type: "位置不一致", text: "成员的线形状差不多，但整体错开，排成一束平行的线。" },
      { idx: 13, x: 115, y: 118, type: "边界宽窄不一", text: "成员线散成一条较宽的带子，说不清边界在哪。" },
      { idx: 6, x: 230, y: 41, type: "分块个数不同", text: "平均线在这里围出一个小圈，但只有一部分成员闭合出来。" },
    ],
  };
  /* 盲化编号字母：去掉 C、P（和案例名、专家编号混淆），也去掉 I、O（和 1、0 混淆） */
  const CODE_LETTERS = "ABDEFGHJKLMNQRSTUVWXYZ";

  function assignFor(seq) {
    const shift = ((seq % ROUND) + ROUND) % ROUND;
    const tpl = TEMPLATE_A;
    const a = {};
    FIND_CASES.forEach((c, i) => (a[c] = tpl[(i + shift) % 4]));
    return a;
  }

  function makePlan(seq, opts = {}) {
    const assign = assignFor(seq);
    let order = WILLIAMS[((seq % 4) + 4) % 4].slice();
    if (opts.dropC3) order = order.filter((c) => c !== "C3");
    const rng = mulberry32(0x9e3779b1 ^ (seq * 2654435761));
    // 7 个互不相同的编号：4 张找分歧 + 3 张盲对比
    const used = new Set();
    const draw = () => {
      for (;;) {
        const code = CODE_LETTERS[Math.floor(rng() * CODE_LETTERS.length)] + (2 + Math.floor(rng() * 8));
        if (!used.has(code) && !used.has(code[0])) {
          used.add(code);
          used.add(code[0]); // 字母也不重复，口头说"K 那张"不会混
          return code;
        }
      }
    };
    const codes = {};
    for (const c of FIND_CASES) codes[c] = draw();
    const blindOrder = shuffle(["ours", "uniform", "js"], rng);
    const blindCodes = {};
    for (const m of blindOrder) blindCodes[m] = draw();
    return { seq, assign, order, codes, blindOrder, blindCodes };
  }

  /* =====================================================================
   * 环节
   * ===================================================================== */
  const STAGES = [
    { key: "intro", group: "开场", title: "开场", mins: 3, back: true },
    { key: "free", group: "凭经验选线", title: "凭经验选线", mins: 5, back: true },
    { key: "train", group: "读图训练", title: "读图训练", mins: 5, back: true },
    { key: "find", group: "找分歧", title: "找分歧", mins: 10, back: false, multi: true },
    { key: "attr", group: "读归因条", title: "读归因条", mins: 6, back: true, multi: true },
    { key: "blind", group: "三张图对比", title: "三张图对比", mins: 3, back: true },
    // 揭晓：所有需要盲的判断都已做完，之后的选线对照、问卷、访谈要知道在评价哪一种；不能再返回改盲对比
    { key: "unblind", group: "揭晓", title: "揭晓", mins: 1, back: false },
    { key: "reveal", group: "选线对照", title: "选线对照", mins: 5, back: true },
    { key: "survey", group: "问卷", title: "总体问卷", mins: 7, back: true },
    { key: "interview", group: "访谈", title: "访谈", mins: 10, back: true },
    { key: "done", group: "完成", title: "完成", mins: 0, back: false },
  ];
  const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

  /** 一个会话实际要走的步骤序列 [{key, sub}] */
  function stepsFor(session) {
    const out = [];
    for (const s of STAGES) {
      if (s.key === "reveal" && session.opts && session.opts.skipReveal) continue;
      if (s.key === "find") session.plan.order.forEach((_, i) => out.push({ key: "find", sub: i }));
      else if (s.key === "attr") ATTR_CASES.forEach((_, i) => out.push({ key: "attr", sub: i }));
      else out.push({ key: s.key, sub: 0 });
    }
    return out;
  }

  /* =====================================================================
   * 文字
   * ===================================================================== */
  const Content = {
    introText:
      "接下来约一小时，请您看几组集合预报的等值线图：先凭经验挑几条线，再在图上找成员之间的分歧、读一种辅助条，最后填问卷、聊一聊。这里没有标准答案，我们想知道的就是您的判断。",
    consent: [
      { key: "record", text: "同意全程录音录屏，仅用于研究分析" },
      { key: "anon", text: "知道论文中完全匿名（以 P1、P2… 代称）" },
      { key: "quit", text: "知道可以随时中止，无需说明理由" },
    ],
    bg: [
      {
        key: "role",
        q: "岗位",
        opts: ["国家级预报员", "省级预报员", "市级预报员", "高校 / 科研院所", "其他"],
        other: "其他",
      },
      { key: "years", q: "从事预报或相关研究的年限", type: "number", suffix: "年" },
      { key: "freq", q: "使用集合预报产品的频率", opts: ["每天", "每周", "偶尔", "从不"] },
      { key: "spaghetti", q: "对 spaghetti 图（面条图）", opts: ["业务常用", "见过", "不熟悉"] },
      {
        key: "interval",
        q: "平时画等值线，间隔主要怎么定",
        opts: ["业务规范固定值", "凭经验", "软件默认", "其他"],
        other: "其他",
      },
      { key: "color", q: "色觉", opts: ["正常", "有色觉异常", "不确定"] },
    ],
    freeInstruction: (k) =>
      `假设只能画 ${k} 条等值线，目的是让看图的人看出各成员预报哪里不一致，您会选哪几个值？请边选边说理由。`,
    findInstruction: "请在图上点出成员之间明显有分歧的地方——每处点一下。点完可以在右侧给每处选一个类型。",
    q1: "看这张图，我觉得各成员的预报基本一致。",
    q2: "如果您觉得这张图漏了什么，用一句话写下漏在哪个位置、哪种分歧。（可跳过）",
    markTypes: ["位置不一致", "边界宽窄不一", "分块个数不同", "其他"],
    attrChoices: [
      { key: "G", label: "位置摆动", hint: "同一条线整体平移" },
      { key: "C", label: "边界模糊", hint: "成员线散成宽带" },
      { key: "T", label: "分块个数不同", hint: "围出的区域块数不一致" },
      { key: "U", label: "说不清", hint: "" },
    ],
    attrQ1: "看归因条，这条线上的分歧主要来自哪一种？",
    attrQ2: "再看地图，归因条说的和我在图上看到的一致。",
    attrQ3: "不一致时，您觉得实际是什么？（主持人逐字记录）",
    blindR1: "若只能选一种用于日常会商，您选哪张？为什么？",
    blindR2a: "哪张最能看出成员之间的分歧？",
    blindR2b: "哪张最好读？",
    unblindIntro: "前面需要您“不知情”判断的部分已经全部做完了。下面告诉您刚才几张图分别是用哪种方式选的线，接下来的对照、问卷和访谈会用到。",
    methodPublic: {
      ours: { name: "系统选线", text: "本研究的方法：估计每个数值上成员分歧有多大、有多可靠，挑出最值得看、彼此又不重复的线。" },
      uniform: { name: "等间隔", text: "从低到高等距取值，是业务上最常用的画法。" },
      js: { name: "另一种自动选线", text: "已发表的另一种自动选值方法，按等值线分布的差异来挑选有代表性的线。" },
    },
    revealQs: [
      "系统选的线里，哪些您认可、哪些您不会画？",
      "您选了而系统没选的线，重要在哪？",
      "系统有没有找到您漏掉的分歧？",
    ],
    surveyIntro: "所有评分均为 7 点：1 = 完全不同意，7 = 完全同意。没看到对应内容或不好判断，请选 NA，不要勉强打分。",
    survey: [
      { group: "选线", items: [
        { key: "S1", text: "和等间隔画法相比，系统把线画在了更值得看的地方。" },
        { key: "S2", text: "线集中画在分歧区带来的重叠，对我来说是可以接受的代价。" },
        { key: "S3", text: "系统选出的线里，有我自己选线时没有注意到的分歧。" },
        { key: "S4", text: "系统选的线里，有一些在我看来并不值得画。", reverse: true },
      ] },
      { group: "归因", items: [
        { key: "A1", text: "归因条帮助我理解成员分歧是怎么产生的。" },
        { key: "A2", text: "归因条给出的来源，有时和我在地图上看到的不一致。", reverse: true },
        { key: "A3", text: "在湿度场上，归因条给出的来源和温度、气压场一样清楚。" },
      ] },
      { group: "价值", items: [
        { key: "V1", text: "这个工具能让我注意到用现在的画法会漏掉的分歧。", dim: "Insight" },
        { key: "V2", text: "找到“哪几条等值线最值得看”比我现在的做法更快。", dim: "Time" },
        { key: "V3", text: "我能很快得到这个场整体不确定性的印象。", dim: "Essence" },
        { key: "V4", text: "我愿意在实际会商或简报中引用这个系统的选线结果。", dim: "Confidence" },
      ] },
    ],
    interview: [
      { q: "您平时画集合预报的等值线，是怎么决定画哪些值的？有没有遇到过“画的线没反映出成员分歧”的情况？" },
      { q: "刚才几张图里，有没有哪张让您觉得“这张漏了东西”或者“这张太乱没法用”？", follow: "追问：线集中在分歧区导致更挤，这个代价值不值？什么情况下值？" },
      { q: "您自己选线和系统选线的差别，您怎么看？系统哪里选得比您好，哪里不如您？" },
      { q: "归因条说“这里是分块个数不同”的时候，您在地图上看到的是不是这样？有没有觉得它说错的地方？" },
      { q: "如果放进您单位的业务系统，最大的障碍是什么？" },
      { q: "还有什么我们没问到、但您觉得重要的？" },
    ],
    readCard: [
      { sym: "thin", title: "细线", text: "一个集合成员的这条等值线" },
      { sym: "thick", title: "粗线", text: "集合平均场的这条等值线，只作参照；有没有分歧要看细线" },
      { sym: "gray", title: "灰底", text: "集合平均场，越深数值越高" },
      { sym: "spread", title: "细线散开", text: "成员之间不一致，散得越开越不确定" },
      { sym: "band", title: "浅色带", text: "一半左右的成员认为“超过这个值”的区域，即分歧所在" },
    ],
    terms: [
      { key: "G", name: "位置摆动", text: "同一条线在各成员里整体平移" },
      { key: "C", name: "边界模糊", text: "成员线散成一条宽带，边界说不准" },
      { key: "T", name: "分块个数不同", text: "同一个值围出的区域，有的成员是一块，有的分成两块或没有" },
    ],
  };

  const SURVEY_KEYS = Content.survey.flatMap((g) => g.items.map((i) => i.key));

  Object.assign(ICU, {
    Plan: {
      METHOD_LABEL,
      METHOD_SHORT,
      TEMPLATE_A,
      TEMPLATE_B,
      ROUND,
      WILLIAMS,
      FIND_CASES,
      ATTR_CASES,
      ATTR_TARGET,
      TRAIN_EXAMPLES,
      assignFor,
      makePlan,
      STAGES,
      STAGE_BY_KEY,
      stepsFor,
      SURVEY_KEYS,
    },
    Content,
  });
})();
