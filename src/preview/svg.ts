import DOMPurify from "dompurify";

/** Export plain text labels as native SVG so XML viewers keep Markmap labels. */
export function serializeSvg(svg: SVGElement): string {
  const copy = svg.cloneNode(true) as SVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", "1200");
  copy.setAttribute("height", "760");
  copy.style.width = "1200px";
  copy.style.height = "760px";
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
