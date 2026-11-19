/** Built UI smoke test using fictional data and synthetic Tauri IPC. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installV07Fixture } from "./testing/v07-fixture.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.INKSTONE_QA_PLAYWRIGHT || "playwright-core");
const url = new URL(process.env.INKSTONE_QA_URL || "http://127.0.0.1:1420/");
assert(["127.0.0.1", "localhost"].includes(url.hostname));
const out = resolve(
  process.env.INKSTONE_QA_OUT || "artifacts/v0.9.2-development/browser",
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.INKSTONE_QA_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const sampleTitle = "离线体验：社区阅读活动.md";
const sampleSpace = "22adb640-1a43-4b7c-824e-1bef7aaabc08";
const onboardingSampleMarkdown = await readFile(
  new URL(`../examples/v0.8.5/${sampleTitle}`, import.meta.url),
  "utf8",
);
const reports = [];
async function contextFor(scenario, fixture, viewport) {
  const ctx = await browser.newContext({ viewport });
  const errors = [], external = [], checks = [];
  reports.push({ scenario, viewport, checks, errors, external });
  await ctx.addInitScript(
    `if (window === window.top) (${installV07Fixture})(${JSON.stringify(fixture)})`,
  );
  await ctx.route("**/*", (route) => {
    const request = new URL(route.request().url());
    if (request.origin === url.origin || ["blob:", "data:"].includes(request.protocol))
      return route.continue();
    external.push(request.origin);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10_000);
  await page.goto(url.href, { waitUntil: "networkidle" });
  const calls = (command) =>
    page.evaluate((key) => window.__INKSTONE_QA_CALLS__.filter((row) => row.command === key), command);
  const finish = async () => {
    assert.deepEqual(await page.evaluate(() => window.__INKSTONE_QA_UNKNOWN__), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await ctx.close();
  };
  return { page, calls, finish, checks };
}

