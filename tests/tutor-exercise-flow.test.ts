import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  askTutorModel: vi.fn(),
  getPublishedExercise: vi.fn(),
  getReviewedExerciseSolution: vi.fn(),
  retrieveRagServiceEvidence: vi.fn(),
  retrieveExerciseEvidence: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  askTutorModel: dependencies.askTutorModel,
}));
vi.mock("@/lib/exercise-store", () => ({
  getPublishedExercise: dependencies.getPublishedExercise,
}));
vi.mock("@/lib/exercise-solution-store", () => ({
  getReviewedExerciseSolution:
    dependencies.getReviewedExerciseSolution,
}));
vi.mock("@/lib/rag-service", () => ({
  retrieveRagServiceEvidence:
    dependencies.retrieveRagServiceEvidence,
}));
vi.mock("@/lib/retrieval", () => ({
  retrieveExerciseEvidence: dependencies.retrieveExerciseEvidence,
}));

import {
  issueLearningSession,
  type LearningExerciseBinding,
} from "@/lib/learning-session";
import { guideLearningTurn } from "@/lib/tutor-service";
import type { PublicExercise } from "@/lib/exercise-manifest";

const bookId = "fichas-matematica-1-secundaria";
const exercise: PublicExercise = {
  id: "ejercicio-fracciones",
  status: "published",
  unitId: "ficha-1-fracciones",
  stage: "learn",
  revision: 2,
  label: "Problema 1",
  title: "Comparamos fracciones",
  prompt: "Compara las fracciones de la situación.",
  regions: [
    {
      id: "ejercicio-fracciones-contexto",
      page: 13,
      role: "context",
      order: 1,
      rect: { x: 0.08, y: 0.1, width: 0.84, height: 0.2 },
    },
    {
      id: "ejercicio-fracciones-pregunta",
      page: 14,
      role: "prompt",
      order: 2,
      rect: { x: 0.08, y: 0.4, width: 0.84, height: 0.22 },
    },
  ],
};
const binding: LearningExerciseBinding = {
  id: exercise.id,
  revision: exercise.revision,
  unitId: exercise.unitId,
  stage: exercise.stage,
  pages: [13, 14],
};
const reviewedSolution = {
  exerciseId: exercise.id,
  revision: exercise.revision,
  reviewed: true,
  finalAnswer: "La fracción mayor es 3/4.",
  pedagogicalSteps: [
    "Identifica numeradores y denominadores.",
    "Usa fracciones equivalentes para comparar.",
  ],
  hints: [
    { level: 1 as const, text: "Observa primero los denominadores." },
    { level: 2 as const, text: "Busca un denominador común." },
    { level: 3 as const, text: "Compara los numeradores equivalentes." },
  ],
  rubric: [
    {
      criterion: "Comparación",
      expectedEvidence: "Justifica con fracciones equivalentes.",
    },
  ],
  confidence: 0.96,
};

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
});

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.askTutorModel.mockResolvedValue(null);
  dependencies.getPublishedExercise.mockResolvedValue(exercise);
  dependencies.getReviewedExerciseSolution.mockResolvedValue(
    reviewedSolution,
  );
  dependencies.retrieveRagServiceEvidence.mockResolvedValue(null);
  dependencies.retrieveExerciseEvidence.mockResolvedValue([
    {
      id: "page-13",
      exerciseId: exercise.id,
      page: 13,
      text: "Compara las cantidades mediante fracciones equivalentes.",
      kind: "exercise",
      teacherOnly: false,
      stage: "learn",
      unitId: "ficha-1-fracciones",
      score: 5,
      sourceId: "S1",
    },
    {
      id: "page-14",
      exerciseId: exercise.id,
      page: 14,
      text: "Compara las cantidades mediante fracciones equivalentes.",
      kind: "exercise",
      teacherOnly: false,
      stage: "learn",
      unitId: "ficha-1-fracciones",
      score: 4,
      sourceId: "S2",
    },
  ]);
});

