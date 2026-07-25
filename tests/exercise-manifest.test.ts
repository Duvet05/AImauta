import { describe, expect, it } from "vitest";

import { getCatalogEntries } from "@/lib/catalog";
import {
  EXERCISE_COORDINATE_SPACE,
  parsePrivateExerciseSolutionsManifest,
  parsePublicExerciseManifest,
  projectPublicExerciseManifest,
  validateExerciseManifests,
  type PrivateExerciseSolutionsManifest,
  type PublicExerciseManifest
} from "@/lib/exercise-manifest";

const catalogEntry = getCatalogEntries()[0];

function publicManifest(
  overrides: Partial<PublicExerciseManifest> = {}
): PublicExerciseManifest {
  return {
    schemaVersion: 1,
    bookId: catalogEntry.id,
    sourceSha256: catalogEntry.expectedSha256,
    pageCount: catalogEntry.pages,
    coordinateSpace: EXERCISE_COORDINATE_SPACE,
    renderVersion: "pdfjs-6.1.200@2x",
    model: "gemma-vision-ingest",
    generatedAt: "2026-07-24T18:00:00.000Z",
    exercises: [
      {
        id: "ejercicio-1",
        status: "published",
        unitId: "ficha-1-fracciones",
        stage: "learn",
        revision: 1,
        label: "Problema 1",
        title: "Repartimos una cantidad",
        prompt: "¿Qué fracción representa cada parte?",
        regions: [
          {
            id: "ejercicio-1-contexto",
            page: 13,
            role: "context",
            order: 1,
            rect: { x: 0.08, y: 0.12, width: 0.84, height: 0.18 }
          },
          {
            id: "ejercicio-1-pregunta",
            page: 14,
            role: "prompt",
            order: 2,
            rect: { x: 0.08, y: 0.1, width: 0.84, height: 0.32 }
          }
        ]
      }
    ],
    ...overrides
  };
}

function privateManifest(
  overrides: Partial<PrivateExerciseSolutionsManifest> = {}
): PrivateExerciseSolutionsManifest {
  return {
    schemaVersion: 1,
    bookId: catalogEntry.id,
    sourceSha256: catalogEntry.expectedSha256,
    model: "reasoning-api-model",
    generatedAt: "2026-07-24T18:01:00.000Z",
    solutions: [
      {
        exerciseId: "ejercicio-1",
        revision: 1,
        reviewed: true,
        finalAnswer: "Cada parte representa 1/4.",
        pedagogicalSteps: [
          "Identificar el total.",
          "Contar las partes iguales."
        ],
        hints: [
          { level: 1, text: "Observa cuántas partes iguales hay." },
          { level: 2, text: "Usa ese número como denominador." },
          { level: 3, text: "Una de cuatro partes es 1/4." }
        ],
        rubric: [
          {
            criterion: "Reconoce el total",
            expectedEvidence: "Identifica cuatro partes iguales."
          },
          {
            criterion: "Justifica la fracción",
            expectedEvidence: "Relaciona una parte con el denominador cuatro."
          }
        ],
        confidence: 0.94
      }
    ],
    ...overrides
  };
}

