// 端到端走查：先 python serve.py --no-browser，再在 tests/ 下 npm install && node study_walk.mjs <截图目录>
import { chromium } from "playwright";

const OUT = process.argv[2] || ".";
const URL = "http://127.0.0.1:8765/";
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
const shot = (name, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const wait = (ms) => page.waitForTimeout(ms);
const log = (...a) => console.log(...a);

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".hz-top", { timeout: 90000 });
await wait(800);
await shot("01_host_new", true);

await page.click(".tab >> text=案例数据");
await wait(1200);
await shot("02_host_cases", true);

// 参照标注：每个案例标 3 处
await page.click(".tab >> text=参照标注");
await wait(1000);
for (const ck of ["C1", "C2", "C3", "C4"]) {
  await page.click(`.cases-seg .seg[data-v="${ck}"]`);
  await wait(700);
  const box = await page.locator(".work-map .map-cv.over").boundingBox();
  for (let i = 0; i < 3; i++) {
    await page.locator("#ref-slider").fill(String(8 + i * 5));
    await wait(250);
    await page.mouse.click(box.x + box.width * (0.25 + 0.22 * i), box.y + box.height * (0.35 + 0.1 * i));
    await wait(200);
  }
}
await shot("03_host_ref");

// 新会话
await page.click(".tab >> text=新会话");
await wait(500);
await page.click("#btn-start");
await page.waitForSelector(".xz-top");
await wait(500);
// 开场
for (const k of ["record", "anon", "quit"]) await page.check(`#consent-${k}`);
const segClick = async (qIdx, label) => page.locator(".intro-right .qblock").nth(qIdx).locator(`.seg >> text=${label}`).first().click();
await segClick(0, "省级预报员");
await page.fill("#bg-years", "12");
await segClick(2, "每天");
await segClick(3, "业务常用");
await segClick(4, "凭经验");
await segClick(5, "正常");
await shot("10_intro");
await page.click("#btn-next");
await wait(1200);
// 凭经验选线
const cands = page.locator(".cand");
const n = await cands.count();
const k = parseInt((await page.locator(".counter").innerText()).split("/")[1], 10);
log("free k =", k, "cands", n);
for (let i = 0; i < k; i++) await cands.nth(4 + i * 2).click();
await page.fill("#free-reason", "低压外围成员最可能散开。");
await wait(500);
await shot("11_free");
await page.click("#btn-next");
await wait(1500);
await shot("12_train");
await page.click("#btn-next");
await wait(1500);

// 找分歧
for (let f = 0; f < 4; f++) {
  const box = await page.locator(".work-map .map-cv.over").boundingBox();
  for (let i = 0; i < 3; i++) await page.mouse.click(box.x + box.width * (0.3 + 0.18 * i), box.y + box.height * (0.4 + 0.08 * i));
  await page.locator(".mk").first().locator(".seg").nth(2).click();
  await page.locator(".likert .lk").nth(2 + f).click();
  if (f === 0) {
    await wait(400);
    await shot("13_find1");
  }
  await page.click("#btn-next");
  await page.waitForSelector(".scrim");
  await page.locator(".scrim .btn.primary").click();
  await wait(1400);
}
// 归因
for (let a = 0; a < 3; a++) {
  await page.locator(".segs.stack .seg").nth(a % 3).click();
  await page.locator(".likert .lk").nth(4).click();
  await page.fill(`#attr-text-${a}`, "锋区南北摆动");
  if (a === 0) await shot("14_attr1");
  if (a === 2) await shot("15_attr3_rh");
  await page.click("#btn-next");
  await wait(1300);
}
// 盲对比
await wait(800);
await shot("16_blind");
const blindSegs = page.locator(".segs.wide");
await blindSegs.nth(0).locator(".seg").nth(1).click();
await blindSegs.nth(1).locator(".seg").nth(0).click();
await blindSegs.nth(2).locator(".seg").nth(2).click();
await page.click("#btn-next");
await wait(1500);
await shot("17_reveal", true);

// 中途刷新：应回到同一环节
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".xz-top", { timeout: 90000 });
await wait(1200);
log("after reload stage head:", await page.locator(".stage-head h1").first().innerText());
await page.click("#btn-next");
await wait(800);
// 问卷
const lks = page.locator(".sv-item");
const ni = await lks.count();
for (let i = 0; i < ni; i++) await lks.nth(i).locator(".lk").nth(i % 8).click();
await shot("18_survey");
await page.click("#btn-next");
await wait(600);
await page.fill("#iv-q1", "按业务规范 4 hPa 间隔。");
await shot("19_interview");
// 侧栏
await page.keyboard.press("Control+Shift+M");
await wait(400);
await shot("20_drawer");
await page.keyboard.press("Control+Shift+M");
await page.click("#btn-next");
await wait(600);
await shot("21_done");
await page.click(".done-page .btn");
await page.waitForSelector(".scrim");
await page.check(".scrim input[type=checkbox]");
await page.locator(".scrim .btn.primary").click();
await wait(1200);
await page.click(".tab >> text=结果与导出");
await wait(800);
await shot("22_results", true);

// 窄屏
await page.setViewportSize({ width: 420, height: 900 });
await wait(600);
await shot("23_narrow_results");

log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
