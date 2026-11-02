import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(dir, "index.html"), "utf8");
const code = readFileSync(resolve(dir, "prototype.js"), "utf8");
const assets = JSON.parse(
  readFileSync(resolve(dir, "asset-plan.json"), "utf8"),
);
const drafts = JSON.parse(
  readFileSync(resolve(dir, "story-drafts.json"), "utf8"),
);
let checks = 0;
const outcomes = [];
const check = (name, fn) => {
  fn();
  checks++;
  outcomes.push(name);
};
function environment(saved) {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, {
    url: "http://prototype.test",
    runScripts: "outside-only",
    virtualConsole: console,
  });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new w.Event("close"));
  };
  if (saved) w.localStorage.setItem("inkstone-prototype-v07-v1", saved);
  w.eval(
    code + "\nwindow.inspectPrototype=()=>JSON.parse(JSON.stringify(state));",
  );
  const q = (s) => w.document.querySelector(s);
  return {
    w,
    dom,
    errors,
    q,
    inspect: () => JSON.parse(JSON.stringify(w.inspectPrototype())),
    click: (action, extra = "") => {
      const el = q('[data-action="' + action + '"]' + extra);
      assert(el, "missing action " + action + extra);
      assert(!el.disabled, "action disabled " + action);
      el.click();
    },
    input: (selector, value) => {
      q(selector).value = value;
      q(selector).dispatchEvent(new w.Event("input", { bubbles: true }));
    },
    change: (selector, value) => {
      const el = q(selector);
      if (el.type === "checkbox") el.checked = value;
      else el.value = value;
      el.dispatchEvent(new w.Event("change", { bubbles: true }));
    },
  };
}
check(
  "portable HTML embeds current sources under hash-only CSP with no asset requests",
  () => {
    const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.equal(inlineScript, "\n" + code + "\n");
    assert.equal(
      inlineStyle,
      "\n" + readFileSync(resolve(dir, "prototype.css"), "utf8") + "\n",
    );
    for (const value of [inlineScript, inlineStyle]) {
      const digest = createHash("sha256").update(value).digest("base64");
      assert(html.includes("'sha256-" + digest + "'"));
    }
    assert(!/<(?:script|link)[^>]+(?:src|href)=/.test(html));
  },
);

