import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { affected, digest, reuseDecision, ids } from "./plan.mjs";
test("documentation checks do not select runtime build", () => {
  assert.deepEqual(affected(["docs/PRODUCT.md"]).stages, [
    "toolchain",
    "tooling",
    "docs",
  ]);
});
test("global, unknown, session, IPC and parser changes expand all gates", () => {
  for (const path of [
    "strange.file",
    "src/unknown.ts",
    "package-lock.json",
    "src/session.ts",
    "src/platform/ipc.ts",
    "src/parser.worker.ts",
    "src/styles.css",
  ]) {
    const s = affected([path]).stages;
    if (path.endsWith(".css"))
      assert.ok(s.includes("worker") && s.includes("build"));
    else assert.deepEqual(s, ids);
  }
});
test("selected tests never imply a production build passed", () =>
  assert.deepEqual(affected(["src/Editor.test.tsx"]).stages, [
    "toolchain",
    "tooling",
    "frontend",
    "types",
  ]));
test("framed digest notices content, missing files, deletions, configuration and outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkstone-verify-"));
  try {
    await mkdir(join(root, "a"));
    await writeFile(join(root, "a/x"), "a");
    const a = await digest(root, ["a"]);
    await writeFile(join(root, "a/x"), "b");
    assert.notEqual(a, await digest(root, ["a"]));
    const b = await digest(root, ["missing"]);
    await writeFile(join(root, "missing"), "");
    assert.notEqual(b, await digest(root, ["missing"]));
    await rm(join(root, "a/x"));
    assert.notEqual(a, await digest(root, ["a"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("cache cannot reuse failures, changed environment or outputs", () => {
  const p = { status: "passed", fingerprint: "a", outputHash: "b" };
  assert.equal(reuseDecision(p, "a", "b", true), "reused");
  for (const args of [
    [p, "c", "b", true],
    [p, "a", "c", true],
    [{ ...p, status: "failed" }, "a", "b", true],
    [p, "a", "b", false],
    [p, "a", "b", true, true],
  ])
    assert.notEqual(reuseDecision(...args), "reused");
});

test("App wire commands remain registered on the native boundary; shell has no direct IPC", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const ts = (await import("typescript")).default;
  const ipc = ts.createSourceFile(
    "ipc.ts",
    await readFile(
      new URL("../../src/platform/ipc.ts", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );
  const commands = ipc.statements
    .find((n) => ts.isInterfaceDeclaration(n) && n.name.text === "Commands")
    .members.map((n) => n.name.getText(ipc));
  const lib = await readFile(
    new URL("../../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  const registered = lib
    .split(".invoke_handler(tauri::generate_handler![")[1]
    ?.split("])")[0];
  assert.ok(registered);
  for (const cmd of commands)
    assert.match(registered, new RegExp("(?:^|::|\\s)" + cmd + "(?:,|\\s|$)"));
  for (const file of await readdir(
    new URL("../../src/shell/", import.meta.url),
  )) {
    const source = await readFile(
      new URL("../../src/shell/" + file, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /@tauri-apps|platform\/ipc|localStorage/);
  }
});
