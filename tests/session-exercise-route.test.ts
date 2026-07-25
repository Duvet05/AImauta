import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicExercise } from "@/lib/exercise-manifest";

const exerciseStore = vi.hoisted(() => ({
  getPublishedExercise: vi.fn(),
}));

vi.mock("@/lib/exercise-store", () => ({
  ExerciseManifestUnavailableError: class extends Error {},
  getPublishedExercise: exerciseStore.getPublishedExercise,
}));

import { POST } from "@/app/api/session/route";

const bookId = "fichas-matematica-1-secundaria";
const exercise: PublicExercise = {
  id: "ejercicio-revisionado",
  status: "published",
  unitId: "ficha-1-fracciones",
  stage: "learn",
  revision: 3,
  label: "Problema 1",
  title: "Fracciones",
  prompt: "Compara las fracciones.",
  regions: [
    {
      id: "ejercicio-revisionado-region-1",
      page: 13,
      role: "prompt",
      order: 1,
      rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 },
    },
  ],
};

function createRequest(selection: {
  exerciseRevision: number;
  exerciseRegionId: string;
}): Request {
  return new Request("http://aimauta.test/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bookId,
      page: 13,
      exerciseId: exercise.id,
      ...selection,
    }),
  });
}

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
});

beforeEach(() => {
  exerciseStore.getPublishedExercise.mockReset();
  exerciseStore.getPublishedExercise.mockResolvedValue(exercise);
});

describe("selección revisionada en POST /api/session", () => {
  it("firma únicamente la revisión y región visibles", async () => {
    const response = await POST(
      createRequest({
        exerciseRevision: 3,
        exerciseRegionId: "ejercicio-revisionado-region-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: {
        exerciseId: exercise.id,
        exerciseRevision: exercise.revision,
      },
    });
  });

  it("rechaza un overlay cacheado con revisión anterior", async () => {
    const response = await POST(
      createRequest({
        exerciseRevision: 2,
        exerciseRegionId: "ejercicio-revisionado-region-1",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/no está habilitado/iu),
    });
  });

  it("rechaza una región que no corresponde al rectángulo visible", async () => {
    const response = await POST(
      createRequest({
        exerciseRevision: 3,
        exerciseRegionId: "ejercicio-revisionado-region-9",
      }),
    );

    expect(response.status).toBe(400);
  });
});
