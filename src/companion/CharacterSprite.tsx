import MotuanSprite, { type MotuanMood } from "./MotuanSprite";
import type { CharacterId } from "./types";
import "./character-sprites.css";

interface SpriteProps {
  role: CharacterId;
  outfit: number;
  mood: MotuanMood;
  animate: boolean;
}

// Each cluster uses the same 48-unit pixel grid as the cat. The two hair and
// coat silhouettes stay intact when a hand pose or a stage accessory changes.
function YanzhouCoat({ outfit }: { outfit: number }) {
  return (
    <>
      <path fill="#34473d" d="M17 24h14v2h4v3h2v9h-2v3H13v-3h-2v-6h2v-5h4z" />
      <path fill="#718270" d="M16 27h4v8h-2v4h-5v-7h2v-4h1zm13-1h3v2h3v8h-5z" />
      <path fill="#dcd3bc" d="M20 25h9v3h-2v6h-5v-5h-2z" />
      <path
        fill="#475e4f"
        d="M16 30h3v4h-2v5h-3v-4h2zm13-2h2v11h-3v-5h-1v-4z"
      />
      {outfit > 0 && <path fill="#34493c" d="M14 34h3v1h-1v2h-3v-2h1z" />}
      {outfit === 2 && (
        <g data-keepsake="pocket-notebook">
          <path fill="#433f36" d="M12 34h7v8h-7z" />
          <path fill="#ba9170" d="M13 35h5v5h-5z" />
          <path fill="#e9ddbd" d="M13 40h5v1h-5z" />
        </g>
      )}
    </>
  );
}

function ZhiweiCoat({ outfit }: { outfit: number }) {
  return (
    <>
      <path fill="#49585c" d="M19 25h11v2h3v4h2v6h1v4H12v-4h2v-8h2v-2h3z" />
      <path
        fill="#e0d7c5"
        d="M17 27h5v2h-2v5h-2v3h-5v-5h2v-3h2zm10 0h4v2h2v7h-4v-6h-2z"
      />
      <path fill="#819395" d="M21 27h6v3h2v5h-9v-5h1zm-2 9h10v2h3v2H16v-2h3z" />
      <path fill="#ebdfc7" d="M22 26h5v2h-2v2h-1v-2h-2z" />
      <path fill="#826e57" d="M19 34h10v2H19z" />
      {outfit === 2 && (
        <g data-keepsake="worn-shawl">
          <path
            fill="#607777"
            d="M17 26h3v2h5v2h6v-3h2v5h-3v3h-2v-4h-5v-1h-5v4h-2v3h-3v-6h2v-4h2z"
          />
          <path fill="#b2bdac" d="M16 28h2v1h-1v3h-1zm-2 6h2v1h-2z" />
        </g>
      )}
    </>
  );
}

function Face({ mood }: { mood: MotuanMood }) {
  const smiling = mood === "happy" || mood === "milestone";
  const down = mood === "reading" || mood === "resting";
  return (
    <>
      <path
        fill="#c78f75"
        d="M13 14h21v4h2v3h-2v2h-3v2h-4v2h-6v-2h-4v-2h-3v-2h-2v-4h1z"
      />
      <path fill="#efc7a3" d="M15 14h18v7h-2v2h-4v2h-6v-1h-3v-2h-3z" />
      {smiling ? (
        <path
          fill="#443b37"
          d="M17 18h1v-1h2v1h1v1h-2v-1h-1v1h-1zm10 0h1v-1h2v1h1v1h-2v-1h-1v1h-1z"
        />
      ) : down ? (
        <path fill="#443b37" d="M17 19h4v1h-4zm10 0h4v1h-4z" />
      ) : (
        <>
          <path fill="#423b37" d="M17 17h4v4h-3v-3h-1zm10 0h4v1h-1v3h-3z" />
          <path fill="#faf0da" d="M18 17h1v1h-1zm10 0h1v1h-1z" />
        </>
      )}
      <path fill="#d49682" d="M16 21h3v1h-3zm13 0h3v1h-3z" />
      <path
        fill="#965d4e"
        d={smiling ? "M22 22h5v1h-1v1h-3v-1h-1z" : "M23 22h3v1h-3z"}
      />
    </>
  );
}

function Hair({ yanzhou }: { yanzhou: boolean }) {
  return yanzhou ? (
    <g>
      <path
        fill="#363631"
        d="M15 7h2V5h4V4h9v2h3v2h3v3h2v6h-2v4h-2v-3h-2v-4h-3v-2h-3v-2h-2v3h-3v2h-3v2h-4v4h-2v-4h-2v-6h2V9h3z"
      />
      <path
        fill="#575449"
        d="M14 10h3V8h5V6h4v2h-3v2h-3v2h-4v2h-3zm13-3h4v2h3v3h-2v-2h-3V9h-2z"
      />
      <path fill="#777062" d="M18 8h3v1h-3zm10 0h2v1h-2z" />
    </g>
  ) : (
    <g>
      <path
        fill="#443a36"
        d="M12 13v-3h2V7h3V5h5V4h7v1h3v2h3v4h2v7h-2v5h-2v-7h-3v-2h-3v-4h-1v2h-2v2h-4v2h-5v5h-2v2h-2v-7h1z"
      />
      <path
        fill="#69564b"
        d="M15 11V9h3V7h5V6h3v2h-3v2h-4v2h-2v2h-3v-3zm13-4h3v2h2v3h-2v-2h-2z"
      />
      <path fill="#bba383" d="M14 12h2v1h-2zm5-4h3v1h-3z" />
    </g>
  );
}

