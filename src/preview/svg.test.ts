// @vitest-environment jsdom
import { expect, test } from "vitest";
import { serializeSvg } from "./svg";

test("export retains Markmap labels as SVG text and removes active content", () => {
  const root = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg"><g><foreignObject x="8" y="0" width="90" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><div>Markdown 中文 &amp; JSON</div></div></foreignObject></g><script>alert(1)</script><image href="https://example.com/tracker"/><a href="javascript:alert(1)"><text>link</text></a></svg>`,
    "image/svg+xml",
  ).documentElement as unknown as SVGElement;
  const output = serializeSvg(root);
  const doc = new DOMParser().parseFromString(output, "image/svg+xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  expect(doc.querySelector("text")?.textContent).toBe("Markdown 中文 & JSON");
  expect(doc.querySelector("text")?.getAttribute("y")).toBe("16");
  expect(doc.querySelector("svg > rect")?.getAttribute("fill")).toBe("#fffefa");
  expect(doc.querySelector("script, foreignObject, image, a")).toBeNull();
  expect(root.querySelector("foreignObject")).not.toBeNull();
});
