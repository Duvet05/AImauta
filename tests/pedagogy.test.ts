import { describe, expect, it } from "vitest";

import {
  buildTutorSystemPrompt,
  fallbackGuide,
  getTurnPolicy,
  isSafeTutorMessage
} from "@/lib/pedagogy";

describe("política pedagógica", () => {
  it("mantiene bloqueada la solución en todos los niveles", () => {
    const policy = getTurnPolicy({
      attempt: "Primero compararía ambos números.",
      history: Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? ("student" as const) : ("tutor" as const),
        content: "turno"
      }))
    });

    expect(policy.hintLevel).toBe(3);
    expect(policy.canRevealSolution).toBe(false);
  });

  it("marca la evidencia como no confiable y prohíbe inventar", () => {
    const policy = getTurnPolicy({ attempt: "", history: [] });
    const prompt = buildTutorSystemPrompt({
      page: 7,
      policy,
      evidence: []
    });

    expect(prompt).toContain("<EVIDENCE_UNTRUSTED>");
    expect(prompt).toContain("No reveles la respuesta final");
    expect(prompt).toContain("no inventes");
  });

  it("el modo de respaldo también guía con una pregunta", () => {
    const policy = getTurnPolicy({ attempt: "", history: [] });
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
});
