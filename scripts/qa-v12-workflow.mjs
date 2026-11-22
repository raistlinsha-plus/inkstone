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
const folder = resolve("artifacts/v1.2.0-beta.1/browser");
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
        api.invoke = async (command, args = {}) => {
          if (
            command === "task_document" ||
            command === "task_save_from_chat"
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
            return base("save_file", {
              path: doc.path,
              expectedHash: args.expectedHash,
              content: args.content,
            });
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
    await dialog.getByLabel("截止日").fill("2026-11-27");
    await dialog.getByLabel("目标 Markdown 文档").selectOption("doc-1");
    await dialog.getByRole("button", { name: /保存到文档/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: /任务与日历|^日历$/ })
      .first()
      .click();
    await page.getByRole("button", { name: "任务", exact: true }).click();
    await page.getByText("完成发布手册", { exact: true }).first().waitFor();
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
    assert(!copy.includes("任务已保存到所选文档"), "Visible save confirmation should follow the active interface language");
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
