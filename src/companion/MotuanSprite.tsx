export type MotuanMood =
  | "idle"
  | "reading"
  | "milestone"
  | "happy"
  | "held"
  | "landing"
  | "resting"
  | "ready";

export default function MotuanSprite({
  mood,
  outfit,
  animate,
}: {
  mood: MotuanMood;
  outfit: number;
  animate: boolean;
}) {
  return (
    <svg
      className="motuan-sprite"
      data-companion-sprite="motuan"
      data-state={mood}
      data-motion={animate ? "gentle" : "static"}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="41" rx="18" ry="3" fill="#818b77" opacity=".14" />
      <path
        d="M5 41q10-2 18-1t18 0q-7 3-18 2T5 41Z"
        fill="#65795e"
        opacity=".24"
      />
      <g className="motuan-sprite-body" shapeRendering="crispEdges">
        <path fill="#39483e" d="M30 32h4v3h4v-3h2v-5h3v-2h2v8h-2v4h-4v2h-9Z" />
        <path fill="#2c3932" d="M16 27h15v2h4v7h2v4H12v-4h2v-7h2Z" />
        <path fill="#536354" d="M17 31h13v6H17zm-4 6h4v3h-4zm17 0h4v3h-4z" />
        <path
          fill="#303d35"
          d="M10 12h3v2h3v2h13v-2h3v-3h4v10h2v7h-2v3h-3v2H14v-2h-4v-4H8v-6h2Z"
        />
        <path fill="#586b56" d="M12 16h2v3h-2zm21-1h2v4h-2zM11 26h3v3h-3z" />
        {(mood === "idle" ||
          mood === "landing" ||
          mood === "held" ||
          mood === "ready") && (
          <path
            className="motuan-open-eyes"
            fill="#f2d895"
            d="M15 22h3v3h-3zm13 0h3v3h-3z"
          />
        )}
        {(mood === "reading" || mood === "resting" || mood === "happy") && (
          <path fill="#f2d895" d="M14 23h5v2h-5zm13 0h5v2h-5z" />
        )}
        {mood === "idle" && (
          <path
            className="motuan-closed-eyes"
            fill="#f2d895"
            d="M14 23h5v2h-5zm13 0h5v2h-5z"
          />
        )}
        {mood === "happy" && (
          <path fill="#cc9b81" d="M12 26h4v2h-4zm19 0h4v2h-4z" />
        )}
        {mood === "milestone" && (
          <>
            <path
              fill="#f2d895"
              d="M14 23h2v-2h2v2h2v2h-2v-2h-2v2h-2zm13 0h2v-2h2v2h2v2h-2v-2h-2v2h-2z"
            />
            <path fill="#cc9b81" d="M12 26h4v1h-4zm19 0h4v1h-4z" />
          </>
        )}
        <path fill="#eadac4" d="M22 26h3v1h-1v1h-1v-1h-1Z" />
        <path fill="#e7dcc5" d="M13 38h4v2h-4zm17 0h3v2h-3z" />
        {outfit > 0 && (
          <path fill="#99a686" d="M13 18h3v1h2v2h-2v-1h-2v-1h-1z" />
        )}
        {outfit === 2 && (
          <g data-keepsake="bookmark-box">
            <path fill="#685747" d="M1 34h11v7H1z" />
            <path fill="#b08e68" d="M2 35h9v4H2z" />
            <path fill="#e6d3ac" d="M2 33h7v2H2z" />
          </g>
        )}
        {mood === "reading" && (
          <g>
            <path fill="#7e805c" d="M13 34h7v2h6v-2h7v7h-8v2h-4v-2h-8Z" />
            <path
              fill="#e7d8ad"
              d="M14 35h6v2h3v4h-3v-1h-6zm11 2h2v-2h5v5h-5v1h-2z"
            />
          </g>
        )}
        {(outfit > 0 || mood === "ready" || mood === "milestone") && (
          <g
            transform={
              mood === "ready" || mood === "milestone"
                ? "translate(30 24)"
                : "translate(6 28)"
            }
            data-keepsake={outfit > 0 ? "leaf-bookmark" : "blank-bookmark"}
          >
            <path fill="#807958" d="M0 0h8v12H5v2H3v-2H0z" />
            <path fill="#eaddb1" d="M1 1h6v10H5v1H3v-1H1z" />
            {outfit > 0 && (
              <path fill="#688061" d="M2 5h1V4h2V3h1v4H5v1H3v2H2z" />
            )}
            <path fill="#f0e7d1" d="M6 9h4v3H6z" />
          </g>
        )}
      </g>
      {mood === "milestone" && (
        <path
          className="motuan-sprite-celebrate"
          fill="#ad8849"
          shapeRendering="crispEdges"
          d="M7 7h1v3h3v1H8v3H7v-3H4v-1h3zm31-4h2v3h3v2h-3v3h-2V8h-3V6h3z"
        />
      )}
    </svg>
  );
}
