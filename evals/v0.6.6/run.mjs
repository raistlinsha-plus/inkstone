// Explicit paid evaluation. No Keychain access; synthetic fixtures and transient env only.
import { readFile, writeFile, mkdir, open, rm, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { reserveBudget, settleBudget } from "./budget.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (
  args[0] !== "--run" ||
  args.length > 2 ||
  (args[1] && !/^--cases=P\d{2}(,P\d{2})*$/.test(args[1]))
)
  throw Error(
    "Explicit paid use: node evals/v0.6.6/run.mjs --run [--cases=P11,P19,P23]",
  );
const selectedCaseIds = args[1]?.slice("--cases=".length).split(",") ?? [];
if (
  new Set(selectedCaseIds).size !== selectedCaseIds.length ||
  selectedCaseIds.some(
    (id) => Number(id.slice(1)) < 1 || Number(id.slice(1)) > 40,
  )
)
  throw Error("Unknown or duplicate follow-up case ID");
for (const name of [
  "INKSTONE_EVAL_BASE_URL",
  "INKSTONE_EVAL_EMBEDDING_MODEL",
  "INKSTONE_EVAL_RERANK_ENDPOINT",
  "INKSTONE_EVAL_RERANK_MODEL",
  "INKSTONE_ANSWER_EVAL_MODEL",
])
  if (!process.env[name]) throw Error("Missing explicit environment: " + name);
const frozen = JSON.parse(
  await readFile(resolve(root, "evals/v0.6.6/manifest.json"), "utf8"),
);
for (const [file, hash] of Object.entries(frozen.files))
  if (
    createHash("sha256")
      .update(await readFile(resolve(root, "evals/v0.6.6", file)))
      .digest("hex") !== hash
  )
    throw Error("Frozen input changed: " + file);
const dir = resolve(root, "artifacts/v0.6.6-development/evaluation");
await mkdir(dir, { recursive: true });
const lock = await open(resolve(dir, "budget.lock"), "wx");
const ledgerPath = resolve(dir, "budget.json");
const persist = async (value) => {
  await writeFile(ledgerPath + ".tmp", JSON.stringify(value, null, 2) + "\n");
  await rename(ledgerPath + ".tmp", ledgerPath);
};
try {
  const protocol = JSON.parse(
    await readFile(resolve(root, "evals/v0.6.6/protocol.json"), "utf8"),
  );
  const ledger = JSON.parse(
    await readFile(ledgerPath, "utf8").catch((e) => {
      if (e.code === "ENOENT")
        return '{"version":1,"spentAttempts":0,"spentSeconds":0,"runs":[]}';
      throw e;
    }),
  );
  const report = `remote-new-40-${Date.now()}-${randomUUID().slice(0, 8)}.json`;
  const reservation = reserveBudget(ledger, protocol, report);
  const { attempts, seconds } = reservation;
  await persist(reservation.ledger);
  console.log(
    `Synthetic data only; remaining cumulative budget: ${attempts} HTTP attempts / ${seconds}s. No Keychain reads by runner/evaluator.`,
  );
  const started = Date.now();
  const code = await new Promise((done, reject) => {
    const child = spawn(
      resolve(homedir(), ".cargo/bin/cargo"),
      [
        "test",
        "--locked",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--lib",
        "evaluation_v066::remote_quality_matrix",
        "--",
        "--ignored",
        "--exact",
        "--nocapture",
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          INKSTONE_066_REMAINING_ATTEMPTS: String(attempts),
          INKSTONE_066_REMAINING_SECONDS: String(seconds),
          INKSTONE_066_REPORT_NAME: report,
          ...(selectedCaseIds.length
            ? { INKSTONE_066_CASE_IDS: selectedCaseIds.join(",") }
            : {}),
        },
      },
    );
    const timer = setTimeout(() => child.kill("SIGTERM"), seconds * 1000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      done(code ?? 1);
    });
  });
  const result = JSON.parse(
    await readFile(resolve(dir, report), "utf8").catch(() => "null"),
  );
  const finalLedger = settleBudget(
    reservation,
    result,
    (Date.now() - started) / 1000,
  );
  await persist(finalLedger);
  console.log(
    `Cumulative charged attempts: ${finalLedger.spentAttempts}/${protocol.maxHttpAttemptsAcrossRuns}; report: ${report}`,
  );
  if (code !== 0)
    throw Error(
      "Evaluation failed or stopped; retained report is not a quality pass",
    );
} finally {
  await lock.close();
  await rm(resolve(dir, "budget.lock"));
}
