/** Production frontend presentation QA with isolated synthetic IPC only.
 * Run a local Vite server first. No production backend, credentials or API calls.
 * INKSTONE_QA_PLAYWRIGHT points to an installed playwright-core module. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { installV07Fixture } from "./testing/v07-fixture.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.INKSTONE_QA_PLAYWRIGHT || "playwright-core",
);
const url = new URL(process.env.INKSTONE_QA_URL || "http://127.0.0.1:1420/");
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
  "QA is loopback-only",
);
const out = resolve(
  process.env.INKSTONE_QA_OUT || "artifacts/v0.7.0-rc.1-development/browser",
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.INKSTONE_QA_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
await context.addInitScript(
  "if(window===window.top){(" + installV07Fixture.toString() + ")()}",
);
const page = await context.newPage(),
  errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (route) => {
  const request = new URL(route.request().url());
  if (
    request.origin === url.origin ||
    ["data:", "blob:"].includes(request.protocol)
  )
    return route.continue();
  external.push(request.origin);
  return route.abort();
});
const checks = [];
async function shot(name) {
  await page.screenshot({ path: resolve(out, name + ".png") });
}
try {
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await page.getByLabel("向当前空间提问").fill("比较两种阅读活动的参与人数");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page
    .getByRole("heading", { name: "甲方案参与人数较多", exact: true })
    .waitFor();
  await page
    .locator(".assistant-turn")
    .first()
    .getByText(/^回答候选/)
    .waitFor();
  assert.equal(await page.locator(".assistant-turn").count(), 1);
  checks.push("real App renders a persistent first turn through synthetic IPC");
  await page.getByRole("button", { name: "展开问答", exact: true }).click();
  await page.locator(".assistant-timeline").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForFunction(
    () => document.querySelector(".assistant-timeline")?.scrollTop === 0,
  );
  await shot("01-chat-workspace");
  await page.locator(".assistant-evidence summary").click();
  await page.locator(".assistant-evidence button").first().click();
  await page.getByRole("dialog", { name: "本轮来源预览" }).waitFor();
  await shot("02-source-preview");
  await page.getByRole("button", { name: "回到会话", exact: true }).click();
  checks.push("candidate-owned evidence preview");
  await page.getByLabel("向当前空间提问").fill("那哪个满意度更高？");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page
    .getByRole("heading", { name: "资料不足以判断满意度", exact: true })
    .waitFor();
  assert.equal(await page.locator(".assistant-turn").count(), 2);
  checks.push("multi-turn refusal preserves prior answer");
  await shot("03-multiple-turns");
  await page.locator(".assistant-manage summary").click();
  await page.getByRole("button", { name: "重命名会话", exact: true }).click();
  await page.getByLabel("会话标题").fill("阅读活动比较 · QA合成");
  await page.getByRole("button", { name: "保存标题", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await page.getByText("阅读活动比较 · QA合成", { exact: true }).waitFor();
  assert.equal(await page.locator(".assistant-turn").count(), 2);
  checks.push("reload restores renamed conversation and all turns");
  await page.getByLabel("向当前空间提问").fill("请再次比较人数");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await page.getByText(/^已停止 · 当前选择/).waitFor();
  checks.push("stop retains a stopped candidate");
  await page
    .locator(".assistant-turn")
    .last()
    .getByRole("button", { name: "重新生成", exact: true })
    .click();
  await page.getByLabel("向当前空间提问").fill("尚未发送的下一问");
  await page
    .locator(".assistant-turn")
    .last()
    .getByText(/^回答候选/)
    .waitFor();
  assert.equal(
    await page.getByLabel("向当前空间提问").inputValue(),
    "尚未发送的下一问",
  );
  checks.push("regeneration preserves composer draft");
  await page.getByRole("button", { name: "同伴设置", exact: true }).click();
  await page.getByRole("button", { name: "更换角色", exact: true }).click();
  await page
    .locator(".companion-choose")
    .waitFor({ timeout: 3000 })
    .catch(() => {});
  await shot("04-character-picker");
  await page.getByRole("button", { name: "关闭同伴面板", exact: true }).click();
  // Each screenshot owns a fresh browser context at its final dimensions.
  // Resizing one rendered Chrome surface can retain stale compositor tiles.
  const fixtureState = await context.storageState();
  const layouts = [];
  for (const expanded of [false, true]) {
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [960, 640],
    ]) {
      const freshContext = await browser.newContext({
        viewport: { width, height },
        reducedMotion: "reduce",
        storageState: fixtureState,
      });
      try {
        await freshContext.addInitScript(
          "if(window===window.top){(" + installV07Fixture.toString() + ")()}",
        );
        const fresh = await freshContext.newPage();
        fresh.on("pageerror", (e) => errors.push(e.message));
        await fresh.route("**/*", (route) => {
          const request = new URL(route.request().url());
          if (
            request.origin === url.origin ||
            ["data:", "blob:"].includes(request.protocol)
          )
            return route.continue();
          external.push(request.origin);
          return route.abort();
        });
        await fresh.goto(url.href, { waitUntil: "networkidle" });
        await fresh.getByRole("button", { name: "问答", exact: true }).click();
        await fresh
          .getByText("阅读活动比较 · QA合成", { exact: true })
          .waitFor();
        await fresh.locator(".assistant-turn").first().waitFor();
        if (expanded && width > 1100)
          await fresh
            .getByRole("button", { name: "展开问答", exact: true })
            .click();
        await fresh.locator(".assistant-timeline").evaluate((el) => {
          el.scrollTop = 0;
        });
        await fresh.waitForFunction(
          () => document.querySelector(".assistant-timeline")?.scrollTop === 0,
        );
        const measure = await fresh.evaluate(() => ({
          bodyWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          composerBottom: document
            .querySelector(".ask-form")
            ?.getBoundingClientRect().bottom,
          knowledgeWidth: document
            .querySelector(".knowledge-panel")
            ?.getBoundingClientRect().width,
          answerViewportHeight: document
            .querySelector(".assistant-timeline")
            ?.getBoundingClientRect().height,
          titlebarCount: document.querySelectorAll(".titlebar").length,
        }));
        assert(
          measure.bodyWidth <= width + 1,
          "horizontal overflow at " + width,
        );
        assert(measure.composerBottom <= height + 1, "composer below viewport");
        assert(
          measure.answerViewportHeight >= 150,
          "answer viewport too short at " + width,
        );
        assert.equal(measure.titlebarCount, 1, "one live app header");
        layouts.push({
          mode:
            width <= 1100 ? "task-two-pane" : expanded ? "expanded" : "sidebar",
          width,
          height,
          ...measure,
        });
        await fresh.screenshot({
          path: resolve(
            out,
            `05-${expanded ? "expanded" : "sidebar"}-${width}.png`,
          ),
        });
      } finally {
        await freshContext.close();
      }
    }
  }
  checks.push(
    "sidebar and expanded: 1440/1280/960 bounds, send visible and answer viewport at least 150px",
  );
  const state = await page.evaluate(() => ({
    calls: window.__INKSTONE_QA_CALLS__,
    unknown: window.__INKSTONE_QA_UNKNOWN__,
    fixture: window.__INKSTONE_QA_FIXTURE__,
  }));
  assert(state.fixture);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    scope:
      "production React App with isolated synthetic IPC; not native/backend/provider acceptance",
    checks,
    layouts,
    viewportMethod:
      "fresh isolated context and page at each final viewport; no rendered-page resize",
    pageErrors: errors,
    externalNetworkOrigins: external,
    unknownFixtureCommands: [...new Set(state.unknown)],
    modelHttpRequests: 0,
    notRun: [
      "native WebKit",
      "Rust transactions through IPC",
      "real provider streaming",
      "IME candidate commit",
      "VoiceOver",
    ],
  };
  await writeFile(
    resolve(out, "validation.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} catch (error) {
  await shot("failure");
  await writeFile(
    resolve(out, "failure.json"),
    JSON.stringify({ error: String(error), errors, external }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