describe("manifiestos de ejercicios", () => {
  it("acepta un ejercicio multipágina ligado al catálogo y currículo", () => {
    expect(
      validateExerciseManifests(publicManifest(), privateManifest())
    ).toEqual([]);
  });

  it("parsea JSON sin conservar referencias mutables", () => {
    const source = publicManifest();
    const result = parsePublicExerciseManifest(JSON.stringify(source));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(source);
      expect(result.value).not.toBe(source);
    }
  });

  it("rechaza cajas no finitas o que exceden la página normalizada", () => {
    const base = publicManifest();
    const exercise = base.exercises[0];
    const invalid = {
      ...base,
      exercises: [
        {
          ...exercise,
          regions: [
            {
              ...exercise.regions[0],
              rect: { x: 0.8, y: 0.1, width: 0.3, height: 0.2 }
            },
            {
              ...exercise.regions[1],
              rect: {
                x: Number.NaN,
                y: 0.1,
                width: 0.4,
                height: 0.2
              }
            }
          ]
        }
      ]
    };

    const result = parsePublicExerciseManifest(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.code)).toEqual(
        expect.arrayContaining([
          "manifest.rect-outside-page",
          "manifest.invalid-coordinate"
        ])
      );
    }
  });

  it("rechaza ids duplicados y un orden de regiones discontinuo", () => {
    const base = publicManifest();
    const exercise = base.exercises[0];
    const duplicate = {
      ...exercise,
      id: "ejercicio-duplicado",
      regions: exercise.regions.map((region, index) => ({
        ...region,
        id: `region-${index + 1}`
      }))
    };
    const invalid = {
      ...base,
      exercises: [
        {
          ...exercise,
          regions: exercise.regions.map((region) => ({
            ...region,
            id: "region-1",
            order: 2
          }))
        },
        duplicate,
        duplicate
      ]
    };

    const result = parsePublicExerciseManifest(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.code)).toEqual(
        expect.arrayContaining([
          "manifest.duplicate-region-id",
          "manifest.duplicate-region-order",
          "manifest.noncontiguous-region-order",
          "manifest.duplicate-exercise-id"
        ])
      );
    }
  });

  it("falla si checksum o número de páginas no coincide con catálogo", () => {
    const issues = validateExerciseManifests(
      publicManifest({
        sourceSha256: "0".repeat(64),
        pageCount: 99
      }),
      privateManifest({
        sourceSha256: "0".repeat(64)
      })
    );

    expect(issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "manifest.catalog-checksum-mismatch",
        "manifest.catalog-page-count-mismatch"
      ])
    );
  });

  it("rechaza ejercicios que cruzan etapa o entran en evaluación", () => {
    const base = publicManifest();
    const exercise = base.exercises[0];
    const invalid = {
      ...base,
      exercises: [
        {
          ...exercise,
          status: "review" as const,
          regions: [
            exercise.regions[0],
            {
              ...exercise.regions[1],
              page: 21
            }
          ]
        }
      ]
    };

    const codes = validateExerciseManifests(invalid).map(
      (entry) => entry.code
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "manifest.forbidden-curriculum-page",
        "manifest.region-curriculum-mismatch",
        "manifest.exercise-crosses-curriculum-boundary"
      ])
    );
  });

  it("exige solución privada revisada y en la misma revisión al publicar", () => {
    expect(
      validateExerciseManifests(publicManifest()).map(
        (entry) => entry.code
      )
    ).toContain("manifest.published-missing-solution");

    const pending = privateManifest({
      solutions: [
        {
          ...privateManifest().solutions[0],
          revision: 2,
          reviewed: false
        }
      ]
    });
    const codes = validateExerciseManifests(
      publicManifest(),
      pending
    ).map((entry) => entry.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "manifest.published-solution-not-reviewed",
        "manifest.published-solution-revision-mismatch"
      ])
    );
  });

  it("rechaza chain-of-thought aunque venga como campo extra anidado", () => {
    const input = {
      ...privateManifest(),
      solutions: [
        {
          ...privateManifest().solutions[0],
          chain_of_thought: "razonamiento interno"
        }
      ]
    };

    const result = parsePrivateExerciseSolutionsManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.code)).toContain(
        "manifest.forbidden-reasoning-trace"
      );
    }
  });

  it("la proyección pública elimina cualquier solución inyectada", () => {
    const input = publicManifest() as PublicExerciseManifest & {
      privateSolutions?: unknown;
    };
    input.privateSolutions = privateManifest();
    (
      input.exercises[0] as PublicExerciseManifest["exercises"][number] & {
        finalAnswer?: string;
      }
    ).finalAnswer = "No debe salir";

    const projected = projectPublicExerciseManifest(input);
    expect(projected).not.toHaveProperty("privateSolutions");
    expect(projected.exercises[0]).not.toHaveProperty("finalAnswer");
    expect(JSON.stringify(projected)).not.toContain("No debe salir");
  });
});
