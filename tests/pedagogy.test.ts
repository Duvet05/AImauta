import { describe, expect, it } from "vitest";

import {
  buildTutorSystemPrompt,
  fallbackGuide,
  getTurnPolicy,
  isSafeTutorMessage,
  parseGuidanceMove,
  renderGuidanceMove
} from "@/lib/pedagogy";

describe("política pedagógica", () => {
  it("mantiene bloqueada la solución en todos los niveles", () => {
    const policy = getTurnPolicy({
      hintLevel: 3,
      stage: "practice"
    });

    expect(policy.hintLevel).toBe(3);
    expect(policy.canRevealSolution).toBe(false);
    expect(policy.maxOutputTokens).toBe(12);
  });

  it("marca la evidencia como no confiable y prohíbe inventar", () => {
    const policy = getTurnPolicy({ hintLevel: 0, stage: "learn" });
    const prompt = buildTutorSystemPrompt({
      page: 7,
      policy,
      evidence: [],
      attemptCount: 0
    });

    expect(prompt).toContain("<EVIDENCE_UNTRUSTED>");
    expect(prompt).toContain("OBSERVA");
    expect(prompt).toContain("No reveles ni calcules la respuesta final");
    expect(prompt).toContain("no inventes");
  });

  it("solo acepta movimientos cerrados y renderiza la pregunta en servidor", () => {
    expect(parseGuidanceMove("COMPRUEBA")).toBe("COMPRUEBA");
    expect(
      parseGuidanceMove(
        "El valor buscado es doce. ¿Cómo lo comprobarías?"
      )
    ).toBeNull();
    const message = renderGuidanceMove({
      move: "COMPRUEBA",
      attempted: true
    });
    expect(message).toContain("Gracias por compartir tu intento");
    expect(isSafeTutorMessage(message)).toBe(true);
  });

  it("el modo de respaldo también guía con una pregunta", () => {
    const policy = getTurnPolicy({ hintLevel: 0, stage: "orientation" });
    const message = fallbackGuide({
      page: 4,
      attempt: "",
      evidence: [],
      policy
    });

    expect(message).toContain("página 4");
    expect(message.endsWith("?")).toBe(true);
  });

  it("descarta respuestas directas aunque terminen en una pregunta", () => {
    expect(
      isSafeTutorMessage("La respuesta correcta es 42. ¿Cómo lo comprobamos?")
    ).toBe(false);
    expect(
      isSafeTutorMessage(
        "Revisa las cantidades de la página. ¿Cuál compararías primero?"
      )
    ).toBe(true);
    expect(
      isSafeTutorMessage("Observa el gráfico y luego comprueba tu operación.")
    ).toBe(false);
  });

  it("descarta ecuaciones y alternativas resueltas dentro de una pregunta", () => {
    expect(
      isSafeTutorMessage(
        "Como 1/2 + 1/2 = 1, ¿qué escribirías en el recuadro?"
      )
    ).toBe(false);
    expect(
      isSafeTutorMessage(
        "La alternativa correcta es B. ¿Qué dato la confirma?"
      )
    ).toBe(false);
    expect(
      isSafeTutorMessage(
        "Piensa en 3/4. ¿Qué operación te lleva allí?"
      )
    ).toBe(false);
    expect(
      isSafeTutorMessage(
        "Piensa en tres cuartos. ¿Qué operación te lleva allí?"
      )
    ).toBe(false);
    expect(
      isSafeTutorMessage(
        "El valor buscado es doce. ¿Cómo lo comprobarías?"
      )
    ).toBe(false);
  });
});