let active;
try {
  {
    const { page, calls, finish, checks } = await contextFor(
      "onboarding", { onboardingSampleMarkdown, isolatedOnboarding: true },
      { width: 960, height: 640 },
    );
    active = page;
    await page.getByRole("button", { name: "用示例体验", exact: true }).click();
    const practice = page.getByRole("region", { name: "离线问答练习" });
    await practice.getByRole("button", { name: "体验模拟问答" }).click();
    await practice.getByRole("button", { name: "计划举办几场阅读活动？" }).click();
    await practice.getByText(/模拟回答：计划举办 4 场/).waitFor();
    await practice.getByRole("button", { name: /查看原文 · 第 7 行/ }).click();
    await practice.getByText(/河畔社区读书会计划开展 4 场/).waitFor();
    await page.screenshot({ path: resolve(out, "01-offline-proof.png") });
    await practice.getByRole("button", { name: "满意度怎么样？" }).click();
    await practice.getByText(/这份资料没有提供满意度结果/).waitFor();
    await practice.getByRole("button", { name: /查看原文 · 第 11 行/ }).click();
    await practice.getByRole("button", { name: "打开原文", exact: true }).click();
    const prepare = await calls("library_prepare_local_example");
    assert.equal(prepare.length, 1);
    assert.deepEqual(prepare[0].args, {});
    assert.ok((await calls("open_library")).some(({ args }) => args.projectId === sampleSpace));
    assert.equal((await calls("assistant_ask")).length, 0);
    assert.equal((await calls("test_provider")).length, 0);
    checks.push("Opened isolated example, compared both simulated answers to original passages, no provider invoked");
    await page.getByRole("button", { name: "继续离线体验", exact: true }).click();
    const start = practice.getByRole("button", { name: "体验模拟问答" });
    if (await start.isVisible()) await start.click();
    await practice.getByRole("button", { name: "满意度怎么样？" }).click();
    await practice.getByRole("button", { name: "保存示例回答" }).click();
    const save = page.getByRole("dialog", { name: "保存回答为文档" });
    await save.getByRole("button", { name: "保存新文档", exact: true }).click();
    await page.waitForFunction(() =>
      window.__INKSTONE_QA_CALLS__.some((row) => row.command === "library_create_document"),
    );
    const [saved] = await calls("library_create_document");
    assert.equal(saved.args.projectId, sampleSpace);
    assert.match(saved.args.content, /模拟回答/);
    checks.push("Saved the simulated answer inside the isolated sample space");
    await finish();
  }
  {
    const { page, calls, finish, checks } = await contextFor(
      "model-setup", { onboardingSampleMarkdown, isolatedOnboarding: true },
      { width: 1160, height: 740 },
    );
    active = page;
    await page.getByRole("button", { name: "AI 问答", exact: true }).click();
    const draft = page.getByLabel("向 AI 提问");
    const question = "把这句改成简短通知：下周三整理会议纪要。";
    await draft.fill(question);
    await page.getByRole("checkbox", { name: "本轮不搜索网页" }).check();
    await page.getByRole("button", { name: "发送问题" }).click();
    const settings = page.getByRole("dialog", { name: "模型设置" });
    await settings.getByRole("heading", { name: "连接问答模型" }).waitFor();
    assert.equal(await settings.getByRole("tab", { name: /嵌入|向量/ }).count(), 0);
    await settings.getByRole("button", { name: "关闭设置" }).click();
    assert.equal(await draft.inputValue(), question);
    assert.equal(await page.getByRole("checkbox", { name: "本轮不搜索网页" }).isChecked(), true);
    await page.getByRole("button", { name: "发送问题" }).click();
    await settings.getByRole("checkbox", { name: "启用资料问答" }).check();
    await settings.getByRole("textbox", { name: /服务地址/ }).fill("http://127.0.0.1:9967/v1");
    await settings.getByRole("textbox", { name: "模型名称" }).fill("inkstone-test");
    await settings.getByRole("button", { name: "测试连接" }).click();
    await settings.getByText("合成问答模型连接成功").waitFor();
    await settings.getByRole("button", { name: "保存设置" }).click();
    await settings.waitFor({ state: "hidden" });
    assert.equal(await draft.inputValue(), question);
    assert.equal(await page.getByRole("checkbox", { name: "本轮不搜索网页" }).isChecked(), true);
    assert.equal((await calls("assistant_ask")).length, 0);
    assert.equal((await calls("save_settings"))[0].args.value.embedding.enabled, false);
    await page.screenshot({ path: resolve(out, "03-resumed-question.png") });
    checks.push("Chat setup cancellation and save return to the unsent question with the same web permission");
    await finish();
  }
  {
    const { page, calls, finish, checks } = await contextFor(
      "wiki", {}, { width: 1160, height: 740 },
    );
    active = page;
    await page.getByRole("button", { name: "知识 Wiki", exact: true }).click();
    await page.getByRole("heading", { name: "已发布主题" }).waitFor();
    await page.getByRole("heading", { name: "最近变化" }).waitFor();
    await page.screenshot({ path: resolve(out, "02-wiki-landing.png") });
    checks.push("Wiki starts with published topics and recent changes visible together");
    const wiki = page.getByRole("dialog", { name: "知识 Wiki" });
    await wiki.getByRole("button", { name: "选择整理范围" }).click();
    await wiki.getByRole("checkbox", { name: "启用当前空间的 Wiki" }).check();
    await wiki.getByLabel("关注主题").fill("北岸阅读活动");
    await wiki.getByRole("checkbox", { name: "阅读活动方案.md", exact: true }).check();
    await wiki.getByRole("button", { name: "保存范围与维护" }).click();
    await wiki.getByRole("button", { name: "整理所选资料" }).click();
    await wiki.getByRole("button", { name: "查看待审阅改动" }).click();
    await wiki.getByRole("heading", { name: "待审阅" }).waitFor();
    const publish = wiki.getByRole("button", { name: "发布改动" });
    await publish.click();
    await wiki.getByText(/原文位置 · 1/).click();
    const origin = wiki.getByRole("button", { name: /阅读活动方案\.md/ }).first();
    await origin.click();
    await page.waitForFunction(() =>
      window.__INKSTONE_QA_CALLS__.some((row) => row.command === "wiki_source"),
    );
    assert.equal((await calls("wiki_review")).length, 1);
    checks.push("Authorized one document, reviewed a proposal, published it and opened its original passage");
    await finish();
  }
  {
    const { page, finish, checks } = await contextFor(
      "document-workspace", {}, { width: 1432, height: 818 },
    );
    active = page;
    await page.getByRole("button", { name: "我的文档", exact: true }).click();
    const home = page.locator("main .library-browser");
    await home.getByRole("heading", { level: 1 }).waitFor();
    for (const colorScheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme, colorScheme,
      );
      const matchesTheme = await home.evaluate((el) => {
        const swatch = el.appendChild(document.createElement("span"));
        swatch.style.backgroundColor = "var(--ui-paper)";
        const matches = getComputedStyle(el).backgroundColor === getComputedStyle(swatch).backgroundColor;
        swatch.remove();
        return matches;
      });
      assert.equal(matchesTheme, true, colorScheme + " library canvas");
      assert.equal(await page.locator(".library-open[aria-current=page]").count(), 0);
    }
    const fileButton = home.getByRole("button", { name: /阅读活动方案\.md/ }).first();
    await fileButton.click();
    await page.locator(".library-open[aria-current=page]").waitFor();
    await page.getByRole("button", { name: "问这篇文档", exact: true }).click();
    const panel = page.locator(".contextual-panel");
    await panel.getByRole("textbox", { name: "向当前文档提问" }).fill("两种阅读活动各有多少人参加？");
    await panel.getByRole("button", { name: "发送问题" }).click();
    await panel.getByRole("heading", { name: "甲方案参与人数较多" }).waitFor();
    await panel.getByRole("table").waitFor();
    await panel.getByRole("button", { name: "复制 Markdown" }).waitFor();
    assert.equal(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    checks.push("Library follows both system themes, selection follows the open document, and its cited tabular answer fits the side panel");
    await finish();
  }
  await writeFile(resolve(out, "validation.json"), JSON.stringify({ passed: true, reports }, null, 2) + "\n");
} catch (error) {
  if (active) {
    await active.screenshot({ path: resolve(out, "failure.png") });
    await writeFile(resolve(out, "failure.txt"), await active.locator("body").innerText());
  }
  throw error;
} finally {
  await browser.close();
}
