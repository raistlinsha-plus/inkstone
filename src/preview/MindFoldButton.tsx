import { translate as t } from "../i18n";
import { diagramFontFamily } from "./theme";
import type { PlacedNode } from "./editableMindLayout";

export default function MindFoldButton({
  box,
  count,
  ink,
  paper,
  onToggle,
}: {
  box: PlacedNode;
  count: number;
  ink: string;
  paper: string;
  onToggle: (id: string) => void;
}) {
  const expanded = box.node.children.length > 0;
  const label = expanded
    ? t("收起分支", "Collapse branch")
    : t(`展开 ${count} 个节点`, `Expand ${count} topics`);
  const width = expanded ? 18 : Math.max(22, String(count).length * 7 + 12);
  const toggle = () => onToggle(box.node.id);
  return (
    <g
      className="mind-fold"
      role="button"
      tabIndex={-1}
      data-open={expanded}
      aria-label={label}
      aria-expanded={expanded}
      transform={`translate(${box.w + 4} ${box.h / 2})`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
    >
      <title>{label}</title>
      <rect x="-3" y="-14" width={width + 6} height="28" fill="transparent" />
      <rect y="-9" width={width} height="18" rx="9" fill={paper} stroke={ink} />
      {expanded ? (
        <path d="M 5 0 H 13" stroke={ink} strokeWidth="1.5" />
      ) : (
        <text
          x={width / 2}
          y="4"
          textAnchor="middle"
          fill={ink}
          fontSize="11"
          fontWeight="600"
          fontFamily={diagramFontFamily}
        >
          {count}
        </text>
      )}
    </g>
  );
}
