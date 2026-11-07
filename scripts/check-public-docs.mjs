import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--integrity") || args.length > 1)
  throw Error("Only --integrity is supported");
const integrity = args.includes("--integrity");
const manifest = JSON.parse(
  await readFile(resolve(root, "public-snapshot.json"), "utf8"),
);
if (manifest.version !== 1 || manifest.includesGitHistory !== false)
  throw Error("Expected explicit history-free public snapshot");
for (const [path, hash] of Object.entries(manifest.files)) {
  if (path.startsWith("/") || path.split("/").includes(".."))
    throw Error("Invalid public snapshot path");
  // Delivery fingerprints verify an unchanged archive, not future contributor edits.
  if (!integrity) continue;
  const full = resolve(root, path);
  if ((await lstat(full)).isSymbolicLink())
    throw Error("Symlink in public snapshot");
  if (
    createHash("sha256")
      .update(await readFile(full))
      .digest("hex") !== hash
  )
    throw Error(
      "Public snapshot changed; rerun exporter or regenerate its manifest: " +
        path,
    );
}
const currentDocuments = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/KNOWN-LIMITATIONS.md",
  "docs/GITHUB-READINESS-v0.6.5.md",
  "docs/README.zh-CN.md",
  "docs/PUBLIC-ARCHITECTURE.md",
  "docs/PUBLIC-RELEASE-v0.6.6.md",
  "evals/v0.6.6/README.md",
  "evals/v0.6.6/RESULTS.md",
  "evals/v0.6.5/README.md",
  "docs/QUICKSTART.md",
  "docs/ROADMAP.md",
  "docs/LOCAL-INSTALLATION.md",
  "docs/GITHUB-READINESS-v0.7.md",
  "docs/ARCHITECTURE-v0.7.md",
  "docs/TECH-STACK-v0.7.md",
  "docs/PRODUCT-v0.7.md",
  "docs/DELIVERY-v0.7-rc4.md",
  "docs/DELIVERY-v0.7-rc5.md",
  "docs/DELIVERY-v0.7.1.md",
  "docs/DELIVERY-v0.7.2.md",
  "docs/DELIVERY-v0.7.3.md",
  "docs/REVIEW-v0.7-rc4.md",
  "docs/launch/v0.7/README.md",
  "docs/launch/v0.7/RELEASE-NOTES.md",
  "docs/launch/v0.7/PR-BODY.md",
  "docs/launch/v0.7/OUTREACH.md",
  "docs/launch/v0.7.3/PROMOTION.md",
  "docs/launch/v0.7.3/RELEASE-v0.7.2.md",
  "docs/launch/v0.7.3/RELEASE-v0.7.3.md",
  "evals/v0.7.2/RESULTS.md",
  "examples/v0.7.3/README.md",
];
for (const file of currentDocuments) {
  const text = await readFile(resolve(root, file), "utf8");
  if (/\/Users\/[a-z][^/]*\//i.test(text))
    throw Error("Local home path in public documentation: " + file);
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    const href = match[1].split("#")[0];
    if (!href || /^[a-z][\w+.-]*:/i.test(href)) continue;
    await lstat(
      resolve(dirname(resolve(root, file)), decodeURIComponent(href)),
    ).catch(() => {
      throw Error("Broken public link in " + file + ": " + href);
    });
  }
}
console.log(
  (integrity
    ? "Original public snapshot fingerprints and links verified; "
    : "Public documentation links verified; original delivery fingerprints not enforced on contributor edits; ") +
    Object.keys(manifest.files).length +
    " files in the historical snapshot; " + currentDocuments.length + " current documents checked. Native/API checks are separate.",
);
