/** Production React flows with fictional documents and synthetic IPC. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installV07Fixture } from "./testing/v07-fixture.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.INKSTONE_QA_PLAYWRIGHT || "playwright-core",
);
const url = new URL(process.env.INKSTONE_QA_URL || "http://127.0.0.1:1420/");
assert(["127.0.0.1", "localhost"].includes(url.hostname));
const out = resolve(
  process.env.INKSTONE_QA_OUT ||
    "artifacts/v0.7.8-development/browser-first-use",
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.INKSTONE_QA_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const checks = [];
const external = [];
const pageErrors = [];
const firstTitle = "阅读活动方案.md";

async function scenario(options, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    `if(window===window.top) (${installV07Fixture})(${JSON.stringify(options)})`,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const request = new URL(route.request().url());
    if (
      request.origin === url.origin ||
      ["blob:", "data:"].includes(request.protocol)
    )
      return route.continue();
    external.push(request.origin);
    return route.abort();
  });
  await page.goto(url.href, { waitUntil: "networkidle" });
  return page;
}

try {
  const page = await scenario({ clean: true }, { width: 960, height: 640 });
  const guide = page.getByRole("region", { name: "开始使用" });
  await guide
    .getByRole("button", { name: "复制导入文档", exact: true })
    .click();
  const importDialog = page.getByRole("dialog", { name: "导入本地文档" });
  await importDialog
    .getByRole("button", { name: "选择文件（可多选）" })
    .click();
  await importDialog
    .getByRole("button", { name: "复制导入", exact: true })
    .click();
  await importDialog.getByText(/成功 1/).waitFor();
  await importDialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: firstTitle, exact: true }).waitFor();
  checks.push(
    "clean browser profile copies the first document into the managed space",
  );

  await page.getByRole("button", { name: "AI 问答", exact: true }).click();
  await page.getByRole("button", { name: "添加资料", exact: true }).click();
  await page
    .getByRole("combobox", { name: "知识空间" })
    .selectOption("qa-space");
  await page.getByRole("checkbox", { name: firstTitle, exact: true }).check();
  await page.getByRole("button", { name: "完成选择", exact: true }).click();
  await page.getByRole("checkbox", { name: "本轮不搜索网页" }).check();
  await page.getByLabel("向 AI 提问").fill("比较两种阅读活动的参与人数");
  await page.getByRole("button", { name: "发送问题" }).click();
  await page.getByRole("heading", { name: "甲方案参与人数较多" }).waitFor();
  await page
    .getByRole("button", { name: "停止生成", exact: true })
    .waitFor({ state: "hidden" });
  const ask = await page.evaluate(
    () =>
      window.__INKSTONE_QA_CALLS__.find(
        (row) => row.command === "assistant_ask",
      )?.args,
  );
  assert.equal(ask.webAccess, "local-only");
  assert.deepEqual(ask.sources.documentIds, ["doc-1"]);
  await page.getByTitle(/查看来源 1：阅读活动方案/).click();
  await page
    .getByRole("dialog", { name: "查看来源" })
    .getByRole("button", { name: "打开文档" })
    .click();
  await page
    .getByRole("dialog", { name: "查看来源" })
    .waitFor({ state: "hidden" });
  assert(
    await page.evaluate(() =>
      window.__INKSTONE_QA_CALLS__.some(
        (row) =>
          row.command === "read_file" &&
          row.args.path.endsWith("/阅读活动方案.md"),
      ),
    ),
  );
  checks.push(
    "independent first answer keeps explicit document and local-only scope and opens its original citation",
  );

  await page.getByRole("button", { name: "知识 Wiki", exact: true }).click();
  const wiki = page.getByRole("dialog", { name: "知识 Wiki" });
  await wiki.getByRole("button", { name: "选择整理范围", exact: true }).click();
  await wiki.getByRole("checkbox", { name: "启用当前空间的 Wiki" }).check();
  await wiki.getByLabel("关注主题").fill("北岸阅读活动");
  await wiki.getByRole("checkbox", { name: firstTitle, exact: true }).check();
  await wiki.getByRole("button", { name: "保存范围与维护" }).click();
  await wiki.getByRole("button", { name: "整理所选资料" }).click();
  await wiki.getByRole("button", { name: "查看待审阅改动" }).click();
  await wiki.getByRole("button", { name: "发布改动" }).click();
  await wiki
    .locator("summary")
    .filter({ hasText: /原文位置/ })
    .click();
  await wiki
    .getByRole("button", { name: /阅读活动方案\.md\s*第/ })
    .click();
  await wiki.waitFor({ state: "hidden" });
  assert(
    await page.evaluate(() =>
      window.__INKSTONE_QA_CALLS__.some(
        (row) => row.command === "wiki_source" && row.args.input.revision === 1,
      ),
    ),
  );
  checks.push(
    "first Wiki goes from authorized scope to review, explicit publication and version-bound original",
  );
  await page.screenshot({ path: resolve(out, "01-cited-original.png") });

  const companion = await scenario(
    { companionPilot: true },
    { width: 1280, height: 800 },
  );
  await companion.emulateMedia({ reducedMotion: "no-preference" });
  await companion.getByRole("button", { name: "书房同伴", exact: true }).click();
  await companion.getByRole("button", { name: "显示桌宠", exact: true }).click();
  await companion.getByRole("button", { name: "返回工作区", exact: true }).click();
  const sprite = companion.locator("[data-companion-sprite='motuan']");
  await sprite.waitFor();
  assert.equal(await sprite.getAttribute("data-state"), "idle");
  assert.equal(await sprite.getAttribute("data-motion"), "gentle");
  const hasAnimation = (element) =>
    element
      .getAnimations({ subtree: true })
      .some((animation) => animation instanceof CSSAnimation);
  assert(await sprite.evaluate(hasAnimation));
  await companion.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await sprite.evaluate(hasAnimation), false);
  await companion.getByRole("button", { name: "书房同伴", exact: true }).click();
  await companion
    .getByRole("navigation", { name: "同伴功能" })
    .getByRole("button", { name: "相册", exact: true })
    .click();
  await companion.getByRole("button", { name: /纸签下的午后/ }).click();
  await companion.getByRole("heading", { name: /纸签下的午后/ }).waitFor();
  await companion.getByAltText(/圆窗旁打盹/).waitFor();
  checks.push(
    "Motuan motion respects OS reduced motion, and the seeded chapter unlocks its pilot CG",
  );
  await companion.screenshot({ path: resolve(out, "02-motuan-album.png") });

  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  await writeFile(
    resolve(out, "validation.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        pageErrors,
        external,
        scope: "isolated browser and synthetic IPC",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  await browser.close();
}
