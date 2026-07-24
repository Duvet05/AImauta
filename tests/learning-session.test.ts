import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  issueLearningSession,
  LearningSessionError,
  learningSessionErrorStatus,
  moveLearningSession,
  recordLearningTurn,
  verifyLearningSession
} from "@/lib/learning-session";

const bookId = "fichas-matematica-1-secundaria";

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
});

describe("sesión pedagógica firmada", () => {
  it("emite y verifica estado canónico", () => {
    const issued = issueLearningSession({ bookId, page: 13 });
    expect(verifyLearningSession(issued.token)).toMatchObject({
      bookId,
      page: 13,
      stage: "learn",
      attemptCount: 0,
      totalTurnCount: 0,
      hintLevel: 0,
      revision: 0
    });
  });

  it("rechaza alteraciones y expiración", () => {
    const issued = issueLearningSession({ bookId, page: 13, now: 1_000 });
    expect(() => verifyLearningSession(`${issued.token}x`, 1_001)).toThrow(
      LearningSessionError
    );
    expect(() => verifyLearningSession(issued.token, 8_201)).toThrow(
      /expiró/
    );
  });

  it("reinicia el apoyo al cambiar de página y reconoce evaluación", () => {
    const issued = issueLearningSession({ bookId, page: 13 });
    const attempted = recordLearningTurn({
      token: issued.token,
      attempt: "Compararía primero los denominadores."
    });
    expect(attempted.state.attemptCount).toBe(1);
    expect(attempted.state.totalTurnCount).toBe(1);
    expect(attempted.state.revision).toBe(1);

    const moved = moveLearningSession(attempted.token, 21);
    expect(moved.state).toMatchObject({
      page: 21,
      stage: "assessment",
      attemptCount: 0,
      totalTurnCount: 1,
      hintLevel: 0,
      revision: 2
    });
    expect(moved.activity.tutorAvailable).toBe(false);
  });

  it("solo cuenta intentos distintos y eleva las pistas gradualmente", () => {
    const issued = issueLearningSession({ bookId, page: 17 });
    const first = recordLearningTurn({
      token: issued.token,
      attempt: "Usaría fracciones equivalentes."
    });
    const repeated = recordLearningTurn({
      token: first.token,
      attempt: "Usaría fracciones equivalentes."
    });

    expect(first.state).toMatchObject({
      attemptCount: 1,
      turnCount: 1,
      totalTurnCount: 1,
      hintLevel: 1
    });
    expect(repeated.state).toMatchObject({
      attemptCount: 1,
      turnCount: 2,
      totalTurnCount: 2,
      hintLevel: 2
    });
  });

  it("rechaza el replay de un token anterior después de una mutación", () => {
    const issued = issueLearningSession({ bookId, page: 17 });
    recordLearningTurn({
      token: issued.token,
      attempt: "Primero observaría los datos."
    });

    expect(() =>
      recordLearningTurn({
        token: issued.token,
        attempt: "Intentaría otra estrategia."
      })
    ).toThrow(/cambió en otro canal/);
  });

  it("comparte el anti-replay entre evaluaciones aisladas del módulo", async () => {
    vi.resetModules();
    const firstBundle = await import("@/lib/learning-session");
    const issued = firstBundle.issueLearningSession({ bookId, page: 17 });
    firstBundle.recordLearningTurn({
      token: issued.token,
      attempt: "Primero observaría los datos."
    });

    vi.resetModules();
    const secondBundle = await import("@/lib/learning-session");
    expect(() =>
      secondBundle.recordLearningTurn({
        token: issued.token,
        attempt: "Intentaría otra estrategia."
      })
    ).toThrow(/cambió en otro canal/);
  });

  it("mapea configuración, conflicto y cuota a estados HTTP distintos", () => {
    expect(
      learningSessionErrorStatus(
        new LearningSessionError("configuración", "configuration")
      )
    ).toBe(503);
    expect(
      learningSessionErrorStatus(new LearningSessionError("replay", "stale"))
    ).toBe(409);
    expect(
      learningSessionErrorStatus(new LearningSessionError("cuota", "limit"))
    ).toBe(429);
  });

  it("limita la duración de una sesión anónima", () => {
    let token = issueLearningSession({ bookId, page: 17 }).token;
    for (let turn = 0; turn < 40; turn += 1) {
      token = recordLearningTurn({ token, attempt: "" }).token;
    }

    expect(() => recordLearningTurn({ token, attempt: "" })).toThrow(
      /límite de turnos/
    );
  });

  it("no reinicia la cuota total al cambiar de página", () => {
    let token = issueLearningSession({ bookId, page: 17 }).token;
    for (let turn = 0; turn < 39; turn += 1) {
      token = recordLearningTurn({ token, attempt: "" }).token;
    }
    const moved = moveLearningSession(token, 18);
    expect(moved.state).toMatchObject({
      turnCount: 0,
      totalTurnCount: 39
    });

    const last = recordLearningTurn({ token: moved.token, attempt: "" });
    expect(last.state.totalTurnCount).toBe(40);
    expect(() =>
      recordLearningTurn({ token: last.token, attempt: "" })
    ).toThrow(/límite de turnos/);
  });
});
