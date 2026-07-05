import React from "react";

type Align = "left" | "right" | "lower" | "lower-left";

// Dark legibility scrim, weighted toward the plate's calm zone (matches the Flux prompts).
const SCRIM: Record<Align, string> = {
  left: "linear-gradient(to right, rgba(13,27,42,.9) 0%, rgba(13,27,42,.5) 30%, transparent 58%)",
  right: "linear-gradient(to left, rgba(13,27,42,.9) 0%, rgba(13,27,42,.5) 30%, transparent 58%)",
  lower: "linear-gradient(to top, rgba(13,27,42,.92) 0%, rgba(13,27,42,.4) 32%, transparent 56%)",
  "lower-left": "radial-gradient(130% 130% at 0% 100%, rgba(13,27,42,.92) 0%, rgba(13,27,42,.5) 34%, transparent 62%)"
};

const POS: Record<Align, React.CSSProperties> = {
  left: { left: "5%", top: "50%", transform: "translateY(-50%)", textAlign: "left" },
  right: { right: "6%", top: "50%", transform: "translateY(-50%)", textAlign: "right" },
  lower: { left: "5%", bottom: "10%", textAlign: "left" },
  "lower-left": { left: "5%", bottom: "12%", textAlign: "left" }
};

const SR_ONLY: React.CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", margin: -1 };

/** Hero banner behind/above a section. `masthead` renders the plate with its baked wordmark
 *  and a screen-reader-only heading; otherwise the heading is overlaid in uniform bold mono. */
export function SectionHero({ image, heading, color = "#ffffff", align = "left", masthead = false }: {
  image: string; heading: string; color?: string; align?: Align; masthead?: boolean;
}) {
  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "2.5 / 1", marginBottom: "0.75rem", marginTop: masthead ? 0 : "1.5rem",
      borderRadius: 8, overflow: "hidden", background: `#0d1b2a url(${image}) center/cover no-repeat`,
      border: "1px solid #ffffff14"
    }}>
      {masthead ? (
        <h1 style={SR_ONLY}>{heading}</h1>
      ) : (
        <>
          <div style={{ position: "absolute", inset: 0, background: SCRIM[align] }} />
          <h2 style={{
            position: "absolute", margin: 0, color, fontFamily: "monospace", fontWeight: 700,
            fontSize: "clamp(1rem, 3.4vw, 1.7rem)", letterSpacing: "0.08em", textTransform: "uppercase",
            textShadow: "0 2px 12px rgba(0,0,0,.75)", maxWidth: "62%", lineHeight: 1.15, ...POS[align]
          }}>{heading}</h2>
        </>
      )}
    </div>
  );
}