function CopperBookmark({ engraved }: { engraved: boolean }) {
  return (
    <g
      data-keepsake={engraved ? "engraved-copper-bookmark" : "copper-bookmark"}
    >
      <path fill="#755236" d="M0 0h5v10H3v2H2v-2H0z" />
      <path fill="#deb47a" d="M1 1h3v8H3v1H2V9H1z" />
      {engraved && <path fill="#765437" d="M2 3h2v1H2zm-1 2h2v1H1z" />}
    </g>
  );
}

function LeafClip() {
  return (
    <g data-keepsake="leaf-clip">
      <path fill="#40584b" d="M0 4h1V2h2V1h3V0h2v4H7v2H5v1H2v2H0z" />
      <path fill="#a9b995" d="M1 4h2V3h2V2h2v2H5v1H4v1H2V5H1z" />
    </g>
  );
}

function OpenBook() {
  return (
    <g data-prop="open-book">
      <path
        fill="#5b5345"
        d="M13 31h7v1h4v1h1v-1h3v-1h7v8h-7v1h-3v1h-2v-1h-4v-1h-6z"
      />
      <path
        fill="#f3e5c4"
        d="M14 32h6v1h3v5h-3v-1h-6zm12 2h3v-2h5v5h-6v1h-2z"
      />
      <path fill="#ac9e84" d="M15 34h4v1h-4zm14 0h4v1h-4z" />
      <path fill="#d3a488" d="M12 34h3v3h-3zm21 0h3v3h-3z" />
    </g>
  );
}

export default function CharacterSprite({
  role,
  outfit,
  mood,
  animate,
}: SpriteProps) {
  if (role === "motuan") return <MotuanSprite {...{ outfit, mood, animate }} />;
  const yanzhou = role === "yanzhou";
  const greeting = mood === "happy" || mood === "held";
  const presenting = mood === "ready" || mood === "milestone";
  return (
    <svg
      className="human-sprite"
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-companion-sprite={role}
      data-state={mood}
      data-motion={animate ? "gentle" : "static"}
    >
      <ellipse cx="24" cy="43" rx="17" ry="2.6" fill="#707565" opacity=".14" />
      <path d="M9 43q8-2 15-1t15 1q-12 2-28 1Z" fill="#646c61" opacity=".22" />
      <g className="human-sprite-body" shapeRendering="crispEdges">
        {!yanzhou && (
          <g>
            <path
              fill="#433a36"
              d="M12 17h7v4h-2v6h1v6h-2v4h-3v3H8v-2h3v-4H9v-6h2v-5h-1v-4h2z"
            />
            <path
              fill="#70574a"
              d="M13 23h2v6h-2v5h-2v-6h2zm3 9h1v3h-2v-2h1z"
            />
            <path fill="#ac765e" d="M10 21h6v2h-6z" />
          </g>
        )}
        <path fill="#393e3b" d="M16 36h16v6h2v2h-9v-5h-2v5h-9v-2h2z" />
        {yanzhou ? (
          <YanzhouCoat outfit={outfit} />
        ) : (
          <ZhiweiCoat outfit={outfit} />
        )}
        <Face mood={mood} />
        <Hair yanzhou={yanzhou} />
        {greeting && (
          <g className="human-sprite-wave">
            <path
              fill={yanzhou ? "#647966" : "#d6cbb9"}
              d="M31 29h4v-3h3v-4h4v7h-2v3h-3v2h-5z"
            />
            <path fill="#eac2a2" d="M37 21h1v-3h2v2h2v-1h1v5h-2v2h-4z" />
          </g>
        )}
        {mood === "reading" && <OpenBook />}
        {presenting && (
          <g className="human-sprite-offer" data-prop="offered-page">
            <path
              fill={yanzhou ? "#627662" : "#d0c5b4"}
              d="M31 30h3v-2h5v6h-4v2h-4z"
            />
            <path fill="#8e8069" d="M35 20h7v1h2v12h-9z" />
            <path fill="#f2e6c8" d="M36 21h5v2h2v9h-7z" />
            <path fill="#a49b88" d="M37 25h5v1h-5zm0 3h3v1h-3z" />
            <path fill="#d5a588" d="M33 29h4v3h-4z" />
          </g>
        )}
        {yanzhou ? (
          <g transform={presenting ? "translate(39 17)" : "translate(28 30)"}>
            <CopperBookmark engraved={outfit > 0} />
          </g>
        ) : (
          <>
            {mood !== "reading" && !presenting && (
              <g data-keepsake="folded-notes">
                <path fill="#89775b" d="M18 31h11v9H18z" />
                <path fill="#e7d7b5" d="M19 32h9v7h-9z" />
                <path fill="#ab9778" d="M25 32h3v3h-1v-1h-2z" />
                {outfit > 0 && (
                  <path fill="#936d5d" d="M20 35h5v1h-5zm0 2h3v1h-3z" />
                )}
              </g>
            )}
            <g
              transform={
                presenting
                  ? "translate(37 17)"
                  : outfit === 0
                    ? "translate(14 26)"
                    : "translate(24 29)"
              }
            >
              <LeafClip />
            </g>
          </>
        )}
        {mood === "milestone" && (
          <path
            fill="#b49453"
            d="M7 10h2v3h3v2H9v3H7v-3H4v-2h3zm31-4h1v2h2v1h-2v2h-1V9h-2V8h2z"
          />
        )}
      </g>
    </svg>
  );
}
