import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { affected, digest, reuseDecision, ids } from "./verification/plan.mjs";
import { failureSummary } from "./verification/diagnostics.mjs";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicSnapshot = existsSync(join(root, "public-snapshot.json"));
const args = process.argv.slice(2);
if (
  args.some(
    (x) =>
      !["--resume", "--changed", "--plan"].includes(x) &&
      !["--only=", "--paths=", "--base="].some((p) => x.startsWith(p)),
  )
)
  throw Error(
    "支持 --resume --changed --base=<ref> --paths=<a,b> --only=<stages> --plan",
  );
const value = (key) =>
  args.find((x) => x.startsWith(key + "="))?.slice(key.length + 1);
if ([value("--only"), value("--paths"), value("--base")].some((x) => x === ""))
  throw Error("选项不得为空");
const git = (a) => {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr || "无法读取Git改动");
  return r.stdout;
};
let paths = value("--paths")?.split(",");
if (args.includes("--changed") || value("--base")) {
  if (paths) throw Error("--paths不能与Git改动选择混用");
  const base = value("--base") || "HEAD";
  if (base.startsWith("-")) throw Error("非法base");
  const commit = git(["rev-parse", "--verify", base + "^{commit}"]).trim();
  paths = [
    ...new Set(
      [
        ...git([
          "diff",
          "--no-renames",
          "--name-only",
          "-z",
          commit,
          "--",
        ]).split("\0"),
        ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split(
          "\0",
        ),
      ].filter(Boolean),
    ),
  ];
}
if (paths?.some((p) => !p || isAbsolute(p) || p.split(/[\\/]/).includes("..")))
  throw Error("需要仓库内相对路径");
const impact = paths
  ? affected(paths)
  : { stages: ids, reasons: [{ path: "complete default gate", stages: ids }] };
const requested = value("--only")?.split(",");
if (requested?.some((x) => !ids.includes(x))) throw Error("未知检查阶段");
const selected = requested
  ? ids.filter((x) => ["toolchain", "tooling", ...requested].includes(x))
  : impact.stages;
const mode =
  selected.length === ids.length ? "full-integration" : "scoped-feedback";
const stages = [
  {
    id: "toolchain",
    command: process.execPath,
    args: ["scripts/check-toolchain.mjs"],
    cwd: root,
    inputs: ["toolchain.json", "scripts/check-toolchain.mjs"],
  },
  {
    id: "tooling",
    command: process.execPath,
    args: [
      "--test",
      "scripts/verification/plan.test.mjs",
      "scripts/verification/diagnostics.test.mjs",
      "evals/v0.6.6/budget.test.mjs",
    ],
    cwd: root,
    inputs: ["scripts/verification", "scripts/verify.mjs", "evals/v0.6.6"],
  },
  {
    id: "frontend",
    command: process.execPath,
    args: ["node_modules/vitest/vitest.mjs", "run"],
    cwd: root,
    inputs: [
      "src",
      "scripts/preview-plugin.mjs",
      "package.json",
      "package-lock.json",
      "vite.config.ts",
      "vitest.config.ts",
    ],
  },
  {
    id: "types",
    command: process.execPath,
    args: ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"],
    cwd: root,
    inputs: [
      "src",
      "scripts/preview-plugin.d.mts",
      "tsconfig.json",
      "package.json",
      "package-lock.json",
    ],
  },
  {
    id: "rust",
    command: join(homedir(), ".cargo/bin/cargo"),
    args: ["test", "--locked", "--lib", "--bins"],
    cwd: join(root, "src-tauri"),
    inputs: [
      "src-tauri/src",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src-tauri/build.rs",
      "src-tauri/capabilities",
      "evals",
    ],
  },
  {
    id: "worker",
    command: process.execPath,
    args: ["scripts/check-worker.mjs"],
    cwd: root,
    inputs: ["src", "scripts/check-worker.mjs", "package-lock.json"],
  },
  {
    id: "build",
    command: "npm",
    args: ["run", "build"],
    cwd: root,
    inputs: [
      "src",
      "scripts/preview-plugin.mjs",
      "vite.config.ts",
      "vitest.config.ts",
      "tsconfig.json",
      "index.html",
      "package-lock.json",
    ],
  },
  {
    id: "prototype",
    command: process.execPath,
    args: ["prototypes/v0.7/check.mjs"],
    cwd: root,
    inputs: [
      "prototypes/v0.7/index.html",
      "prototypes/v0.7/index.template.html",
      "prototypes/v0.7/prototype.js",
      "prototypes/v0.7/prototype.css",
      "prototypes/v0.7/check.mjs",
      "prototypes/v0.7/build.mjs",
      "prototypes/v0.7/story-drafts.json",
      "prototypes/v0.7/asset-plan.json",
    ],
  },
  {
    id: "docs",
    command: process.execPath,
    args: publicSnapshot
      ? ["scripts/check-public-docs.mjs"]
      : ["scripts/sync-project-docs.mjs", "--check"],
    cwd: root,
    inputs: [
      "docs",
      "README.md",
      "Inkstone项目",
      "scripts/sync-project-docs.mjs",
      "scripts/check-public-docs.mjs",
      "public-snapshot.json",
    ],
  },
];

const packageInfo = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const out = join(
  root,
  `artifacts/v${packageInfo.version}-development/verification`,
);
const envNames = Object.keys(process.env)
  .filter(
    (x) =>
      /^(?:CARGO_|RUST|TAURI_|VITE_|npm_config_)/.test(x) ||
      ["NODE_OPTIONS", "CI", "TZ", "LANG", "LC_ALL", "PATH"].includes(x),
  )
  .sort();
