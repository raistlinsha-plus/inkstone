import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const ids = [
  "toolchain",
  "tooling",
  "frontend",
  "types",
  "rust",
  "worker",
  "build",
  "prototype",
  "docs",
];
const all = () => [...ids];
// Unknown and cross-cutting inputs deliberately expand to the complete gate.
export function affected(paths) {
  const stages = new Set(["toolchain", "tooling"]);
  const reasons = [];
  for (const path of paths) {
    let add;
    if (
      /^(docs\/|Inkstone项目\/|README\.md$|CHANGELOG\.md$|REVIEW[^/]*\.md$)/.test(
        path,
      )
    )
      add = ["docs"];
    else if (path.startsWith("prototypes/")) add = ["prototype", "docs"];
    else if (/^src\/.*\.test\.tsx?$/.test(path)) add = ["frontend", "types"];
    else if (/^src\/.*\.css$/.test(path))
      add = ["frontend", "types", "worker", "build"];
    else if (
      /^src\/(platform|content|rich|session\.|document\.|types\.|parser\.|App\.)/.test(
        path,
      )
    )
      add = all();
    else if (
      /^src\/shell\/(Titlebar|Tree|Sources|SpaceNavigation|WelcomePage)\.tsx$/.test(
        path,
      )
    )
      add = ["frontend", "types", "build"];
    else if (/^src-tauri\/src\//.test(path))
      add = ["rust", "frontend", "types"];
    else if (path.startsWith("evals/")) add = ["rust", "docs"];
    else if (path.startsWith("examples/"))
      add = ["frontend", "types", "worker", "build", "docs"];
    else if (/^scripts\/sync-project-docs\.mjs$/.test(path)) add = ["docs"];
    else add = all();
    add.forEach((x) => stages.add(x));
    reasons.push({ path, stages: add });
  }
  return { stages: ids.filter((x) => stages.has(x)), reasons };
}
export async function digest(root, paths) {
  const hash = createHash("sha256");
  async function visit(path) {
    let data;
    try {
      data = await readFile(join(root, path));
    } catch (e) {
      if (e.code === "ENOENT") {
        hash.update(JSON.stringify([path, "missing"]));
        return;
      }
      if (e.code !== "EISDIR") throw e;
      hash.update(JSON.stringify([path, "directory"]));
      for (const name of (await readdir(join(root, path))).sort())
        if (![".DS_Store", "target", "node_modules"].includes(name))
          await visit(`${path}/${name}`);
      return;
    }
    hash.update(JSON.stringify([path, data.length]));
    hash.update(data);
  }
  for (const path of [...paths].sort()) await visit(path);
  return hash.digest("hex");
}
export function reuseDecision(
  previous,
  fingerprint,
  outputHash,
  resume,
  always = false,
) {
  if (always) return "always checked";
  if (!resume) return "resume not requested";
  if (previous?.status !== "passed") return "no successful cache entry";
  if (previous.fingerprint !== fingerprint)
    return "source, command or environment changed";
  if (previous.outputHash !== outputHash)
    return "generated output missing or changed";
  return "reused";
}
