import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const digest = async (relative) =>
  createHash("sha256")
    .update(await readFile(join(root, relative)))
    .digest("hex");
const run = (command, args) =>
  spawnSync(command, args, { cwd: root, encoding: "utf8" });
const app = "src-tauri/target/release/bundle/macos/Inkstone.app";
const signing = run("codesign", ["--display", "--verbose=2", app]);
const hashes = {};
for (const path of [
  "package-lock.json",
  "src-tauri/Cargo.lock",
  "toolchain.json",
  `${app}/Contents/MacOS/inkstone`,
  `${app}/Contents/Info.plist`,
])
  hashes[path] = await digest(path);
const report = {
  version,
  generatedAt: new Date().toISOString(),
  sourceCommit: run("git", ["rev-parse", "HEAD"]).stdout.trim() || null,
  sourceDirty: !!run("git", ["status", "--porcelain"]).stdout.trim(),
  target: "aarch64-apple-darwin",
  catalogSchema: 3,
  indexSchema: 3,
  toolchain: JSON.parse(await readFile(join(root, "toolchain.json"), "utf8")),
  hashes,
  signing: { commandExit: signing.status, details: signing.stderr.trim() },
  validation:
    "See verification/state.json and native acceptance record; manifest existence does not imply unrun checks passed.",
};
const out = join(root, `artifacts/v${version}-development`);
await mkdir(out, { recursive: true });
await writeFile(
  join(out, "release-manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(`制品指纹已记录：${out}/release-manifest.json`);
