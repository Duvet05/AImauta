import { describe, expect, it } from "vitest";

import {
  rankChunks,
  retrieveExerciseEvidence,
  type IndexedChunk,
} from "@/lib/retrieval";
import type { PublicExercise } from "@/lib/exercise-manifest";

const chunks: IndexedChunk[] = [
  {
    id: "same-page",
    page: 12,
    text: "Compara las cantidades y explica qué estrategia usarías.",
    kind: "exercise",
    teacherOnly: false,
    stage: "orientation",
    unitId: null
  },
  {
    id: "lexical",
    page: 20,
    text: "Una cantidad representa cuánto hay y puede compararse con otra.",
    kind: "content",
    teacherOnly: false,
    stage: "practice",
    unitId: "ficha-1-fracciones"
  },
  {
    id: "teacher-only",
    page: 12,
    text: "La respuesta final es cuarenta y dos.",
    kind: "content",
    teacherOnly: true,
    stage: "orientation",
    unitId: null
  },
  {
    id: "assessment",
    page: 21,
    text: "Clave de una evaluación próxima.",
    kind: "exercise",
    teacherOnly: false,
    stage: "assessment",
    unitId: "ficha-1-fracciones"
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

  it("nunca recupera fragmentos marcados como evaluación", () => {
    const result = rankChunks({
      chunks,
      query: "clave evaluación",
      page: 20
    });

    expect(result.map((item) => item.id)).not.toContain("assessment");
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

describe("retrieveExerciseEvidence", () => {
  it("vincula toda evidencia al ejercicio y conserva sus páginas multipágina", () => {
    const exercise: PublicExercise = {
      id: "ejercicio-fracciones",
      status: "published",
      unitId: "ficha-1-fracciones",
      stage: "learn",
      revision: 4,
      label: "Problema 1",
      title: "Compara fracciones",
      prompt: "Compara ambas fracciones y explica tu estrategia.",
      regions: [
        {
          id: "ejercicio-fracciones-contexto",
          page: 13,
          role: "context",
          order: 1,
          rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        },
        {
          id: "ejercicio-fracciones-pregunta",
          page: 18,
          role: "prompt",
          order: 2,
          rect: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 },
        },
      ],
    };

    const result = retrieveExerciseEvidence(exercise);

    expect(result.map(({ exerciseId, page }) => ({ exerciseId, page }))).toEqual([
      { exerciseId: exercise.id, page: 13 },
      { exerciseId: exercise.id, page: 18 },
    ]);
    expect(result.every((item) => item.text.includes(exercise.prompt))).toBe(
      true,
    );
  });
});
