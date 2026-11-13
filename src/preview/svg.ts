import DOMPurify from "dompurify";
import { lightGraphExport, previewColors } from "./theme";

/** Export plain text labels as native SVG so XML viewers keep Markmap labels. */
export function serializeSvg(svg: SVGElement): string {
  const copy = svg.cloneNode(true) as SVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", "1200");
  copy.setAttribute("height", "760");
  copy.style.width = "1200px";
  copy.style.height = "760px";
  copy.style.background = lightGraphExport;
  copy.style.removeProperty("--markmap-branch");
  copy.style.removeProperty("--markmap-text-color");
  copy.style.removeProperty("--markmap-circle-open-bg");
  for (const property of ["fill", "stroke"]) {
    for (const element of copy.querySelectorAll(
      `[${property}="var(--markmap-branch)"]`,
    )) {
      element.setAttribute(property, previewColors.light.branch);
    }
  }
  for (const element of copy.querySelectorAll(
    '[fill="var(--markmap-circle-open-bg)"]',
  )) {
    element.setAttribute("fill", lightGraphExport);
  }
  const paper = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const box = copy
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box.every(Number.isFinite)) {
    paper.setAttribute("x", String(box[0]));
    paper.setAttribute("y", String(box[1]));
    paper.setAttribute("width", String(box[2]));
    paper.setAttribute("height", String(box[3]));
  } else {
    paper.setAttribute("width", "100%");
    paper.setAttribute("height", "100%");
  }
  paper.setAttribute("fill", lightGraphExport);
  copy.prepend(paper);
  for (const foreign of copy.querySelectorAll("foreignObject")) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", foreign.getAttribute("x") ?? "0");
    text.setAttribute("y", String(Number(foreign.getAttribute("y") ?? 0) + 16));
    text.setAttribute("fill", "#203a30");
    text.setAttribute("font-family", "sans-serif");
    text.setAttribute("font-size", "16");
    text.textContent = foreign.textContent ?? "";
    foreign.replaceWith(text);
  }
  return DOMPurify.sanitize(new XMLSerializer().serializeToString(copy), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      "script",
      "iframe",
      "foreignObject",
      "image",
      "img",
      "a",
      "use",
    ],
    FORBID_ATTR: ["href", "xlink:href", "src"],
  });
}