const runtime = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  npm: spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout?.trim(),
  rust: spawnSync(join(homedir(), ".cargo/bin/rustc"), ["-vV"], {
    encoding: "utf8",
  }).stdout?.trim(),
  environmentHash: createHash("sha256")
    .update(JSON.stringify(envNames.map((x) => [x, process.env[x] || ""])))
    .digest("hex"),
};
const plan = {
  mode,
  selected,
  impact,
  runtime,
  note: "局部反馈不等于全量通过；原生/真实API始终独立记录。",
};
console.log(JSON.stringify(plan, null, 2));
if (args.includes("--plan")) process.exit(0);
await mkdir(out, { recursive: true });
const lock = join(out, ".lock");
try {
  await mkdir(lock);
} catch (e) {
  if (e.code === "EEXIST")
    throw Error("已有验证会话或残留锁；先核对进程再清理 " + lock);
  throw e;
}
await writeFile(join(lock, "pid"), String(process.pid));
let child,
  interrupted = false;
const stop = (signal) => {
  interrupted = true;
  child?.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
try {
  let previous = { stages: {} };
  try {
    previous = JSON.parse(await readFile(join(out, "cache.json"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") console.log("缓存不可用，重新执行。");
  }
  const report = {
    version: 2,
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
    startedAt: new Date().toISOString(),
    ...plan,
    stages: {},
    credentials: "No production credentials or paid API in default checks.",
    nativeSystem: {
      status: "not-run",
      reason:
        "System dialogs, IME, Keychain and cold launch are separate acceptance.",
    },
  };
  const save = async () => {
    await writeFile(
      join(out, "state.json.tmp"),
      JSON.stringify(report, null, 2) + "\n",
    );
    await rename(join(out, "state.json.tmp"), join(out, "state.json"));
  };
  let failed = false;
  for (const stage of stages.filter((s) => selected.includes(s.id))) {
    if (interrupted) {
      failed = true;
      break;
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          runtime,
          command: stage.command,
          args: stage.args,
          cwd: stage.cwd,
          source: await digest(root, [
            ...stage.inputs,
            "examples",
            "toolchain.json",
            "package-lock.json",
            "src-tauri/Cargo.lock",
            "scripts/verify.mjs",
            "scripts/verification",
            "src-tauri/tauri.conf.json",
            "src-tauri/Cargo.toml",
            "vite.config.ts",
            "vitest.config.ts",
            "tsconfig.json",
            "src-tauri/build.rs",
            "src-tauri/capabilities",
          ]),
        }),
      )
      .digest("hex");
    const outputPaths =
      stage.id === "build"
        ? ["dist"]
        : stage.id === "types"
          ? ["tsconfig.tsbuildinfo"]
          : [];
    const outputHash = outputPaths.length
      ? await digest(root, outputPaths)
      : null;
    const reason = reuseDecision(
      previous.stages?.[stage.id],
      fingerprint,
      outputHash,
      args.includes("--resume"),
      ["toolchain", "tooling", "docs"].includes(stage.id),
    );
    if (reason === "reused") {
      report.stages[stage.id] = {
        ...previous.stages[stage.id],
        execution: "reused",
        reason,
      };
      console.log(
        stage.id + ": reused (inputs, environment and outputs verified)",
      );
      await save();
      continue;
    }
    const started = Date.now(),
      log = report.runId + "-" + stage.id + ".log";
    report.stages[stage.id] = {
      status: "running",
      execution: "executed",
      fingerprint,
      reason,
      startedAt: new Date(started).toISOString(),
      log,
    };
    await save();
    console.log(stage.id + ": running — " + reason);
    const stream = createWriteStream(join(out, log));
    const code = await new Promise((done) => {
      child = spawn(stage.command, stage.args, {
        cwd: stage.cwd,
        env: {
          ...process.env,
          DEBUG_PRINT_LIMIT: "1800",
          CARGO_BUILD_JOBS: "2",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.pipe(stream, { end: false });
      child.stderr.pipe(stream, { end: false });
      child.once("error", (e) => {
        stream.write(String(e));
        done(null);
      });
      child.once("close", done);
    });
    child = undefined;
    await new Promise((done) => stream.end(done));
    report.stages[stage.id] = {
      ...report.stages[stage.id],
      status: code === 0 ? "passed" : code === null ? "blocked" : "failed",
      exitCode: code,
      durationMs: Date.now() - started,
      finishedAt: new Date().toISOString(),
      outputHash: outputPaths.length ? await digest(root, outputPaths) : null,
    };
    previous.stages ??= {};
    previous.stages[stage.id] = report.stages[stage.id];
    await save();
    console.log(
      stage.id +
        ": " +
        report.stages[stage.id].status +
        " " +
        report.stages[stage.id].durationMs +
        "ms",
    );
    if (code !== 0) {
      failed = true;
      console.error(
        `--- ${stage.id} failure diagnostics (bounded tail) ---\n${failureSummary(await readFile(join(out, log), "utf8"))}`,
      );
      if (stage.id === "toolchain") break;
    }
  }
  report.finishedAt = new Date().toISOString();
  report.durationMs =
    Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  report.status =
    failed || interrupted
      ? "failed"
      : Object.keys(report.stages).length === selected.length
        ? "passed"
        : "incomplete";
  report.fullIntegrationPassed =
    mode === "full-integration" && report.status === "passed";
  await save();
  await writeFile(
    join(out, report.runId + ".json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    join(out, "cache.json.tmp"),
    JSON.stringify(previous, null, 2) + "\n",
  );
  await rename(join(out, "cache.json.tmp"), join(out, "cache.json"));
  console.log(
    `报告：${out}/state.json；${mode}；${report.durationMs}ms；原生验收未自动标为通过。`,
  );
  process.exitCode = report.status === "passed" ? 0 : 1;
} finally {
  await rm(lock, { recursive: true, force: true });
}
