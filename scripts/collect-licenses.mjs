import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const output = "licenses";
mkdirSync(output, { recursive: true });
const list = [];
function collect(kind, name, version, license, path) {
  const dest = join(output, kind, `${name.replaceAll("/", "__")}@${version}`);
  const files = readdirSync(path).filter((n) =>
    /^(licen[sc]e|copying|notice|copyright|unlicense)([.\-_]|$)/i.test(n),
  );
  const copied = [];
  for (const name of files) {
    try {
      const contents = readFileSync(join(path, name));
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, name), contents);
      copied.push(name);
    } catch {
      /* Some projects use a LICENSES directory. */
    }
  }
  list.push({
    kind,
    name,
    version,
    license,
    files: copied,
    source:
      kind === "npm"
        ? `https://www.npmjs.com/package/${name}/v/${version}`
        : `https://crates.io/crates/${name}/${version}`,
  });
}
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
// A few packages omit package.json's license field but ship an explicit license.
// Infer only the literal MIT header, keeping the original notice in the output.
function npmLicense(pkg, entry, path) {
  if (pkg.license || entry.license) return pkg.license || entry.license;
  for (const name of ["license", "LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    if (
      existsSync(join(path, name)) &&
      /^The MIT License\s*\(MIT\)/.test(readFileSync(join(path, name), "utf8"))
    )
      return "MIT";
  }
  return "See upstream";
}
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || !existsSync(join(path, "package.json"))) continue;
  const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  collect("npm", pkg.name, pkg.version, npmLicense(pkg, entry, path), path);
}
const registry = join(homedir(), ".cargo/registry/src");
const used = new Set(
  [
    ...readFileSync("src-tauri/Cargo.lock", "utf8").matchAll(
      /name = "([^"]+)"\nversion = "([^"]+)"/g,
    ),
  ].map((m) => `${m[1]}-${m[2]}`),
);
const seen = new Set();
if (existsSync(registry))
  for (const source of readdirSync(registry))
    for (const crate of readdirSync(join(registry, source))) {
      if (!used.has(crate) || seen.has(crate)) continue;
      seen.add(crate);
      const path = join(registry, source, crate);
      const manifest = readFileSync(join(path, "Cargo.toml"), "utf8");
      const name = manifest.match(/^name = "([^"]+)"/m)?.[1];
      const version = manifest.match(/^version = "([^"]+)"/m)?.[1];
      if (name && version)
        collect(
          "cargo",
          name,
          version,
          manifest.match(/^license = "([^"]+)"/m)?.[1] ?? "See upstream",
          path,
        );
    }
// Some published packages omit a standalone license. Preserve exact upstream
// revisions separately; never synthesize a copyright notice or fetch during CI.
const supplementalPath = join(output, "supplemental.json");
if (existsSync(supplementalPath)) {
  const supplemental = JSON.parse(readFileSync(supplementalPath, "utf8"));
  if (supplemental.version !== 1)
    throw Error("Unknown supplemental license manifest");
  for (const item of supplemental.entries) {
    const pkg = list.find(
      (p) =>
        p.kind === item.kind &&
        p.name === item.name &&
        p.version === item.version,
    );
    if (!pkg) continue;
    for (const entry of item.files) {
      if (
        !entry.file.startsWith("supplemental/") ||
        entry.file.split("/").includes("..")
      )
        throw Error("Invalid supplemental license path");
      const bytes = readFileSync(join(output, entry.file));
      if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
        throw Error("Supplemental license hash mismatch");
      const name = "UPSTREAM-" + entry.file.split("/").at(-1);
      const dest = join(
        output,
        pkg.kind,
        `${pkg.name.replaceAll("/", "__")}@${pkg.version}`,
      );
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, name), bytes);
      if (!pkg.files.includes(name)) pkg.files.push(name);
    }
    pkg.supplementalSources = item.files;
  }
}
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(list, null, 2) + "\n",
);
const header = `# Third-party notices\n\nInkstone uses the packages listed below. Their original copyright notices and license texts are preserved under \`licenses/\`. Native dependencies listed here correspond to source packages fetched for the macOS build; other platform builds require collecting their own dependencies. Development dependencies are included for transparency.\n\nSQLite is in the public domain. Model weights are not bundled.\n\nFor multi-license expressions, permissive MIT, Apache-2.0, BSD, or other applicable permissive alternatives are selected where available; upstream texts remain authoritative.\n\nSome unmodified transitive dependencies use MPL-2.0. They retain that license; see \`licenses/shared/MPL-2.0.txt\`. Their exact source versions are available through the linked package pages, npm registry tarballs and crates.io source downloads. No changes have been made to these dependencies. Lockfiles and \`licenses/manifest.json\` identify the versions used. MPL source-download URLs follow https://crates.io/api/v1/crates/NAME/VERSION/download for Rust crates and https://registry.npmjs.org/NAME for npm package metadata.\n\n`;
writeFileSync(
  "THIRD_PARTY_NOTICES.md",
  header +
    "| Package | Version | License |\n| --- | --- | --- |\n" +
    list
      .map(
        (p) =>
          `| [${p.kind}: ${p.name}](${p.source}) | ${p.version} | ${p.license.replaceAll("|", "\\|")} |`,
      )
      .join("\n") +
    "\n",
);
console.log(`Collected notices for ${list.length} packages.`);
