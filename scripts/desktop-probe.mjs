// Launch only the known isolated app. This checks startup/IPC, not visible UI interactions.
import { spawn, spawnSync } from "node:child_process";
import { readFile, stat, mkdir, writeFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const app = join(root, "src-tauri/target/debug/bundle/macos/Inkstone E2E.app");
const id = spawnSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleIdentifier", join(app, "Contents/Info.plist")],
  { encoding: "utf8" },
).stdout?.trim();
if (id !== "local.inkstone.desktop.e2e") throw Error("拒绝启动非隔离bundle");
const data = join(homedir(), "Library/Application Support", id),
  probe = join(data, "bootstrap-probe.json");
if (
  (
    await lstat(data).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    })
  )?.isSymbolicLink()
)
  throw Error("隔离目录不能为符号链接");
const report = {
  version,
  startedAt: new Date().toISOString(),
  scope: "isolated cold process startup + WebView bootstrap invocation only",
  nativeUi: "not-run",
  driver: "not-installed",
  runs: [],
};
for (let n = 0; n < 5; n++) {
  const started = Date.now();
  let stderr = "",
    exited = false;
  const child = spawn(join(app, "Contents/MacOS/inkstone"), [], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (b) => (stderr += b.toString()));
  child.on("error", (e) => {
    stderr += String(e);
    exited = true;
  });
  child.on("exit", () => (exited = true));
  let result;
  try {
    while (Date.now() - started < 12000 && !exited) {
      const file = await stat(probe).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (file && file.mtimeMs >= started) {
        const marker = JSON.parse(await readFile(probe, "utf8"));
        if (
          marker.identifier === id &&
          marker.credentials === "disabled-at-compile-time"
        ) {
          result = {
            status: "passed",
            bootstrapMs: Date.now() - started,
            marker,
          };
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    if (!exited) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (!exited) child.kill("SIGKILL");
    }
  }
  result ??= {
    status: "failed",
    reason: exited ? "process exited before bootstrap" : "bootstrap timeout",
    stderr: stderr.slice(-2000),
  };
  report.runs.push(result);
  console.log(`isolated startup ${n + 1}: ${result.status}`);
  if (result.status !== "passed") break;
}
report.status =
  report.runs.length === 5 && report.runs.every((x) => x.status === "passed")
    ? "passed"
    : "failed";
report.finishedAt = new Date().toISOString();
const out = join(root, `artifacts/v${version}-development`);
await mkdir(out, { recursive: true });
await writeFile(
  join(out, "desktop-probe.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log("报告：" + join(out, "desktop-probe.json"));
process.exitCode = report.status === "passed" ? 0 : 1;
