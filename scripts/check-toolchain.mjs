import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
const expected = JSON.parse(
  await readFile(new URL("../toolchain.json", import.meta.url), "utf8"),
);
const npm = spawnSync("npm", ["--version"], { encoding: "utf8" });
const rust = spawnSync(join(homedir(), ".cargo/bin/rustc"), ["--version"], {
  encoding: "utf8",
});
const actual = {
  node: process.versions.node,
  npm: npm.stdout?.trim(),
  rust: rust.stdout?.match(/^rustc (\S+)/)?.[1],
};
const mismatches = Object.keys(actual).filter(
  (key) => actual[key] !== expected[key],
);
if (mismatches.length) {
  console.error(
    `工具链与已验证基线不符：${mismatches.map((key) => `${key} 需要 ${expected[key]}，当前 ${actual[key] || "未安装"}`).join("；")}`,
  );
  process.exit(1);
}
console.log(
  `工具链已核对：Node ${actual.node} / npm ${actual.npm} / Rust ${actual.rust}`,
);
