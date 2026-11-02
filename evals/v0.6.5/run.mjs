// Explicit real-service evaluation. Does not read Keychain or application settings.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (
  args.length !== 3 ||
  args[0] !== "--corpus" ||
  !["seen-100", "new-32"].includes(args[1]) ||
  args[2] !== "--run"
)
  throw Error(
    "Explicit paid API use: node evals/v0.6.5/run.mjs --corpus seen-100|new-32 --run",
  );
for (const name of [
  "INKSTONE_EVAL_BASE_URL",
  "INKSTONE_EVAL_EMBEDDING_MODEL",
  "INKSTONE_EVAL_RERANK_ENDPOINT",
  "INKSTONE_EVAL_RERANK_MODEL",
  "INKSTONE_ANSWER_EVAL_MODEL",
])
  if (!process.env[name])
    throw Error("Missing explicit environment variable: " + name);
for (const version of ["v0.6.2", "v0.6.5"]) {
  const dir = resolve(root, "evals", version);
  const manifest = JSON.parse(
    await readFile(resolve(dir, "manifest.json"), "utf8"),
  );
  for (const [file, hash] of Object.entries(manifest.files))
    if (
      createHash("sha256")
        .update(await readFile(resolve(dir, file)))
        .digest("hex") !== hash
    )
      throw Error("Frozen fixture/protocol changed: " + file);
}
console.log(
  "Synthetic corpus only; bounded at 240 HTTP attempts / 20 minutes per run. No Keychain reads. Credentials never printed.",
);
await new Promise((done, fail) => {
  const child = spawn(
    resolve(homedir(), ".cargo/bin/cargo"),
    [
      "test",
      "--locked",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--lib",
      "evaluation_v065::remote_quality_matrix",
      "--",
      "--ignored",
      "--exact",
      "--nocapture",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, INKSTONE_065_CORPUS: args[1] },
    },
  );
  child.on("error", () => fail(Error("Cannot start evaluator")));
  child.on("exit", (code) =>
    code === 0
      ? done()
      : fail(
          Error(
            "Evaluation stopped or failed; inspect retained report, not a quality pass.",
          ),
        ),
  );
});
