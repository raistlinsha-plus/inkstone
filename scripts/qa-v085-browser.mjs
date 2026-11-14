/** Narrow-window onboarding against the built UI, with offline synthetic IPC. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    "artifacts/v0.8.5-development/browser-first-use",
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
const title = "离线体验：社区阅读活动.md";
const onboardingSampleMarkdown = await readFile(
  new URL(`../examples/v0.8.5/${title}`, import.meta.url),
  "utf8",
);
const samplePath = `documents/doc-1/${title}`;
const question = "社区计划开展多少场阅读活动？分别在哪里？";
const answerHeading = "计划开展四场活动";
const viewport = { width: 960, height: 640 };

let page;
try {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    `if (window === window.top) (${installV07Fixture})(${JSON.stringify({ onboardingSampleMarkdown })})`,
  );
  await context.route("**/*", (route) => {
    const request = new URL(route.request().url());
    if (
      request.origin === url.origin ||
      ["blob:", "data:"].includes(request.protocol)
    )
      return route.continue();
    external.push(request.origin);
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const calls = (command) =>
    page.evaluate(
      (key) =>
        window.__INKSTONE_QA_CALLS__.filter((row) => row.command === key),
      command,
    );
  await page.goto(url.href, { waitUntil: "networkidle" });
  const guide = page.getByRole("region", { name: "开始使用" });
  await guide
    .getByRole("button", { name: "打开离线样例", exact: true })
    .waitFor();
  assert.equal(await page.getByText(title, { exact: true }).count(), 0);

  await guide
    .getByRole("button", { name: "打开离线样例", exact: true })
    .click();
  const result = page.locator(".source-card").filter({ hasText: title });
  const search = page.getByRole("textbox", { name: "搜索资料", exact: true });
  await search.waitFor();
  assert.equal(await search.inputValue(), "阅读活动");
  assert.equal(
    await page.getByLabel("检索方式", { exact: true }).inputValue(),
    "keyword",
  );
  assert.equal(
    await page.getByLabel("资料范围", { exact: true }).inputValue(),
    "current",
  );
  await page.getByRole("button", { name: "执行搜索", exact: true }).click();
  await result.waitFor();
  assert.deepEqual(
    (await calls("library_prepare_local_example")).map((row) => row.args),
    [{ projectId: "qa-space" }],
  );
  assert.deepEqual(
    (await calls("search")).map(({ args }) => [
      args.query,
      args.scope,
      args.retrievalMode,
    ]),
    [["阅读活动", samplePath, "keyword"]],
  );
  assert.equal((await calls("test_provider")).length, 0);
  assert.equal((await calls("assistant_ask")).length, 0);
  await page.screenshot({ path: resolve(out, "01-offline-search.png") });
  const readsBefore = (await calls("read_file")).length;
  await result.click();
  await page.waitForFunction(
    ({ count, path }) =>
      window.__INKSTONE_QA_CALLS__
        .filter((row) => row.command === "read_file")
        .slice(count)
        .some((row) => row.args.path === path),
    { count: readsBefore, path: samplePath },
  );
  await page.getByRole("button", { name: "源码", exact: true }).waitFor();
  checks.push(
    "unconfigured user prepares the in-app sample, performs narrowly scoped keyword search, and opens the source",
  );

  await page.getByRole("button", { name: "我的文档", exact: true }).click();
  await guide
    .getByRole("button", { name: "打开离线样例", exact: true })
    .click();
  await search.waitFor();
  await page.getByRole("button", { name: "执行搜索", exact: true }).click();
  await result.waitFor();
  assert.equal((await calls("library_prepare_local_example")).length, 2);
  assert.equal(await result.count(), 1);
  checks.push("opening the sample again results in one searchable document");

  await page.getByRole("button", { name: "连接聊天模型", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "模型设置" });
  assert.equal(
    await settings
      .getByRole("tab", { name: /问答模型/ })
      .getAttribute("aria-selected"),
    "true",
  );
  await settings.getByRole("checkbox", { name: "启用资料问答" }).check();
  await settings
    .getByRole("textbox", { name: /服务地址/ })
    .fill("http://127.0.0.1:9967/v1");
  await settings
    .getByRole("textbox", { name: "模型名称" })
    .fill("inkstone-test");
  await settings.getByRole("button", { name: "测试连接" }).click();
  await settings.getByText("合成问答模型连接成功").waitFor();
  await settings.getByRole("button", { name: "保存设置" }).click();
  await settings.waitFor({ state: "hidden" });
  const [save] = await calls("save_settings");
  assert.equal(save.args.value.chat.enabled, true);
  assert.equal(save.args.value.embedding.enabled, false);
  assert.equal(save.args.chatKey, null);
  checks.push(
    "chat connection test and settings save work with the fixture while embedding remains disabled",
  );

  await page.getByRole("button", { name: "对样例提问", exact: true }).click();
  await page.getByLabel("向当前空间提问").waitFor();
  assert.equal(
    await page.getByLabel("资料范围", { exact: true }).inputValue(),
    "current",
  );
  await page.getByRole("button", { name: "AI 问答", exact: true }).click();
  await page.getByRole("button", { name: "添加资料", exact: true }).click();
  await page
    .getByRole("combobox", { name: "知识空间" })
    .selectOption("qa-space");
  await page.getByRole("checkbox", { name: title, exact: true }).check();
  await page.getByRole("button", { name: "完成选择", exact: true }).click();
  await page.getByRole("checkbox", { name: "本轮不搜索网页" }).check();
  await page.getByLabel("向 AI 提问").fill(question);
  await page.getByRole("button", { name: "发送问题" }).click();
  await page.getByRole("heading", { name: answerHeading }).waitFor();
  await page
    .getByRole("button", { name: "停止生成", exact: true })
    .waitFor({ state: "hidden" });
  const [ask] = await calls("assistant_ask");
  assert.equal(ask.args.webAccess, "local-only");
  assert.equal(ask.args.sources.projectId, "qa-space");
  assert.deepEqual(ask.args.sources.documentIds, ["doc-1"]);
  await page.getByTitle(`查看来源 1：${title}`, { exact: true }).click();
  await page
    .getByRole("dialog", { name: "查看来源" })
    .getByRole("button", { name: "打开文档" })
    .click();
  const returnButton = page.getByRole("button", {
    name: "返回本轮问答",
    exact: true,
  });
  await returnButton.waitFor();
  await page.waitForFunction(() =>
    document.activeElement?.textContent?.includes("返回本轮问答"),
  );
  await returnButton.click();
  const returnedSource = page.getByRole("dialog", { name: "查看来源" });
  await returnedSource.getByText(title, { exact: true }).waitFor();
  await returnedSource
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("heading", { name: answerHeading }).waitFor();
  assert.equal((await calls("assistant_ask")).length, 1);
  checks.push(
    "the narrow-window cited answer opens the original and returns to the same turn without regenerating",
  );
  await page.screenshot({ path: resolve(out, "02-returned-answer.png") });

  const unknownCommands = await page.evaluate(
    () => window.__INKSTONE_QA_UNKNOWN__,
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.evaluate((path) => {
      const store = JSON.parse(
        localStorage.getItem("inkstone-v07-ui-qa-store-offline-onboarding"),
      );
      return store.documents.filter((doc) => doc.path === path).length;
    }, samplePath),
    1,
  );
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unknownCommands, []);
  checks.push(
    "the sample persists in the browser fixture across reload with no public requests",
  );
  const report = {
    passed: true,
    scope:
      "built frontend, synthetic IPC, no real provider requests or native dialogs",
    viewport,
    checks,
    external,
    pageErrors,
  };
  await writeFile(
    resolve(out, "validation.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(out, "failure.png") });
    await writeFile(
      resolve(out, "failure.txt"),
      await page.locator("body").innerText(),
    );
  }
  throw error;
} finally {
  await browser.close();
}
