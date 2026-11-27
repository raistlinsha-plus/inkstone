// Built frontend, a synthetic Tauri bridge and a disposable browser profile.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installV07Fixture } from "./testing/v07-fixture.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.INKSTONE_QA_PLAYWRIGHT || "playwright-core",
);
const url = new URL(process.env.INKSTONE_QA_URL || "http://127.0.0.1:14932/");
assert.equal(url.hostname, "127.0.0.1");
const folder = resolve(process.env.INKSTONE_QA_ARTIFACTS || "artifacts/v1.2.0-beta.1/build-10203/browser");
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.INKSTONE_QA_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "zh-CN",
    colorScheme: "dark",
  });
  await ctx.route("**/*", (r) =>
    new URL(r.request().url()).origin === url.origin ? r.continue() : r.abort(),
  );
  await ctx.addInitScript(
    `if(window===window.top){(${installV07Fixture.toString()})();}`,
  );
  await ctx.addInitScript(() => {
    // Wait for both init scripts; their execution order is unspecified.
    addEventListener(
      "DOMContentLoaded",
      () => {
        const api = window.__TAURI_INTERNALS__;
        const base = api.invoke;
        const originIds = new Map();
        api.invoke = async (command, args = {}) => {
          if (command === "calendar_list") {
            const view = await base(command, args);
            for (const doc of view.documents)
              doc.chatTaskIds = originIds.get(doc.documentId) ?? [];
            return view;
          }
          if (
            command === "task_document" ||
            command === "task_save_from_chat" ||
            command === "calendar_save"
          ) {
            const { documents } = await base("library_list");
            const doc = documents.find(
              (d) => d.id === args.documentId && d.projectId === args.projectId,
            );
            if (!doc) throw Error("unknown fixture note");
            if (command === "task_document")
              return base("read_file", { path: doc.path });
            const prior = await base("read_file", { path: doc.path });
            if (prior.hash !== args.expectedHash) throw Error("stale fixture");
            const result = await base("save_file", {
              path: doc.path,
              expectedHash: args.expectedHash,
              content: args.content,
            });
            if (command === "task_save_from_chat")
              originIds.set(
                doc.id,
                args.quotes.map((q) => q.taskId),
              );
            return result;
          }
          if (command === "task_origin") return null;
          return base(command, args);
        };
      },
      { once: true },
    );
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(url.href, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "问答", exact: true })
      .first()
      .click();
    const prompt = "周五补完发布手册，再核对日历。";
    await page.getByLabel("向当前空间提问").fill(prompt);
    await page.getByRole("button", { name: "发送问题", exact: true }).click();
    await page.getByRole("button", { name: "将原话转为任务" }).first().click();
    const dialog = page.getByRole("dialog");
    const excerpt = dialog.locator("textarea");
    await excerpt.evaluate((el) => {
      el.focus();
      el.setSelectionRange(2, 8);
    });
    await dialog.getByRole("button", { name: "添加所选原话" }).click();
    await dialog.getByLabel("任务标题").fill("完成发布手册");
    const day = await page.evaluate(() => {
      const date = new Date();
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
    });
    await dialog.getByLabel("截止日").fill(day);
    await dialog.getByLabel("目标 Markdown 文档").selectOption("doc-1");
    await dialog.getByRole("button", { name: /保存到文档/ }).click();
    await dialog.waitFor({ state: "hidden" });
    const rail = page.locator(".main-nav");
    const taskButton = rail.getByRole("button", { name: "任务", exact: true });
    const calendarButton = rail.getByRole("button", {
      name: "日历",
      exact: true,
    });
    async function assertIconRail() {
      assert(
        await rail
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.every(
              (button) =>
                !button.innerText.trim() &&
                !button.title &&
                button.getAttribute("aria-label")?.trim(),
            ),
          ),
        "Navigation should expose accessible names and display only icons.",
      );
    }
    const railPositions = () => rail.getByRole("button").evaluateAll(buttons =>
      buttons.map(button => {
        const { x, y } = button.getBoundingClientRect();
        return [button.getAttribute("aria-label"), x, y];
      }),
    );
    const documentPositions = await railPositions();
    await assertIconRail();
    const hint = page.getByRole("tooltip");
    await taskButton.hover();
    await hint.filter({ hasText: /^任务$/ }).waitFor();
    const buttonBox = await taskButton.boundingBox();
    const bubbleBox = await hint.boundingBox();
    assert(bubbleBox.x >= buttonBox.x + buttonBox.width);
    assert(bubbleBox.y >= 0 && bubbleBox.y + bubbleBox.height <= 800);
    await page.mouse.move(530, 60);
    await hint.waitFor({ state: "hidden" });
    await calendarButton.focus();
    await page.keyboard.press("Shift+Tab");
    await hint.filter({ hasText: /^任务$/ }).waitFor();
    await page.keyboard.press("Escape");
    await hint.waitFor({ state: "hidden" });
    assert(
      await taskButton.evaluate((button) => button === document.activeElement),
    );
    await taskButton.click();
    await hint.waitFor({ state: "hidden" });
    const task = page.getByRole("button", {
      name: "完成发布手册",
      exact: true,
    });
    await page.getByRole("button", { name: /来自问答/ }).click();
    await task.waitFor();
    assert.deepEqual(await railPositions(), documentPositions, "Entering Tasks moved the workspace navigation");
    await page.getByRole("button", { name: /^今天/ }).click();
    await task.click();
    const details = page.getByRole("dialog");
    await details.getByText("安排执行时段", { exact: true }).click();
    await details.getByLabel("开始", { exact: true }).fill(day + "T10:00");
    await details.getByLabel("结束", { exact: true }).fill(day + "T11:00");
    await details.getByRole("button", { name: "保存任务" }).click();
    await details.waitFor({ state: "hidden" });
    await calendarButton.click();
    const week = page.locator(".inkstone-week");
    await week.waitFor();
    assert.deepEqual(await railPositions(), documentPositions, "Entering Calendar moved the workspace navigation");
    assert.equal(await page.locator(".sidebar-compact").count(), 0);
    const projections = week
      .locator(":is(.calendar-task-date, .calendar-task-slot)")
      .filter({ hasText: "完成发布手册" });
    await projections.nth(1).waitFor();
    assert.equal(await projections.count(), 2);
    await page.screenshot({
      path: resolve(folder, "calendar-week-zh-dark.png"),
    });
    await taskButton.hover();
    await hint.filter({ hasText: /^任务$/ }).waitFor();
    await page.screenshot({
      path: resolve(folder, "rail-tooltip-zh-dark.png"),
      clip: {
        x: 0,
        y: Math.max(0, Math.floor(buttonBox.y - 55)),
        width: 205,
        height: 155,
      },
    });
    await taskButton.click();
    await task.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "打开原文" })
      .click();
    const rich = page
      .locator(".ProseMirror .document-task-row")
      .filter({ hasText: "完成发布手册" });
    await rich.waitFor();
    await rich.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(folder, "document-rich-task-zh-dark.png"),
    });
    await rich
      .locator(".document-task-details")
      .getByText(new RegExp(day), { exact: false })
      .first()
      .waitFor();
    await rich.locator(".document-task-check").check();
    await page.keyboard.press("Meta+s");
    await taskButton.click();
    await page
      .getByRole("checkbox", { name: "完成发布手册", exact: true })
      .waitFor();
    assert(
      await page
        .getByRole("checkbox", { name: "完成发布手册", exact: true })
        .isChecked(),
      "Markdown checkbox must survive navigation",
    );
    await calendarButton.click();
    await week
      .locator(
        ":is(.calendar-task-date, .calendar-task-slot).calendar-status-done",
      )
      .filter({ hasText: "完成发布手册" })
      .nth(1)
      .waitFor();
    await taskButton.click();
    results.push(
      "Two first-level destinations, a chat task written to Markdown, independent deadline and scheduled projections in the week grid, rich-editor completion persisted into the task list and both calendar projections.",
    );
    await page.screenshot({ path: resolve(folder, "tasks-zh-dark.png") });
    results.push(
      "Selected an original question passage, edited its title and date, wrote to the chosen note and found it in the task list.",
    );
    await page
      .getByRole("button", { name: /模型与设置/ })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("语言 / Language")
      .selectOption("en");
    await page
      .getByRole("button", { name: /Close settings/ })
      .first()
      .click();
    await page.getByText("完成发布手册", { exact: true }).first().waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(
      (await page.locator(".titlebar-name").innerText()).trim(),
      "Inkstone",
    );
    assert(
      !/documents\s*documents/i.test(await page.locator("body").innerText()),
    );
    await page.setViewportSize({ width: 960, height: 640 });
    await page.emulateMedia({ colorScheme: "light" });
    await assertIconRail();
    await rail.getByRole("button", { name: "Calendar", exact: true }).hover();
    await hint.filter({ hasText: /^Calendar$/ }).waitFor();
    await page.mouse.move(420, 40);
    await hint.waitFor({ state: "hidden" });
    results.push(
      "Verified icon-only navigation in wide and compact windows, a right-hand hover label in both languages, pointer dismissal, and keyboard focus and Escape.",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.equal(
      (await page.locator(".titlebar-name").innerText()).trim(),
      "Inkstone",
    );
    const copy = await page.locator("body").innerText();
    assert(
      !copy.includes("任务已保存到所选文档"),
      "Visible save confirmation should follow the active interface language",
    );
    assert(
      !/documents?Documents/.test(copy),
      "Document count repeats its noun",
    );
    assert(
      !copy.includes(
        "Events are saved in their source document. Select one to open it.",
      ),
    );
    await page.screenshot({
      path: resolve(folder, "tasks-en-light-compact.png"),
    });
    results.push(
      "Switched UI language through Settings, preserved the Chinese task title, inspected the compact light layout.",
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.deepEqual(errors, []);
    await writeFile(
      resolve(folder, "checks.json"),
      JSON.stringify(
        { fixture: "synthetic IPC", results, pageErrors: errors },
        null,
        2,
      ),
    );
    console.log(results.join("\n"));
  } catch (e) {
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
        .then((s) => s.slice(0, 2500)),
    );
    throw e;
  }
} finally {
  await browser.close();
}
