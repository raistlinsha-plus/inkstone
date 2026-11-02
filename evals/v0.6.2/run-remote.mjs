// Explicit wrapper around the existing real-service retrieval evaluator.
// It selects a frozen split, verifies input hashes and preserves the result
// under this version. It never fetches the production Keychain credentials.
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2),
  split = args[args.indexOf("--split") + 1];
if (
  !args.includes("--run") ||
  !["calibration", "heldout"].includes(split) ||
  args.length !== 3
) {
  throw Error(
    "Explicit API use: node evals/v0.6.2/run-remote.mjs --split calibration|heldout --run",
  );
}
if (
  !process.env.INKSTONE_EVAL_BASE_URL ||
  !process.env.INKSTONE_EVAL_EMBEDDING_MODEL
) {
  throw Error(
    "Set explicit INKSTONE_EVAL_BASE_URL and INKSTONE_EVAL_EMBEDDING_MODEL. API key and reranker are optional environment inputs; no Keychain is read.",
  );
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
const fixtures = resolve(root, "evals/v0.6.2"),
  manifest = JSON.parse(
    await readFile(resolve(fixtures, "manifest.json"), "utf8"),
  );
for (const [name, expected] of Object.entries(manifest.files)) {
  if (hash(await readFile(resolve(fixtures, name))) !== expected)
    throw Error("Frozen corpus/protocol hash differs: " + name);
}
const out = resolve(root, "artifacts/v0.6.2-development/evaluation");
if (split === "heldout") {
  const frozen = JSON.parse(
    await readFile(resolve(out, "frozen-targets.json"), "utf8"),
  );
  if (frozen.corpusHash !== manifest.files["corpus.json"])
    throw Error(
      "Run the local calibration/freeze evaluation before any heldout remote run.",
    );
}
const target = resolve(fixtures, split + ".json");
await new Promise((resolveDone, reject) => {
  const child = spawn(
    resolve(homedir(), ".cargo/bin/cargo"),
    [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--lib",
      "evaluation::remote_hundred_question_retrieval",
      "--",
      "--ignored",
      "--exact",
      "--nocapture",
    ],
    {
      cwd: root,
      env: { ...process.env, INKSTONE_EVAL_CORPUS: target },
      stdio: "inherit",
    },
  );
  child.on("error", () =>
    reject(Error("Unable to start explicit remote evaluator")),
  );
  child.on("exit", (code) =>
    code === 0
      ? resolveDone()
      : reject(
          Error(
            "Remote evaluator failed; no passing remote quality result was recorded",
          ),
        ),
  );
});
await mkdir(out, { recursive: true });
const original = resolve(
  root,
  "artifacts/v0.5-development/retrieval-remote-100.json",
);
await copyFile(original, resolve(out, "remote-" + split + ".json"));
const report = JSON.parse(await readFile(original, "utf8"));
await writeFile(
  resolve(out, "remote-" + split + "-provenance.json"),
  JSON.stringify(
    {
      split,
      caseCount: manifest.splits[split],
      fileHash: manifest.files[split + ".json"],
      combinedCorpusHash: manifest.files["corpus.json"],
      actualCases: report.corpusCaseCount,
      actualEmbeddingModel: report.embeddingModel,
      actualRerankStatus: report.rerankerStatus,
      keychainAccessed: false,
      answerGenerationRun: false,
      latencyScope:
        "Embedding batch wall time and per-query rerank only; not online embedding or end-to-end generation latency",
      manualReviewRequired: true,
    },
    null,
    2,
  ) + "\n",
);
if (report.corpusCaseCount !== manifest.splits[split])
  throw Error("Evaluator case count differs; inspect retained report.");
console.log("Saved explicit remote retrieval result for split:", split);
