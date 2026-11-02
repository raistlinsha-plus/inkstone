import { build, loadConfigFromFile } from "vite";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";

// Exercise the browser-targeted bundle without a DOM, just like a real Worker.
const loaded = await loadConfigFromFile({ command: "build", mode: "test" });
const result = await build({
  ...loaded.config,
  configFile: false,
  plugins: [],
  logLevel: "error",
  build: {
    write: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: "src/parser.worker.ts",
      formats: ["iife"],
      name: "InkstoneParser",
    },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
let response;
const self = {
  postMessage: (value) => {
    response = value;
  },
};
runInNewContext(output.find((file) => file.type === "chunk").code, {
  self,
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
});
self.onmessage({
  data: {
    id: 7,
    content: "# 中文 &amp; 标题\n\n本机资料解析测试。",
    markdown: true,
    max: 128,
  },
});
assert.equal(response.id, 7);
assert.equal(response.error, undefined);
assert.ok(response.chunks[0].heading.includes("中文 & 标题"));
assert.ok(response.chunks[0].text.includes("本机资料解析测试"));
self.onmessage({
  data: {
    id: 8,
    path: "季度图表.md",
    markdown: true,
    max: 128,
    content:
      "# 季度数据\n\n```chart\n" +
      JSON.stringify({
        schemaVersion: 1,
        type: "bar",
        title: "季度收入",
        x: { label: "季度", values: ["Q1", "Q2"] },
        y: { label: "收入", unit: "万元" },
        series: [{ name: "收入", values: [120, 150] }],
      }) +
      "\n```\n",
  },
});
assert.equal(response.id, 8);
assert.equal(response.error, undefined);
assert.ok(
  response.chunks.some(
    (chunk) =>
      chunk.text.includes("Q2") &&
      chunk.text.includes("收入") &&
      chunk.text.includes("150"),
  ),
);
assert.ok(
  response.chunks.every((chunk) => Array.from(chunk.text).length <= 128),
);
console.log("Browser Worker bundle passed without document/window.");
