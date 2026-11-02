import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import "./check-toolchain.mjs";

const bin = join(process.cwd(), "node_modules", ".bin", "tauri");
const child = spawn(bin, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH}`,
    CARGO_BUILD_JOBS: "2",
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
