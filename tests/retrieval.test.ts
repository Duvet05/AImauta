import { describe, expect, it } from "vitest";

import { rankChunks, type IndexedChunk } from "@/lib/retrieval";

const chunks: IndexedChunk[] = [
  {
    id: "same-page",
    page: 12,
    text: "Compara las cantidades y explica qué estrategia usarías.",
    kind: "exercise"
  },
  {
    id: "lexical",
    page: 20,
    text: "Una cantidad representa cuánto hay y puede compararse con otra."
  },
  {
    id: "teacher-only",
    page: 12,
    text: "La respuesta final es cuarenta y dos.",
    teacherOnly: true
  }
];

describe("rankChunks", () => {
  it("prioriza página activa y coincidencia léxica", () => {
    const result = rankChunks({
      chunks,
      query: "¿Cómo comparo estas cantidades?",
      page: 12
    });

    expect(result[0]).toMatchObject({
      id: "same-page",
      page: 12,
      sourceId: "S1"
    });
  });

  it("nunca recupera fragmentos reservados al docente", () => {
    const result = rankChunks({
      chunks,
      query: "respuesta final",
      page: 12
    });

    expect(result.map((item) => item.id)).not.toContain("teacher-only");
  });

  it("mantiene la evidencia dentro de la página visible y sus vecinas", () => {
    const result = rankChunks({
      chunks,
      query: "cantidad",
      page: 12
    });

    expect(result.map((item) => item.id)).not.toContain("lexical");
  });
});
