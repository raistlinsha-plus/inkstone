/** Production presentation only. Isolated browser + synthetic IPC; never real keys/files. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { installV07Fixture } from "./testing/v07-fixture.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.INKSTONE_QA_PLAYWRIGHT || "playwright-core",
);
const url = process.env.INKSTONE_QA_URL || "http://127.0.0.1:1420/";
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
const out = resolve("artifacts/v0.7.0-rc.4-development/browser-stable");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
await context.addInitScript("(" + installV07Fixture.toString() + ")()");
const page = await context.newPage(),
  errors = [],
  external = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (route) => {
  const target = new URL(route.request().url());
  if (
    target.origin === new URL(url).origin ||
    ["blob:", "data:"].includes(target.protocol)
  )
    return route.continue();
  external.push(target.origin);
  return route.abort();
});
const shot = (name) => page.screenshot({ path: resolve(out, name + ".png") });
try {
  await page.goto(url, { waitUntil: "networkidle" });
  const sidebar = page.locator(".library-browser.compact");
  await sidebar
    .getByRole("button", { name: "文档操作 复盘.md", exact: true })
    .waitFor();
  const order = () => sidebar.locator(".library-open strong").allTextContents();
  const before = await order();
  for (let i = 0; i < 10; i++) {
    await sidebar
      .getByRole("button", {
        name: i % 2 ? "阅读活动方案.md" : "复盘.md",
        exact: true,
      })
      .click();
    assert.deepEqual(await order(), before);
  }
  checks.push(
    "production sidebar: ten opens preserve default order despite opened-desc IPC",
  );
  const metrics = await sidebar
    .locator(".library-shortcuts button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect(),
          icon = button.querySelector("svg").getBoundingClientRect(),
          text = button.querySelector("span").getBoundingClientRect();
        return {
          height: r.height,
          iconWidth: icon.width,
          iconHeight: icon.height,
          alignment: Math.abs(
            icon.y + icon.height / 2 - text.y - text.height / 2,
          ),
        };
      }),
    );
  for (const metric of metrics) {
    assert.equal(metric.iconWidth, 16);
    assert.equal(metric.iconHeight, 16);
    assert(metric.height >= 36);
    assert(metric.alignment <= 1);
  }
  assert.equal(metrics[0].height, metrics[1].height);
  checks.push(
    "new/import real buttons: matched heights, 16px icons, center alignment <=1px",
  );
  await shot("01-workspace-buttons-1440");
  await sidebar.getByLabel("文档排序").selectOption("nameDesc");
  await page.reload({ waitUntil: "networkidle" });
  await sidebar.getByLabel("文档排序").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(
        '.library-browser.compact select[aria-label="文档排序"]',
      )?.value === "nameDesc",
  );
  checks.push("per-space ordering survives reload");
  await sidebar.getByRole("button", { name: "最近", exact: true }).click();
  assert.equal(
    await sidebar.locator(".library-open strong").first().textContent(),
    "阅读活动方案.md",
  );
  checks.push("recent is explicit and reflects latest access");
  await sidebar.getByRole("button", { name: "空间文档", exact: true }).click();
  await sidebar.getByLabel("文档排序").selectOption("nameAsc");
  await sidebar
    .getByRole("button", { name: "文档操作 复盘.md", exact: true })
    .click();
  await sidebar
    .getByRole("button", { name: "移到回收站", exact: true })
    .click();
  await sidebar.getByRole("button", { name: "回收站", exact: true }).click();
  await shot("02-trash-1440");
  await sidebar.getByRole("button", { name: "复盘.md", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "回收站文档", exact: true });
  await dialog.waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.__INKSTONE_QA_CALLS__.filter(
          (c) => c.command === "library_trash" && c.args.restore,
        ).length,
    ),
    0,
  );
  await dialog.getByRole("button", { name: "彻底删除…", exact: true }).click();
  dialog = page.getByRole("dialog", {
    name: "彻底删除这篇文档？",
    exact: true,
  });
  await dialog.waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "彻底删除", exact: true })
      .isEnabled(),
    false,
  );
  await shot("03-purge-1440");
  await dialog.getByLabel("输入删除以确认").fill("删除");
  await dialog.getByRole("button", { name: "彻底删除", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await sidebar.getByText("回收站为空", { exact: true }).waitFor();
  checks.push(
    "trash opens read-only details; explicit confirmation removes only synthetic copy",
  );
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await sidebar
      .getByRole("button", { name: "空间文档", exact: true })
      .click();
    await sidebar
      .getByRole("button", { name: "阅读活动方案.md", exact: true })
      .click();
    if (viewport.width <= 1100) {
      const back = page.getByRole("button", { name: "返回编辑", exact: true });
      if (await back.count()) await back.first().click();
      await page
        .locator(".editor-surface > .milkdown")
        .waitFor({ state: "visible" });
    }
    await shot("04-editor-" + viewport.width);
    const body = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(body.scroll <= body.width);
    checks.push(`editor ${viewport.width} no page overflow`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(
    resolve(out, "validation.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        buttonMetrics: metrics,
        errors,
        external,
        result: "passed",
        realModelRequests: 0,
        nativeUi: "not-run",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ result: "passed", checks: checks.length, out }));
} catch (e) {
  await shot("failure").catch(() => {});
  await writeFile(resolve(out, "failure.txt"), String(e));
  throw e;
} finally {
  await browser.close();
}
