// Loopback-only production UI capture with fictional documents and fixture answers.
// Supply INKSTONE_QA_PLAYWRIGHT if playwright-core is installed outside this repo.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { installV07Fixture } from "../../../scripts/testing/v07-fixture.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.INKSTONE_QA_PLAYWRIGHT || "playwright-core");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = resolve(root, "docs/assets/launch-v0.7");
const privateOut = resolve(root, "artifacts/github-readiness-2026-11-07/media");
await mkdir(out, { recursive: true });
await mkdir(privateOut, { recursive: true });
const url = new URL(process.env.INKSTONE_QA_URL || "http://127.0.0.1:1432/");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.INKSTONE_QA_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript("if(window===window.top){(" + installV07Fixture.toString() + ")()}");
const page = await context.newPage(), errors = [], external = [], steps = [];
page.setDefaultTimeout(15000);
page.on("pageerror", e => errors.push(e.message));
await page.route("**/*", route => {
  const u = new URL(route.request().url());
  if (u.origin === url.origin || ["data:", "blob:"].includes(u.protocol)) return route.continue();
  external.push(u.origin); return route.abort();
});
async function capture(name, note) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  await page.screenshot({ path: resolve(out, name + ".png") });
  await writeFile(resolve(privateOut, name + ".txt"), await page.locator("body").innerText());
  steps.push({ name, note, source: "production React UI + synthetic IPC; no live model", image: name + ".png" });
}
try {
  await page.goto(url.href, { waitUntil: "networkidle" });
  const sample = await readFile(resolve(root, "examples/v0.7/阅读活动方案.md"), "utf8");
  // A shorter chart-first view of the same fictional plan, through real Markdown rendering.
  const chart = sample.slice(sample.indexOf("## 人数对比"), sample.indexOf("## 下一步"));
  await page.evaluate(content => {
    const k = "inkstone-v07-ui-qa-store", s = JSON.parse(localStorage.getItem(k));
    s.files[s.documents[0].path].content = content; localStorage.setItem(k, JSON.stringify(s));
  }, "# 阅读活动：人数对比\n\n虚构示例：甲方案 120 人，乙方案 80 人；满意度资料尚缺。\n\n" + chart);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "阅读活动：人数对比", exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑图表", exact: true }).waitFor();
  await capture("01-editor", "Inline chart, real document toolbar and managed-space navigation");
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await page.getByLabel("向当前空间提问").fill("比较两种阅读活动的参与人数");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page.getByRole("heading", { name: "甲方案参与人数较多", exact: true }).waitFor();
  await page.locator(".assistant-turn").first().getByText(/^回答候选/).waitFor();
  await page.getByRole("button", { name: "展开问答", exact: true }).click();
  await page.locator(".assistant-timeline").evaluate(el => { el.scrollTop = 0; });
  await capture("02-conversation", "Persistent answer and source entry; response is simulated");
  await page.locator(".assistant-evidence summary").click();
  await page.locator(".assistant-evidence button").first().click();
  await page.getByRole("dialog", { name: "本轮来源预览" }).waitFor();
  await capture("03-source", "Open the source snapshot belonging to this answer candidate");
  await page.getByRole("button", { name: "回到会话", exact: true }).click();
  await page.getByLabel("向当前空间提问").fill("哪个方案的满意度更高？");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page.getByRole("heading", { name: "资料不足以判断满意度", exact: true }).waitFor();
  await page.locator(".assistant-turn").last().getByText(/^回答候选/).waitFor();
  const latest = page.getByRole("button", { name: "回到最新回答", exact: true });
  if (await latest.isVisible()) await latest.click();
  await page.getByRole("heading", { name: "资料不足以判断满意度", exact: true }).scrollIntoViewIfNeeded();
  await capture("04-missing-information", "Simulated refusal for an attribute absent from the fictional sources");
  await page.getByRole("button", { name: "同伴设置", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "更换角色", exact: true }).click();
  await page.locator(".companion-character-grid").waitFor();
  await capture("05-companions", "Optional production character picker; static candidate artwork");
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.deepEqual(await page.evaluate(() => window.__INKSTONE_QA_UNKNOWN__), []);
  await writeFile(resolve(privateOut, "validation.json"), JSON.stringify({ steps, errors, external, modelRequests: 0, nativeUi: "not-run" }, null, 2));
  console.log(JSON.stringify({ captured: steps.length, errors, external, modelRequests: 0 }));
} catch (e) {
  await page.screenshot({ path: resolve(privateOut, "rejected-capture.png") });
  await writeFile(resolve(privateOut, "failure.txt"), String(e) + "\n" + await page.locator("body").innerText());
  throw e;
} finally { await browser.close(); }