describe("tutor vinculado a ejercicio revisado", () => {
  it("falla cerrado sin selección y no abre RAG ni soluciones", async () => {
    const issued = issueLearningSession({ bookId, page: 13 });
    const result = await guideLearningTurn({
      sessionToken: issued.token,
      message: "¿Cómo empiezo?",
      attempt: "",
    });

    expect(result).toMatchObject({
      mode: "exercise-locked",
      citations: [],
      session: { attemptCount: 0, turnCount: 0 },
      policy: { canRevealSolution: false },
    });
    expect(
      dependencies.retrieveRagServiceEvidence,
    ).not.toHaveBeenCalled();
    expect(dependencies.retrieveExerciseEvidence).not.toHaveBeenCalled();
    expect(
      dependencies.getReviewedExerciseSolution,
    ).not.toHaveBeenCalled();
  });

  it("restringe RAG a las páginas del ejercicio y entrega una pista revisada", async () => {
    const issued = issueLearningSession({
      bookId,
      page: 13,
      exercise: binding,
    });
    const result = await guideLearningTurn({
      sessionToken: issued.token,
      message: "¿Cómo las comparo?",
      attempt: "Compararía numeradores y denominadores.",
    });

    expect(result.message).toContain("Pista 1 de 3");
    expect(result.message).not.toContain(reviewedSolution.finalAnswer);
    expect(result.citations).toEqual([
      { sourceId: "S1", page: 13, chunkId: "page-13" },
      { sourceId: "S2", page: 14, chunkId: "page-14" },
    ]);
    expect(dependencies.retrieveExerciseEvidence).toHaveBeenCalledWith(
      {
        bookId,
        exercise,
        question: "¿Cómo las comparo?",
        attempt: "Compararía numeradores y denominadores.",
        page: 13,
      },
    );
    expect(
      dependencies.getReviewedExerciseSolution,
    ).toHaveBeenCalledWith({
      bookId,
      exerciseId: exercise.id,
      revision: exercise.revision,
    });
    expect(
      dependencies.retrieveRagServiceEvidence,
    ).toHaveBeenCalledWith({
      bookId,
      exercise,
      requiredAnchor: exercise.prompt,
      question: "¿Cómo las comparo?",
      attempt: "Compararía numeradores y denominadores.",
      page: 13,
      allowedPages: [13, 14],
    });
  });

  it("registra el proveedor que eligió el movimiento pedagógico", async () => {
    dependencies.askTutorModel.mockResolvedValueOnce({
      content: "COMPRUEBA",
      provider: "openai",
    });

    const issued = issueLearningSession({
      bookId,
      page: 13,
      exercise: binding,
    });

    const result = await guideLearningTurn({
      sessionToken: issued.token,
      message: "¿Está bien mi estrategia?",
      attempt: "Compararía numeradores y denominadores.",
    });

    expect(result).toMatchObject({
      mode: "openai",
      message: expect.stringContaining(
        "¿Qué parte de tu procedimiento puedes comprobar",
      ),
    });
  });

  it("falla cerrado sin evidencia indexada y no abre la solución ni el modelo", async () => {
    dependencies.retrieveExerciseEvidence.mockResolvedValue([]);
    const issued = issueLearningSession({
      bookId,
      page: 13,
      exercise: binding,
    });

    const result = await guideLearningTurn({
      sessionToken: issued.token,
      message: "¿Cómo las comparo?",
      attempt: "Compararía los valores.",
    });

    expect(result).toMatchObject({
      mode: "exercise-locked",
      citations: [],
      session: { attemptCount: 0, turnCount: 0, hintLevel: 0 },
      policy: { hintLevel: 0, canRevealSolution: false },
    });
    expect(result.message).not.toContain(reviewedSolution.finalAnswer);
    expect(
      dependencies.getReviewedExerciseSolution,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.retrieveRagServiceEvidence,
    ).not.toHaveBeenCalled();
    expect(dependencies.askTutorModel).not.toHaveBeenCalled();
  });

  it("muestra la respuesta revisada sólo tras tres pistas y varios intentos", async () => {
    let sessionToken = issueLearningSession({
      bookId,
      page: 13,
      exercise: binding,
    }).token;
    const attempts = [
      "Primero compararía con cuidado ambos denominadores.",
      "Después buscaría fracciones equivalentes para cada valor.",
      "Finalmente usaría fracciones equivalentes con denominadores comunes.",
      "Multiplicaría para igualarlos.",
      "Multiplicaría para igualarlos.",
    ];
    const results = [];

    for (const attempt of attempts) {
      const result = await guideLearningTurn({
        sessionToken,
        message: "Dame el siguiente apoyo.",
        attempt,
      });
      results.push(result);
      sessionToken = result.sessionToken;
    }

    for (const result of results.slice(0, -1)) {
      expect(result.policy.canRevealSolution).toBe(false);
      expect(result.message).not.toContain(reviewedSolution.finalAnswer);
    }
    expect(results.at(-1)).toMatchObject({
      mode: "reviewed-answer",
      policy: { hintLevel: 3, canRevealSolution: true },
    });
    expect(results.at(-1)?.message).toContain(
      reviewedSolution.finalAnswer,
    );
  });

  it("no libera la respuesta con expresiones ajenas alternadas", async () => {
    let sessionToken = issueLearningSession({
      bookId,
      page: 13,
      exercise: binding,
    }).token;
    const attempts = [
      "123 + 456",
      "789 + 012",
      "123 + 456",
      "",
      "",
    ];
    let finalResult;

    for (const attempt of attempts) {
      finalResult = await guideLearningTurn({
        sessionToken,
        message: "Dame el siguiente apoyo.",
        attempt,
      });
      sessionToken = finalResult.sessionToken;
    }

    expect(finalResult).toMatchObject({
      session: { attemptCount: 0, turnCount: 5 },
      policy: { hintLevel: 2, canRevealSolution: false },
    });
    expect(finalResult?.message).not.toContain(
      reviewedSolution.finalAnswer,
    );
  });

  it.each([
    [
      "el número de la etiqueta",
      ["1 + 999", "1 + 888", "1 + 777", "", ""],
    ],
    [
      "una palabra curricular repetida",
      [
        "Fracciones con bananas azules sobre la mesa.",
        "Fracciones y elefantes verdes bajo el agua.",
        "Fracciones entre nubes moradas sin estrategia.",
        "",
        "",
      ],
    ],
  ])("no acepta keyword stuffing basado en %s", async (_case, attempts) => {
    let sessionToken = issueLearningSession({
      bookId,
      page: 13,
      exercise: binding,
    }).token;
    let finalResult;

    for (const attempt of attempts) {
      finalResult = await guideLearningTurn({
        sessionToken,
        message: "Dame el siguiente apoyo.",
        attempt,
      });
      sessionToken = finalResult.sessionToken;
    }

    expect(finalResult).toMatchObject({
      session: { attemptCount: 0, turnCount: 5 },
      policy: { canRevealSolution: false },
    });
    expect(finalResult?.message).not.toContain(
      reviewedSolution.finalAnswer,
    );
  });

  it.each([
    [
      "relleno distinto sobre los mismos conceptos",
      [
        "Numeradores denominadores bananas.",
        "Numeradores denominadores elefantes.",
        "Numeradores denominadores nubes.",
        "",
        "",
      ],
    ],
    [
      "cambios de puntuación",
      [
        "Compararía numeradores y denominadores.",
        "Compararía numeradores y denominadores!",
        "Compararía numeradores y denominadores?",
        "",
        "",
      ],
    ],
  ])("deduplica intentos por estrategia: %s", async (_case, attempts) => {
    let sessionToken = issueLearningSession({
      bookId,
      page: 13,
      exercise: binding,
    }).token;
    let finalResult;

    for (const attempt of attempts) {
      finalResult = await guideLearningTurn({
        sessionToken,
        message: "Dame el siguiente apoyo.",
        attempt,
      });
      sessionToken = finalResult.sessionToken;
    }

    expect(finalResult).toMatchObject({
      session: { attemptCount: 1, turnCount: 5 },
      policy: { canRevealSolution: false },
    });
    expect(finalResult?.message).not.toContain(
      reviewedSolution.finalAnswer,
    );
  });
});