const e = environment();
const { q, click, inspect, input, change } = e;
check("prototype marks independent demonstration and prohibits network", () => {
  assert(html.includes("独立演示数据"));
  assert(html.includes("connect-src 'none'"));
  assert(!/<script[^>]+https?:/.test(html));
});
check("final art is explicitly planned, not delivered", () => {
  assert.equal(assets.assets.filter((a) => a.kind === "standing").length, 9);
  assert.equal(assets.assets.filter((a) => a.kind === "cg").length, 6);
  assert(assets.assets.every((a) => a.status === "planned-final-art"));
});
check(
  "all three characters have full three-chapter drafts and reconverging choices",
  () => {
    assert.equal(drafts.characters.length, 3);
    for (const r of drafts.characters) {
      assert.equal(r.episodes.length, 3);
      assert(r.episodes.every((s) => s.characterCount > 180));
      assert.equal(r.episodes[2].choices.length, 2);
      assert.equal(new Set(r.episodes[2].choices.map((c) => c.next)).size, 1);
    }
  },
);
click("choose");
check("role picker offers 3 characters", () =>
  assert.equal(q(".role-grid").children.length, 3),
);
click("select-role", '[data-id="motuan"]');
click("apply-role");
check("selection opens pet introduction without network", () => {
  assert.equal(inspect().character, "motuan");
  assert(q("#modal-title").textContent.includes("纸页"));
});
click("finish-story");
check("initial story completion persists only introduction", () =>
  assert.deepEqual(inspect().roles.motuan.read, [0]),
);
click("close");
click("scenario", '[data-scenario="acquaintance"]');
check("acquaintance scenario starts at 2 events over 1 day", () => {
  assert.equal(inspect().ledger.length, 2);
  assert.equal(new Set(inspect().ledger.map((e) => e.day)).size, 1);
});
click("confirm-work");
click("submit-event");
check(
  "confirming work reaches threshold without automatically opening story",
  () => {
    assert.equal(inspect().ledger.length, 3);
    assert.equal(new Set(inspect().ledger.map((e) => e.day)).size, 2);
    assert(!q("#modal").open);
    assert(q(".quiet-flag").textContent.includes("相识"));
  },
);
click("story", '[data-stage="1"]');
click("finish-story");
check("reading acquaintance unlocks first CG and stage only", () =>
  assert.deepEqual(inspect().roles.motuan.read, [0, 1]),
);
click("panel", '[data-tab="album"]');
check("album differentiates unlocked and locked CG", () => {
  assert.equal(q(".album-grid").children.length, 3);
  assert.equal(e.w.document.querySelectorAll(".album-grid .locked").length, 2);
});
click("close");
click("confirm-work");
click("submit-event");
check("same document on same day is deduplicated", () =>
  assert.equal(inspect().ledger.length, 3),
);
click("close");
click("open-doc", '[data-id="review"]');
click("confirm-work");
click("submit-event");
check("second document same day adds one event but no extra day", () => {
  assert.equal(inspect().ledger.length, 4);
  assert.equal(new Set(inspect().ledger.map((e) => e.day)).size, 2);
});
click("open-doc", '[data-id="relations"]');
click("confirm-work");
click("submit-event");
check("third document is blocked by global day limit", () =>
  assert.equal(inspect().ledger.length, 4),
);
click("close");
click("scenario", '[data-scenario="together"]');
click("confirm-work");
click("submit-event");
check("together threshold requires 8 events over 5 days", () => {
  assert.equal(inspect().ledger.length, 8);
  assert.equal(new Set(inspect().ledger.map((e) => e.day)).size, 5);
});
click("story", '[data-stage="2"]');
check("together completion waits for explicit choice", () =>
  assert(q('[data-action="finish-story"]').disabled),
);
click("story-choice", '[data-index="1"]');
check("choice is stored once and both buttons become immutable", () => {
  assert.equal(inspect().roles.motuan.choice, 1);
  assert(
    [...e.w.document.querySelectorAll(".story-choice button")].every(
      (b) => b.disabled,
    ),
  );
});
click("finish-story");
click("panel", '[data-tab="settings"]');
check("old unlocked appearance can still be selected", () => {
  change("#setting-outfit", "0");
  assert.equal(inspect().outfits.motuan, 0);
});
change("#memory-scope", "当前角色");
input("#memory-text", "回答先给结论 <img src=x onerror=alert(1)>");
q("#memory-form").dispatchEvent(
  new e.w.Event("submit", { bubbles: true, cancelable: true }),
);
check("preference needs explicit form submission and is HTML escaped", () => {
  assert.equal(inspect().preferences.length, 1);
  assert(!q(".pref-row img"));
});
check("role-scoped preference stores stable owner identity", () => {
  assert.equal(inspect().preferences[0].scopeId, "motuan");
});
const scoped = environment(
  e.w.localStorage.getItem("inkstone-prototype-v07-v1"),
);
scoped.click("companion-entry");
scoped.click("choose");
scoped.click("select-role", '[data-id="yanzhou"]');
scoped.click("apply-role");
scoped.click("finish-story");
scoped.click("panel", '[data-tab="settings"]');
scoped.click("edit-pref");
scoped.input("#pref-text", "继续先给结论");
scoped.click("save-pref");
check(
  "switching role and editing preference does not migrate its scope",
  () => {
    assert.equal(scoped.inspect().character, "yanzhou");
    assert.equal(scoped.inspect().preferences[0].scopeId, "motuan");
    assert(scoped.q(".pref-row").textContent.includes("墨团"));
  },
);
scoped.dom.window.close();
click("toggle-pref");
check("confirmed preference can be disabled", () =>
  assert.equal(inspect().preferences[0].enabled, false),
);
click("edit-pref");
input("#pref-text", "金额以万元展示");
click("save-pref");
check("preference edit replaces old content", () =>
  assert.equal(inspect().preferences[0].text, "金额以万元展示"),
);
click("delete-pref");
check("preference deletion removes entry", () =>
  assert.equal(inspect().preferences.length, 0),
);
click("export");
check("export preview contains prototype data but no API secret", () => {
  const obj = JSON.parse(q("#export-data").value);
  assert.equal(obj.prototype, true);
  assert(!("apiKey" in obj));
});
click("close");
click("companion-entry");
change("#setting-enabled", false);
click("close");
click("confirm-work");
check("disabled companion cannot add experiences", () =>
  assert.equal(inspect().ledger.length, 8),
);
click("enable");
click("companion-entry");
click("choose");
click("select-role", '[data-id="yanzhou"]');
click("apply-role");
click("finish-story");
check("role switch shares ledger but keeps story choices separate", () => {
  assert.equal(inspect().ledger.length, 8);
  assert.deepEqual(inspect().roles.yanzhou.read, [0]);
  assert.equal(inspect().roles.motuan.choice, 1);
});
click("close");
click("scenario", '[data-scenario="reward-error"]');
click("confirm-work");
click("submit-event");
check("failed companion write leaves work saved and event pending", () => {
  assert.equal(inspect().saved, true);
  assert.equal(inspect().ledger.length, 2);
  assert(inspect().pending);
});
const pendingId = inspect().pending.id;
click("open-doc", '[data-id="review"]');
click("confirm-work");
check(
  "pending experience cannot be silently replaced by another document",
  () => {
    assert.equal(inspect().pending.id, pendingId);
    assert.equal(inspect().ledger.length, 2);
    assert(!q("#modal").open);
  },
);
click("retry-reward");
check("retry records same event exactly once", () => {
  assert.equal(inspect().ledger.length, 3);
  assert.equal(inspect().pending, null);
});
const saved = e.w.localStorage.getItem("inkstone-prototype-v07-v1");
const restored = environment(saved);
check("reload restores role and progress", () => {
  assert.equal(restored.inspect().character, "yanzhou");
  assert.equal(restored.inspect().ledger.length, 3);
});
restored.dom.window.close();
click("scenario", '[data-scenario="api-error"]');
click("retry-answer");
check("answer retry leaves growth unchanged", () => {
  assert.equal(inspect().answer, "answer");
  assert.equal(inspect().ledger.length, 0);
  assert(q(".answer-table").textContent.includes("120 人"));
});
input("#question", "比较两种阅读活动的参与人数");
q("#ask-form").dispatchEvent(
  new e.w.Event("submit", { bubbles: true, cancelable: true }),
);
check("answer keeps facts separate from persona", () => {
  assert(q(".answer").textContent.includes("资料不足"));
  assert(q(".answer").textContent.includes("新增角色化模型请求：0"));
});
click("companion-entry");
click("clear-companion");
click("clear-confirm");
check("clearing companion resets role while work document remains", () => {
  assert.equal(inspect().character, null);
  assert.equal(e.w.document.querySelectorAll(".doc-button").length, 4);
});
check("no script exceptions during primary flows", () =>
  assert.deepEqual(e.errors, []),
);
const result = {
  date: "2026-10-30",
  scope: "prototype-only; not production acceptance",
  checks,
  passed: true,
  outcomes,
};
writeFileSync(
  resolve(dir, "validation.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify({ passed: true, checks, scope: result.scope }));
e.dom.window.close();
