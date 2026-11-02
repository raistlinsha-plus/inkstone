import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "Inkstone项目");
const manifestPath = join(target, ".inkstone-doc-sync.json");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check")) {
  throw new Error("仅支持 --check；默认同步到仓库中的 Inkstone项目 目录。");
}
const check = args.includes("--check");
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function optionalRead(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function optionalDirectory(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
const oldBytes = await optionalRead(manifestPath);
const previous = oldBytes ? JSON.parse(oldBytes.toString()) : { files: {} };
if (oldBytes && previous.version !== 1) throw new Error("同步清单版本不支持。");
const mappings = [
  ["docs/INKSTONE-PROJECT.md", "00-项目导航.md"],
  ["README.md", "01-使用与运行说明.md"],
  ["docs/PROJECT.md", "02-项目范围与架构.md"],
  ["VALIDATION.md", "03-v0.1验收记录.md"],
  ["REVIEW-v0.1.md", "04-v0.1审查报告.md"],
  ["docs/NEXT-v0.2.md", "05-v0.2内容方案.md"],
  ["docs/ACCEPTANCE-v0.2.md", "06-v0.2验收清单.md"],
  ["docs/EDITOR-EXAMPLES.md", "07-v0.2内容样例.md"],
  ["THIRD_PARTY_NOTICES.md", "08-第三方许可声明.md"],
  ["LICENSE", "09-项目许可证.txt"],
  ["examples/项目计划.md", "10-首版项目计划.md"],
  ["docs/RELEASE-v0.2.md", "11-v0.2交付说明.md"],
  ["docs/VALIDATION-v0.2.md", "12-v0.2实测记录.md"],
  ["REVIEW-v0.2.md", "13-v0.2整体审查.md"],
  ["docs/NEXT-v0.3.md", "14-v0.3正文与文档库方案.md"],
  ["docs/RELEASE-v0.3.md", "15-v0.3交付说明.md"],
  ["docs/VALIDATION-v0.3.md", "16-v0.3实测记录.md"],
  ["docs/ACCEPTANCE-v0.3.md", "17-v0.3验收清单.md"],
  ["REVIEW-v0.3.md", "18-v0.3体验与检索审查.md"],
  ["docs/NEXT-v0.4.md", "19-v0.4日程与可信检索方案.md"],
  ["docs/RELEASE-v0.4.md", "20-v0.4交付说明.md"],
  ["docs/VALIDATION-v0.4.md", "21-v0.4实测记录.md"],
  ["docs/ACCEPTANCE-v0.4.md", "22-v0.4验收清单.md"],
  ["docs/CALENDAR-FORMAT.md", "23-日程格式与迁移.md"],
  ["REVIEW-v0.4.md", "24-v0.4整体审查.md"],
  ["docs/NEXT-v0.5-2026-10-27.md", "25-v0.5写作与检索方案.md"],
  ["docs/RELEASE-v0.4.1.md", "26-v0.4.1修复说明.md"],
  ["docs/VALIDATION-v0.4.1.md", "27-v0.4.1验收记录.md"],
  ["REVIEW-v0.4.1.md", "28-v0.4.1整体审查.md"],
  ["docs/NEXT-v0.5.md", "29-v0.5富内容问答与图表方案.md"],
  ["docs/RELEASE-v0.5.md", "30-v0.5交付说明.md"],
  ["docs/VALIDATION-v0.5.md", "31-v0.5验收记录.md"],
  ["docs/ACCEPTANCE-v0.5.md", "32-v0.5验收清单.md"],
  ["docs/CHART-FORMAT.md", "33-数据图表格式.md"],
  ["evals/v0.5/README.md", "34-v0.5中文检索评测.md"],
  ["docs/COMPANION-DESIGN.md", "35-角色陪伴与成长方案.md"],
  ["docs/EXPERIENCE-ROADMAP.md", "36-后续版本体验与知识空间改进计划.md"],
  ["docs/ARCHITECTURE-4A.md", "现状文档/41-4A架构说明.md"],
  ["docs/TECH-STACK.md", "现状文档/42-技术栈说明.md"],
  ["docs/PRODUCT.md", "现状文档/43-产品说明.md"],
  ["CHANGELOG.md", "现状文档/44-版本变更日志.md"],
  ["REVIEW-v0.6.md", "现状文档/45-v0.6整体Review.md"],
  ["docs/NEXT-PLAN-v0.6-v0.8.md", "现状文档/46-后续版本计划与实施方案.md"],
  ["docs/PROTOTYPE-v0.7.md", "现状文档/47-v0.7详细原型与交互规格.md"],
  ["docs/DELIVERY-v0.6.2.md", "现状文档/48-v0.6.2交付与验收.md"],
  ["docs/DELIVERY-v0.6.3.md", "现状文档/52-v0.6.3交付与验收.md"],
  ["docs/DEVELOPMENT.md", "现状文档/53-开发与验证工作流.md"],
  ["docs/DELIVERY-v0.6.4.md", "现状文档/54-v0.6.4交付与验收.md"],
  ["docs/DELIVERY-v0.6.5.md", "现状文档/55-v0.6.5交付与验收.md"],
  ["docs/GITHUB-READINESS-v0.6.5.md", "现状文档/56-GitHub公开准备评估.md"],
  ["CONTRIBUTING.md", "现状文档/57-贡献指南.md"],
  ["SECURITY.md", "现状文档/58-安全与漏洞报告.md"],
  ["docs/DELIVERY-v0.6.6.md", "现状文档/59-v0.6.6交付与首发.md"],
  ["docs/PUBLIC-RELEASE-v0.6.6.md", "现状文档/60-GitHub源码首发说明.md"],
  ["examples/v0.6.6/首发体验.md", "示例/v0.6.6/首发体验.md"],
  ["evals/v0.6.6/README.md", "评测/v0.6.6/README.md"],
  ["evals/v0.6.6/RESULTS.md", "评测/v0.6.6/RESULTS.md"],
  ["examples/v0.6.4/编辑体验验收.md", "示例/v0.6.4/编辑体验验收.md"],
  ["evals/v0.6.2/README.md", "现状文档/49-v0.6.2检索评测说明.md"],
  ["docs/TESTING-DESKTOP.md", "现状文档/50-桌面驱动隔离接入说明.md"],
  ["evals/v0.6.2/RESULTS.md", "现状文档/51-v0.6.2检索评测结果.md"],
  ["docs/RELEASE-v0.6.md", "37-v0.6交付说明.md"],
  ["docs/VALIDATION-v0.6.md", "38-v0.6验收记录.md"],
  ["artifacts/v0.6-development/ANSWER-REVIEW.md", "39-v0.6真实问答审阅.md"],
  ["artifacts/v0.6-development/PROMPT-RETEST.md", "40-v0.6来源提示复测.md"],
  [
    "artifacts/v0.6-development/answer-review-prompt-retest-reviewed.json",
    "评测/v0.6/answer-review-prompt-retest-reviewed.json",
  ],
  ["examples/v0.6/排版与组件验收.md", "示例/v0.6/排版与组件验收.md"],
  ["evals/v0.6/answer-review.json", "评测/v0.6/answer-review.json"],
  [
    "artifacts/v0.6-development/answer-review-remote.json",
    "评测/v0.6/answer-review-remote.json",
  ],
  [
    "artifacts/v0.6-development/answer-review-reviewed.json",
    "评测/v0.6/answer-review-reviewed.json",
  ],
  [
    "artifacts/v0.6-development/answer-review-prompt-retest.json",
    "评测/v0.6/answer-review-prompt-retest.json",
  ],

  ["evals/v0.5/natural-chinese.json", "评测/v0.5/natural-chinese.json"],
  [
    "artifacts/v0.5-development/retrieval-remote-100.json",
    "评测/v0.5/retrieval-remote-100.json",
  ],
  [
    "artifacts/v0.5-development/v0.5-natural-chinese-bm25.json",
    "评测/v0.5/bm25-natural-chinese.json",
  ],
  ["examples/v0.5/富内容与图表验收.md", "示例/v0.5/富内容与图表验收.md"],
  ["examples/v0.5/季度数据.md", "示例/v0.5/季度数据.md"],
  ["examples/v0.4.1/编辑器回归验收.md", "示例/v0.4.1/编辑器回归验收.md"],
  ["examples/v0.4/日程与周计划.md", "示例/v0.4/日程与周计划.md"],
  ["examples/v0.3/正文内容块演示.md", "示例/v0.3/正文内容块演示.md"],
];
for (const name of [
  "01-list-alignment.png",
  "02-json-spacing.png",
  "03-chart-insets.png",
  "04-document-list.png",
  "05-toolbar.png",
  "06-retrieval-overlap.png",
]) {
  mappings.push([
    `docs/assets/platform-polish-2026-10-29/${name}`,
    `assets/platform-polish-2026-10-29/${name}`,
  ]);
}
const screenshotDir = "artifacts/review-2026-10-25";
for (const name of (
  await optionalDirectory(join(root, screenshotDir))
).sort()) {
  if (/^\d[^/]*\.png$/.test(name)) {
    mappings.push([`${screenshotDir}/${name}`, `assets/review/${name}`]);
  }
}

for (const name of (await readdir(join(root, "examples/v0.2"))).sort()) {
  if (/\.(md|mmd|json)$/.test(name))
    mappings.push([`examples/v0.2/${name}`, `示例/${name}`]);
}
for (const name of [
  "json-desktop.png",
  "markdown-desktop.png",
  "mermaid-desktop.png",
  "mindmap-desktop.png",
]) {
  mappings.push([
    `artifacts/v0.2-development/screenshots/${name}`,
    `assets/v0.2/${name}`,
  ]);
}

const v02ReviewDir = "artifacts/review-v0.2-2026-10-25/screenshots";
for (const name of (await optionalDirectory(join(root, v02ReviewDir))).sort()) {
  if (/^\d[^/]*\.png$/.test(name))
    mappings.push([`${v02ReviewDir}/${name}`, `assets/review-v0.2/${name}`]);
}

for (const name of [
  "inline-json-desktop.png",
  "inline-mindmap-desktop.png",
  "imported-attachment-independent.png",
  "ime-composition.png",
]) {
  mappings.push([
    `artifacts/v0.3-development/screenshots/${name}`,
    `assets/v0.3/${name}`,
  ]);
}

const v03ReviewDir = "artifacts/review-v0.3-2026-10-26/screenshots";
for (const name of (await optionalDirectory(join(root, v03ReviewDir))).sort()) {
  if (/^\d[^/]*\.png$/.test(name))
    mappings.push([`${v03ReviewDir}/${name}`, `assets/review-v0.3/${name}`]);
}
mappings.push([
  "artifacts/v0.4-development/screenshots/calendar-browser.png",
  "assets/v0.4/calendar-browser.png",
]);
for (const name of [
  "calendar-native-week.png",
  "calendar-ics-native.png",
  "rag-native-answer.png",
  "rag-native-refusal.png",
  "citation-native-source.png",
]) {
  mappings.push([
    `artifacts/v0.4-development/screenshots/${name}`,
    `assets/v0.4/${name}`,
  ]);
}

// Only synthetic audit screenshots are copied; the native work-document capture stays private.
for (const name of [
  "03-empty-paragraph-before-source.png",
  "04-empty-paragraph-after-roundtrip.png",
  "05-selection-formatting.png",
  "07-standard-code-hidden.png",
  "08-calendar-save-undo.png",
  "09-whole-list-raw-fallback.png",
  "10-mindmap-mermaid.png",
  "11-insert-popovers-overlap.png",
  "12-mindmap-initial.png",
  "13-json-reading.png",
])
  mappings.push([
    `artifacts/review-v0.4-2026-10-27/screenshots/${name}`,
    `assets/review-v0.4/${name}`,
  ]);
for (const name of (
  await optionalDirectory(
    join(root, "artifacts/v0.4.1-development/screenshots"),
  )
).sort()) {
  if (/^\d[^/]*\.png$/.test(name))
    mappings.push([
      `artifacts/v0.4.1-development/screenshots/${name}`,
      `assets/v0.4.1/${name}`,
    ]);
}

for (const name of [
  "01-native-editor.png",
  "02-native-ask.png",
  "03-answer-literal-and-citations.png",
  "04-calendar-visual.png",
  "05-calendar-split.png",
  "06-json-draft-before.png",
  "07-json-draft-after.png",
  "08-editor-roundtrip.png",
])
  mappings.push([
    `artifacts/review-v0.4.1-2026-10-28/screenshots/${name}`,
    `assets/review-v0.4.1/${name}`,
  ]);

for (const name of (
  await optionalDirectory(join(root, "artifacts/v0.5-development/screenshots"))
).sort()) {
  if (/^\d[^/]*\.png$/.test(name))
    mappings.push([
      `artifacts/v0.5-development/screenshots/${name}`,
      `assets/v0.5/${name}`,
    ]);
}

for (const name of [
  "01-editor-1440.png",
  "02-json-spacing.png",
  "03-chart-spacing.png",
  "04-editor-960.png",
  "05-format-overflow.png",
  "07-native-source-preview.png",
  "08-native-history-restored.png",
  "09-native-source-conflict.png",
  "10-native-collapsed.png",
  "11-native-layout.png",
  "12-native-retrieval.png",
  "13-native-structure.png",
  "14-native-chart.png",
  "16-final-cold-launch.png",
  "17-final-created-space.png",
])
  mappings.push([
    `artifacts/v0.6-development/screenshots/${name}`,
    `assets/v0.6/${name}`,
  ]);

for (const name of [
  "editor-polish-metrics.json",
  "upgrade-integrity.json",
  "native-source-results.json",
  "verification-automatic.json",
]) {
  mappings.push([`artifacts/v0.6-development/${name}`, `验收/v0.6/${name}`]);
}
for (const name of [
  "frontend.log",
  "types.log",
  "rust.log",
  "worker.log",
  "build.log",
  "native-system.json",
]) {
  mappings.push([
    `artifacts/v0.6-development/verification/${name}`,
    `验收/v0.6/verification/${name.endsWith(".log") ? name.slice(0, -4) + ".txt" : name}`,
  ]);
}

for (const name of [
  "01-editor.png",
  "02-space-home.png",
  "03-retrieval.png",
  "04-index.png",
]) {
  mappings.push([
    `artifacts/review-v0.6-2026-10-30/screenshots/${name}`,
    `现状文档/assets/review-v0.6/${name}`,
  ]);
}

for (const name of [
  "baseline-bm25-split-report.json",
  "bm25-split-report.json",
  "calibration-baseline.json",
  "frozen-targets.json",
  "post-fix-same-corpus-exploratory.json",
  "baseline-three-case-diagnostics.json",
  "posthoc-three-case-diagnostics.json",
  "post-fix-three-case-diagnostics.json",
])
  mappings.push([`evals/v0.6.2/evidence/${name}`, `评测/v0.6.2/${name}`]);

// Archived evidence is tracked in the document bundle; clean checkouts need not
// contain private, ignored artifact work directories. Its recorded copy hash remains authoritative.
for (const [destination, record] of Object.entries(previous.files)) {
  if (
    record.source.startsWith("artifacts/") &&
    !mappings.some(
      ([source, copy]) => source === record.source || copy === destination,
    )
  )
    mappings.push([record.source, destination]);
}
for (const name of [
  "index.html",
  "index.template.html",
  "prototype.js",
  "prototype.css",
  "build.mjs",
  "check.mjs",
  "story-drafts.json",
  "asset-plan.json",
  "README.md",
  "validation.json",
])
  mappings.push([`prototypes/v0.7/${name}`, `原型/v0.7/${name}`]);
for (const name of [
  "corpus.json",
  "calibration.json",
  "heldout.json",
  "protocol.json",
  "manifest.json",
  "run-remote.mjs",
])
  mappings.push([`evals/v0.6.2/${name}`, `评测/v0.6.2/${name}`]);

for (const name of [
  "07-final-workbench.png",
  "06-final-index-status.png",
  "05-backup-restore-preview.png",
])
  mappings.push([
    `docs/assets/v0.6.2/${name}`,
    `现状文档/assets/v0.6.2/${name}`,
  ]);
mappings.push([
  "artifacts/v0.6.2-development/native-system.json",
  "验收/v0.6.2/native-system.json",
]);

const seenMappings = new Set();
for (let i = 0; i < mappings.length; i++) {
  const key = JSON.stringify(mappings[i]);
  if (seenMappings.has(key)) mappings.splice(i--, 1);
  else seenMappings.add(key);
}
for (const name of await readdir(join(root, "evals/v0.6.5"))) {
  if (/\.(md|json|mjs)$/.test(name))
    mappings.push([`evals/v0.6.5/${name}`, `评测/v0.6.5/${name}`]);
}
for (const name of await readdir(join(root, "evals/v0.6.5/evidence"))) {
  if (name.endsWith(".json"))
    mappings.push([
      `evals/v0.6.5/evidence/${name}`,
      `评测/v0.6.5/evidence/${name}`,
    ]);
}
const copiedPaths = new Map(
  mappings.map(([source, destination]) => [resolve(root, source), destination]),
);
function projectLinks(text, source, destination) {
  return text.replace(
    /(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g,
    (whole, before, href, after) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return whole;
      const suffixAt = href.search(/[?#]/);
      const path = suffixAt < 0 ? href : href.slice(0, suffixAt);
      const suffix = suffixAt < 0 ? "" : href.slice(suffixAt);
      let decoded;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        return whole;
      }
      const copy = copiedPaths.get(resolve(root, dirname(source), decoded));
      if (!copy) return whole;
      const targetPath = relative(dirname(destination), copy)
        .split(sep)
        .join("/");
      if (/\.html$/i.test(copy) && before.startsWith("["))
        return `${before.slice(1, -2)}（\`${targetPath}\`，在 Finder 中打开）`;
      return before + targetPath.replaceAll(" ", "%20") + suffix + after;
    },
  );
}

// Preflight every file before any writes; never overwrite edits made in Inkstone.
const pending = [];
const conflicts = [];
const records = {};
let archived = 0;
for (const [source, destination] of mappings) {
  let sourceBytes = await optionalRead(join(root, source));
  if (!sourceBytes) {
    const prior = previous.files[destination];
    const copy = await optionalRead(join(target, destination));
    if (
      source.startsWith("artifacts/") &&
      prior?.source === source &&
      copy &&
      hash(copy) === prior.copyHash
    ) {
      records[destination] = prior;
      archived++;
      continue;
    }
    throw Error(`原件缺失或归档副本无法校验：${source}`);
  }
  let data =
    source === "REVIEW-v0.1.md"
      ? Buffer.from(
          sourceBytes
            .toString()
            .replaceAll(`${root}/${screenshotDir}/`, "./assets/review/")
            .replace(
              /\/[^)\n]*\/artifacts\/review-2026-10-25\//g,
              "./assets/review/",
            ),
        )
      : source === "REVIEW-v0.2.md"
        ? Buffer.from(
            sourceBytes
              .toString()
              .replaceAll(`${v02ReviewDir}/`, "./assets/review-v0.2/"),
          )
        : source === "REVIEW-v0.3.md"
          ? Buffer.from(
              sourceBytes
                .toString()
                .replaceAll(`${v03ReviewDir}/`, "./assets/review-v0.3/"),
            )
          : source === "README.md"
            ? Buffer.from(
                sourceBytes
                  .toString()
                  .replaceAll(
                    "(docs/RELEASE-v0.3.md)",
                    "(./15-v0.3交付说明.md)",
                  )
                  .replaceAll(
                    "(REVIEW-v0.3.md)",
                    "(./18-v0.3体验与检索审查.md)",
                  )
                  .replaceAll(
                    "(docs/NEXT-v0.4.md)",
                    "(./19-v0.4日程与可信检索方案.md)",
                  )
                  .replaceAll(
                    "(docs/VALIDATION-v0.3.md)",
                    "(./16-v0.3实测记录.md)",
                  ),
              )
            : sourceBytes;
  if (["REVIEW-v0.4.md", "REVIEW-v0.4.1.md"].includes(source)) {
    // The copied project is a document bundle; source-code links stay plain references.
    data = Buffer.from(
      data
        .toString()
        .replace(
          /\[[^\]]+\]\(((?:src|src-tauri)\/[^)]+|artifacts\/[^)]+\.md)\)/g,
          "`$1`",
        ),
    );
  }
  if (/\.md$/i.test(source))
    data = Buffer.from(projectLinks(data.toString(), source, destination));
  const actual = await optionalRead(join(target, destination));
  const currentHash = actual ? hash(actual) : null;
  const wantedHash = hash(data);
  const priorHash = previous.files[destination]?.copyHash;
  if (currentHash && currentHash !== wantedHash && currentHash !== priorHash) {
    conflicts.push(destination);
  }
  records[destination] = {
    source,
    sourceHash: hash(sourceBytes),
    copyHash: wantedHash,
  };
  if (currentHash !== wantedHash) pending.push({ destination, data });
}
if (conflicts.length) {
  console.error(
    "副本已被修改，未写入任何文件。请先人工合并：\n" + conflicts.join("\n"),
  );
  process.exitCode = 1;
} else if (check) {
  console.log(
    pending.length
      ? `待同步 ${pending.length} 个文件。`
      : `全部 ${mappings.length} 个文件与原件一致。`,
  );
  if (pending.length) process.exitCode = 1;
} else {
  async function atomicWrite(path, data) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  }
  for (const { destination, data } of pending) {
    await atomicWrite(join(target, destination), data);
  }
  if (pending.length || !oldBytes) {
    await atomicWrite(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          project: "智能文本工具项目",
          syncedAt: new Date().toISOString(),
          files: records,
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(
    `项目目录：${target}\n更新 ${pending.length} 个文件，共管理 ${mappings.length} 个文件；已有个人文件保留。`,
  );
}

if (archived)
  console.log(
    `历史证据 ${archived} 项按已记录指纹核对归档副本；未视为本轮重新验收。`,
  );
