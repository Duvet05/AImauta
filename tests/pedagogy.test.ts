import { describe, expect, it } from "vitest";

import {
  buildTutorSystemPrompt,
  fallbackGuide,
  getTurnPolicy,
  isSafeGuideMessage,
  isSafeTutorMessage,
  parseGuidanceDecision,
  parseGuidanceMove,
  parseGuideMessage,
  pickTurnMode,
  renderGuidanceMove
} from "@/lib/pedagogy";

describe("política pedagógica", () => {
  it("guía la mayoría de turnos y reserva el modo socrático para 1 de cada 10", () => {
    expect(pickTurnMode(0)).toBe("guide");
    expect(pickTurnMode(1)).toBe("guide");
    expect(pickTurnMode(9)).toBe("guide");
    expect(pickTurnMode(10)).toBe("socratic");
    expect(pickTurnMode(20)).toBe("socratic");
  });

  it("mantiene bloqueada la solución en todos los niveles", () => {
    const policy = getTurnPolicy({
      hintLevel: 3,
      stage: "practice",
      turnCount: 10
    });

    expect(policy.hintLevel).toBe(3);
    expect(policy.canRevealSolution).toBe(false);
    expect(policy.mode).toBe("socratic");
    expect(policy.maxOutputTokens).toBe(64);
  });

  it("por defecto guía en vez de solo preguntar, con más presupuesto de salida", () => {
    const policy = getTurnPolicy({ hintLevel: 1, stage: "practice" });

    expect(policy.mode).toBe("guide");
    expect(policy.maxOutputTokens).toBeGreaterThan(64);
  });

  it("marca la evidencia como no confiable y prohíbe inventar (modo guía)", () => {
    const policy = getTurnPolicy({ hintLevel: 0, stage: "learn" });
    const prompt = buildTutorSystemPrompt({
      page: 7,
      policy,
      evidence: [],
      attemptCount: 0
    });

    expect(policy.mode).toBe("guide");
    expect(prompt).toContain("<EVIDENCE_UNTRUSTED>");
    expect(prompt).toContain("calcules el resultado final");
    expect(prompt).toContain("no inventes");
  });

  it("el modo socrático conserva el formato de una sola pregunta", () => {
    const policy = getTurnPolicy({
      hintLevel: 0,
      stage: "learn",
      turnCount: 10
    });
    const prompt = buildTutorSystemPrompt({
      page: 7,
      policy,
      evidence: [],
      attemptCount: 0
    });

    expect(prompt).toContain("OBSERVA");
    expect(prompt).toContain("No reveles ni calcules la respuesta final");
  });

  it("acepta un mensaje de guía dentro de los límites y rechaza campos adicionales", () => {
    expect(
      parseGuideMessage(
        '{"guidance":"Observa la tabla de la página: ahí ves cuántas piezas hay por caja. ¿Qué harías con ese dato?"}'
      )
    ).toBe(
      "Observa la tabla de la página: ahí ves cuántas piezas hay por caja. ¿Qué harías con ese dato?"
    );
    expect(
      parseGuideMessage('{"guidance":"Muy corto"}')
    ).toBeNull();
    expect(
      parseGuideMessage(
        '{"guidance":"Explicación válida y suficientemente larga.","extra":"no"}'
      )
    ).toBeNull();
  });

  it("el mensaje de guía puede citar números de EVIDENCE pero no la respuesta final", () => {
    expect(
      isSafeGuideMessage(
        "En la página hay 24 manzanas repartidas en 4 cajas iguales. Fíjate cuántas manzanas caben en cada caja."
      )
    ).toBe(true);
    expect(
      isSafeGuideMessage(
        "El valor buscado es 6 manzanas por caja."
      )
    ).toBe(false);
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
    expect(message).toContain("Entiendo tu idea");
    expect(isSafeTutorMessage(message)).toBe(true);
  });

  it("acepta una pregunta breve estructurada y rechaza campos adicionales", () => {
    expect(
      parseGuidanceDecision(
        '{"move":"OBSERVA","question":"¿Qué dato de la tabla usarías primero y por qué?"}'
      )
    ).toEqual({
      move: "OBSERVA",
      question: "¿Qué dato de la tabla usarías primero y por qué?"
    });
    expect(
      parseGuidanceDecision(
        '{"move":"OBSERVA","question":"¿Qué observas?","answer":"42"}'
      )
    ).toBeNull();
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
