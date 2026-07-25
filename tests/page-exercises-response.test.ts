import { describe, expect, it } from "vitest";

import { parsePageExercisesResponse } from "@/lib/page-exercises-response";

const bookId = "fichas-matematica-1-secundaria";
const page = 13;
const exercise = {
  id: "problema-uno",
  status: "published",
  unitId: "ficha-1-fracciones",
  stage: "learn",
  revision: 1,
  label: "Problema 1",
  title: "Fracciones equivalentes",
  prompt: "¿Qué fracción representa la figura?",
  regions: [
    {
      id: "problema-uno-pregunta",
      page,
      role: "prompt",
      order: 1,
      rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.25 },
    },
  ],
};

describe("contrato de ejercicios por página", () => {
  it("acepta publicado con ejercicios y publicado vacío como estados distintos válidos", () => {
    expect(
      parsePageExercisesResponse(
        {
          schemaVersion: 1,
          bookId,
          page,
          publicationStatus: "published",
          exercises: [exercise],
        },
        { bookId, page },
      ),
    ).toMatchObject({ publicationStatus: "published" });

    expect(
      parsePageExercisesResponse(
        {
          schemaVersion: 1,
          bookId,
          page,
          publicationStatus: "published",
          exercises: [],
        },
        { bookId, page },
      ),
    ).toEqual({
      schemaVersion: 1,
      bookId,
      page,
      publicationStatus: "published",
      exercises: [],
    });
  });

  it("acepta no publicado únicamente cuando no contiene ejercicios", () => {
    expect(
      parsePageExercisesResponse(
        {
          schemaVersion: 1,
          bookId,
          page,
          publicationStatus: "not-published",
          exercises: [],
        },
        { bookId, page },
      ),
    ).toMatchObject({ publicationStatus: "not-published" });

    expect(
      parsePageExercisesResponse(
        {
          schemaVersion: 1,
          bookId,
          page,
          publicationStatus: "not-published",
          exercises: [exercise],
        },
        { bookId, page },
      ),
    ).toBeNull();
  });

  it("rechaza respuestas para otro libro o página y geometría insegura", () => {
    const valid = {
      schemaVersion: 1,
      bookId,
      page,
      publicationStatus: "published",
      exercises: [exercise],
    };

    expect(
      parsePageExercisesResponse(
        { ...valid, bookId: "otro-libro" },
        { bookId, page },
      ),
    ).toBeNull();
    expect(
      parsePageExercisesResponse(
        { ...valid, page: 14 },
        { bookId, page },
      ),
    ).toBeNull();
    expect(
      parsePageExercisesResponse(
        {
          ...valid,
          exercises: [
            {
              ...exercise,
              regions: [
                {
                  ...exercise.regions[0],
                  rect: { x: 0.8, y: 0.2, width: 0.4, height: 0.25 },
                },
              ],
            },
          ],
        },
        { bookId, page },
      ),
    ).toBeNull();
  });

  it("rechaza campos privados o duplicados", () => {
    const valid = {
      schemaVersion: 1,
      bookId,
      page,
      publicationStatus: "published",
      exercises: [exercise],
    };

    expect(
      parsePageExercisesResponse(
        { ...valid, solutions: [{ finalAnswer: "secreto" }] },
        { bookId, page },
      ),
    ).toBeNull();
    expect(
      parsePageExercisesResponse(
        { ...valid, exercises: [exercise, exercise] },
        { bookId, page },
      ),
    ).toBeNull();
  });
});
