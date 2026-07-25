import { ImageResponse } from "next/og";

// Social preview for the landing page. WhatsApp, the main sharing channel for
// teachers and families, renders this inline in the chat, so the promise has to
// be readable at thumbnail size: short line, high contrast, no fine print.

export const alt =
  "AImauta — No hace tu tarea. Te ayuda a entenderla.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          background: "linear-gradient(128deg, #123F39 0%, #174F46 53%, #1D5D50 100%)",
          color: "#FDFCF5",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 28,
              background: "#F5EAD4",
              color: "#174F46",
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            A
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
            AImauta
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              fontWeight: 600,
              letterSpacing: -3,
              lineHeight: 1.05,
            }}
          >
            No hace tu tarea.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              fontWeight: 600,
              fontStyle: "italic",
              letterSpacing: -3,
              lineHeight: 1.05,
              color: "#D9ED8D",
            }}
          >
            Te ayuda a entenderla.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            paddingTop: 28,
            borderTop: "1px solid rgba(255,255,255,0.18)",
            fontFamily: "system-ui, sans-serif",
            fontSize: 25,
            color: "rgba(255,255,255,0.78)",
          }}
        >
          <div style={{ display: "flex" }}>
            Tutoría guiada sobre materiales oficiales
          </div>
          <div style={{ display: "flex", color: "#D9ED8D" }}>·</div>
          <div style={{ display: "flex" }}>Cada pista muestra su fuente</div>
        </div>
      </div>
    ),
    size,
  );
}
