export type MotuanMood =
  "idle" | "reading" | "milestone" | "happy" | "held" | "landing" | "resting";

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
      <path fill="#f8f3e5" d="M0 0h48v48H0z" />
      <path
        fill="#7c8c6c"
        opacity=".15"
        d="M5 29C0 22 7 11 14 8c6-4 10 0 18-2 8-1 11 4 12 10 2 9-1 13-1 19-2 7-9 9-18 9C16 45 3 41 5 29Z"
      />
      <path
        fill="#a1aa88"
        opacity=".3"
        d="M2 37c5-4 11-2 18-4 9-3 12 4 18 2 5-1 8 0 8 3 0 5-14 5-21 4C14 43 3 42 2 37Z"
      />
      <path
        d="M4 38c8 3 28 3 38 0"
        fill="none"
        stroke="#65795e"
        opacity=".25"
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
        {(mood === "idle" || mood === "landing" || mood === "held") && (
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
        {outfit > 0 && <path fill="#a8b68a" d="M17 31h13v2h-5v4h-3v-4h-5Z" />}
        {outfit === 2 && <path fill="#ebcb79" d="M23 33h2v2h-2z" />}
        {mood === "reading" && (
          <g>
            <path fill="#7e805c" d="M13 34h7v2h6v-2h7v7h-8v2h-4v-2h-8Z" />
            <path
              fill="#e7d8ad"
              d="M14 35h6v2h3v4h-3v-1h-6zm11 2h2v-2h5v5h-5v1h-2z"
            />
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
