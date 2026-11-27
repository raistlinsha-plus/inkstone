// Exercise the production editor and the page-edge companion with fictional IPC data.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { installV07Fixture } from "./testing/v07-fixture.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.INKSTONE_QA_PLAYWRIGHT || "playwright-core",
);
const url = new URL(process.env.INKSTONE_QA_URL || "http://127.0.0.1:1420/");
assert(["127.0.0.1", "localhost"].includes(url.hostname));
const out = resolve(
  process.env.INKSTONE_QA_OUT || "artifacts/v0.9.6-development/browser",
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.INKSTONE_QA_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const reports = [];
let active;
try {
  for (const [role, name, theme] of [
    ["motuan", "墨团", "dark"],
    ["yanzhou", "砚舟", "light"],
    ["zhiwei", "知微", "dark"],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 1420, height: 810 },
      colorScheme: theme,
    });
    const errors = [];
    await ctx.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (
        target.origin === url.origin ||
        ["blob:", "data:"].includes(target.protocol)
      )
        return route.continue();
      errors.push(target.origin);
      return route.abort();
    });
    await ctx.addInitScript(`if (window === window.top) {
      (${installV07Fixture})({companionPilot: true, companionCharacter: ${JSON.stringify(role)}});
      localStorage.setItem("inkstone:panel-open","false");
    }`);
    const page = (active = await ctx.newPage());
    page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(e.message));
    const button = (name) => page.getByRole("button", { name, exact: true });
    await page.goto(url.href);
    await button("我的文档").click();
    await page
      .getByRole("button", { name: /阅读活动方案\.md/ })
      .first()
      .click();
    await button("书房同伴").click();
    await button("显示桌宠").click();
    await button("返回文档").click();
    const pet = button(name + "桌宠");
    const anchor = page.locator(".companion-pet-anchor");
    const sprite = anchor.locator('[data-companion-sprite="' + role + '"]');
    await sprite.waitFor();
    const pane = page.locator(".editor-source-pane");
    const [edge, body] = await Promise.all([anchor.boundingBox(), pane.boundingBox()]);
    assert(edge && body && (edge.x + edge.width <= body.x + 1 || body.x + body.width <= edge.x + 1), "The pet must stay outside the writing surface.");
    await pet.focus();
    await pet.press("ArrowLeft");
    await pet.press("ArrowUp");
    const placement = await page.evaluate(() =>
      localStorage.getItem("inkstone:companion:pet-placement"),
    );
    assert.equal(JSON.parse(placement).side, "left");
    await button("书房同伴").click();
    await button("返回文档").click();
    await sprite.waitFor();
    assert.equal(await anchor.getAttribute("data-side"), "left");
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("inkstone:companion:pet-placement"),
      ),
      placement,
    );
    await pet.click();
    await button(role === "motuan" ? "摸摸" : "打招呼").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".companion-pet-avatar svg")?.dataset.state ===
        "happy",
    );
    await page.screenshot({ path: resolve(out, role + "-" + theme + ".png") });
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        document.querySelector(".companion-pet-avatar svg")?.dataset.motion ===
        "static",
    );
    assert.equal(
      await sprite.evaluate((s) => s.getAnimations({ subtree: true }).length),
      0,
    );
    if (role === "motuan") {
      await page.setViewportSize({ width: 960, height: 640 });
      await button("分栏").click();
      await page.waitForFunction(
        () =>
          document.querySelector(".companion-pet-anchor")?.dataset.form ===
          "bookmark",
      );
      await page.screenshot({ path: resolve(out, "narrow-bookmark.png") });
      await button("源码").click();
      const cm = page.locator(".cm-content").first();
      await cm.waitFor();
      await cm.focus();
      await page.keyboard.press("End");
      await page.keyboard.insertText(" 合成记录");
      await button("保存文件").click();
      await page.waitForFunction(() =>
        window.__INKSTONE_QA_CALLS__.some((e) => e.command === "save_file"),
      );
      const makeSelection = () =>
        cm.evaluate((element) => {
          const view = element.cmTile.root.view;
          view.focus();
          view.dispatch({ selection: { anchor: 7, head: 3 } });
        });
      const checkReturn = () =>
        page.waitForFunction(() => {
          const element = document.querySelector(".cm-content");
          const selection = element?.cmTile?.root.view.state.selection.main;
          return (
            document.activeElement === element &&
            selection?.anchor === 7 &&
            selection?.head === 3
          );
        });
      const record = async () => {
        await makeSelection();
        await pet.click();
        await button("记录本次完成").click();
        const card = page.getByRole("region", { name: "本次完成经历卡" });
        await card.getByRole("textbox").waitFor();
        assert.equal(await button("确认并记录").isEnabled(), false);
        return card;
      };
      await record();
      await button("暂不记录").click();
      await checkReturn();
      await record();
      await page.getByLabel("我确认保存以上经历卡内容。").check();
      await page.screenshot({ path: resolve(out, "narrow-experience.png") });
      await button("确认并记录").click();
      await checkReturn();
      assert.equal(
        await page.evaluate(
          () =>
            window.__INKSTONE_QA_CALLS__.filter(
              (e) => e.command === "companion_confirm",
            ).length,
        ),
        1,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    const asks = () =>
      page.evaluate(
        () =>
          window.__INKSTONE_QA_CALLS__.filter(
            (e) => e.command === "assistant_ask",
          ).length,
      );
    assert.equal(await asks(), 0);
    if (role === "yanzhou") {
      await button("问这篇文档").click();
      const input = page.getByRole("textbox", { name: "向当前文档提问" });
      await input.fill("两种活动各有多少人参加？");
      // Observe the transient states and focus at the transition, including quick responses.
      await sprite.evaluate((element) => {
        window.petStates = [];
        new MutationObserver(() =>
          window.petStates.push({
            state: element.dataset.state,
            movedFocusToPet: !!document.activeElement?.closest(
              ".companion-pet-anchor",
            ),
          }),
        ).observe(element, {
          attributes: true,
          attributeFilter: ["data-state"],
        });
      });
      await input.press("Enter");
      await page.waitForFunction(() =>
        window.petStates.some((s) => s.state === "ready"),
      );
      const states = await page.evaluate(() => window.petStates);
      assert(states.some((s) => s.state === "reading"));
      assert.equal(states.filter((s) => s.state === "ready").length, 1);
      assert(states.every((s) => !s.movedFocusToPet));
      assert.equal(await asks(), 1);
    }
    assert.deepEqual(errors, []);
    reports.push({ role, theme, passed: true });
    await ctx.close();
  }
  await writeFile(
    resolve(out, "checks.json"),
    JSON.stringify(reports, null, 2) + "\n",
  );
  console.log(reports);
} catch (e) {
  if (active && !active.isClosed()) {
    await active
      .screenshot({ path: resolve(out, "failure.png") })
      .catch(() => {});
    console.error(await active.evaluate(() => window.petStates ?? []));
    console.error((await active.locator("body").innerText()).slice(-1600));
  }
  throw e;
} finally {
  await browser.close();
}
