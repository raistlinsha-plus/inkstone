// Build an explicit, history-free public source snapshot. Never overwrites a destination.
import { readFile, writeFile, readdir, mkdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out")
  throw Error("node scripts/export-public.mjs --out <new-directory>");
const out = resolve(args[1]);
if (out === root || root.startsWith(out + "/"))
  throw Error("Output cannot replace workspace or ancestor");
await mkdir(out, { recursive: false });
const files = {};
async function put(path, bytes) {
  if (
    /(?:^|\/)(?:\.git|node_modules|target|\.cache|artifacts|dist|Inkstone项目)(?:\/|$)/.test(
      path,
    ) ||
    /\.env/.test(path)
  )
    throw Error("Disallowed public source path: " + path);
  if (
    /(?:sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
      bytes.toString(),
    )
  )
    throw Error("Potential secret: " + path);
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  files[path] = createHash("sha256").update(bytes).digest("hex");
}
async function copy(path) {
  const stat = await lstat(join(root, path));
  if (stat.isSymbolicLink()) throw Error("Refuse source symlink: " + path);
  if (stat.isDirectory()) {
    for (const name of (await readdir(join(root, path))).sort())
      if (![".DS_Store", "target"].includes(name))
        await copy(path + "/" + name);
  } else await put(path, await readFile(join(root, path)));
}
for (const path of [
  "src",
  "scripts",
  "evals",
  "examples",
  "prototypes/v0.7",
  "licenses",
  ".github",
  "src-tauri/src",
  "src-tauri/icons",
  "src-tauri/capabilities",
  "src-tauri/build.rs",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.e2e.conf.json",
  "toolchain.json",
  "package-lock.json",
  "index.html",
  "vite.config.ts",
  "vitest.config.ts",
  "tsconfig.json",
  ".gitignore",
  ".nvmrc",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/KNOWN-LIMITATIONS.md",
  "docs/PUBLIC-README.md",
  "docs/README.zh-CN.md",
  "docs/PUBLIC-ARCHITECTURE.md",
  "docs/PUBLIC-RELEASE-v0.6.6.md",
  "docs/PUBLIC-CHANGELOG.md",
  "docs/assets/v0.6.6",
  "docs/GITHUB-READINESS-v0.6.5.md",
])
  await copy(path);
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
pkg.scripts["docs:check"] = "node scripts/check-public-docs.mjs";
delete pkg.scripts["docs:sync"];
await put("package.json", Buffer.from(JSON.stringify(pkg, null, 2) + "\n"));
const readme = existsSync(join(root, "public-snapshot.json"))
  ? await readFile(join(root, "README.md"), "utf8")
  : (await readFile(join(root, "docs/PUBLIC-README.md"), "utf8"))
      .replaceAll("(../", "(")
      .replace("(KNOWN-LIMITATIONS.md)", "(docs/KNOWN-LIMITATIONS.md)");
await put("README.md", Buffer.from(readme));
await put(
  "CHANGELOG.md",
  Buffer.from(
    (await readFile(join(root, "docs/PUBLIC-CHANGELOG.md"), "utf8")).replaceAll(
      "(../",
      "(",
    ),
  ),
);
await put(
  ".npmrc",
  Buffer.from("registry=https://registry.npmjs.org\ncache=.cache/npm\n"),
);
await writeFile(
  join(out, "public-snapshot.json"),
  JSON.stringify(
    {
      version: 1,
      appVersion: pkg.version,
      createdAt: new Date().toISOString(),
      sourceCommit: spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim(),
      sourceDirty: !!spawnSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim(),
      includesGitHistory: false,
      excluded: [
        "historical internal documentation",
        "Inkstone项目",
        "private screenshots and logs (explicit synthetic demo assets are included)",
        "application data",
        "credentials",
        "build/cache directories",
        "local registry configuration",
      ],
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Public source snapshot: " +
    out +
    " (" +
    Object.keys(files).length +
    " files). No repository created, no upload or push.",
);
