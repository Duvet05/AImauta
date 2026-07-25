import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  issueLearningSession,
  moveLearningSession,
  recordLearningTurn,
  verifyLearningSession
} from "@/lib/learning-session";

const bookId = "fichas-matematica-1-secundaria";
const pageBinding = {
  assignmentId: "assignment0000000001",
  runId: "assignmentrun0000001",
  itemId: "assignmentitem000001",
  allowedPages: [17, 18],
  exerciseId: null,
  exerciseRevision: null,
  maxHintLevel: 1 as const,
  turnCountBase: 0,
  attemptCountBase: 0
};
const exercise = {
  id: "ejercicio-1",
  revision: 1,
  unitId: "ficha-1-fracciones",
  stage: "learn" as const,
  pages: [13, 14]
};

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "assignment-learning-test-secret-with-at-least-32-characters";
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
});

describe("sesión pedagógica vinculada a una tarea", () => {
  it("firma el vínculo, limita páginas y aplica el máximo de ayuda", () => {
    let issued = issueLearningSession({
      bookId,
      page: 17,
      assignment: pageBinding
    });
    for (let turn = 0; turn < 6; turn += 1) {
      issued = recordLearningTurn({
        token: issued.token,
        attempt: "Intentaría comparar primero todos los datos."
      });
    }

    expect(issued.state.hintLevel).toBe(1);
    expect(verifyLearningSession(issued.token).assignment).toEqual(
      pageBinding
    );
    expect(() => moveLearningSession(issued.token, 19)).toThrow(
      /no pertenece/
    );

    const moved = moveLearningSession(issued.token, 18);
    expect(moved.state).toMatchObject({
      page: 18,
      assignment: {
        assignmentId: pageBinding.assignmentId,
        itemId: pageBinding.itemId,
        maxHintLevel: 1
      }
    });
  });

  it("no permite quitar ni cambiar el ejercicio fijado por el docente", () => {
    const assignment = {
      ...pageBinding,
      allowedPages: [13, 14],
      exerciseId: exercise.id,
      exerciseRevision: exercise.revision,
      maxHintLevel: 2 as const
    };
    const issued = issueLearningSession({
      bookId,
      page: 13,
      exercise,
      assignment
    });

    expect(() => moveLearningSession(issued.token, 14)).toThrow(
      /no pertenece/
    );
    expect(() =>
      issueLearningSession({
        bookId,
        page: 13,
        assignment
      })
    ).toThrow(/no pertenece/);

    const continued = moveLearningSession(issued.token, 14, exercise);
    expect(continued.state.exerciseId).toBe(exercise.id);
  });

  it("rechaza vínculos mal formados antes de emitir un token", () => {
    expect(() =>
      issueLearningSession({
        bookId,
        page: 17,
        assignment: {
          ...pageBinding,
          runId: "corto",
          allowedPages: [17, 17]
        }
      })
    ).toThrow(/no pertenece/);
  });

  it("conserva la pista alcanzada al reanudar un objetivo", () => {
    const issued = issueLearningSession({
      bookId,
      page: 17,
      assignment: {
        ...pageBinding,
        maxHintLevel: 2,
        turnCountBase: 4,
        attemptCountBase: 2
      },
      initialHintLevel: 2
    });
    const continued = recordLearningTurn({
      token: issued.token,
      attempt: ""
    });

    expect(continued.state).toMatchObject({
      hintLevel: 2,
      totalTurnCount: 1,
      assignment: {
        turnCountBase: 4,
        attemptCountBase: 2
      }
    });
  });
});
