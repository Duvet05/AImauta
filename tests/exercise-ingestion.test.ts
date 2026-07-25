import { describe, expect, it, vi } from "vitest";

import type { CatalogEntry } from "@/lib/catalog";
import {
  buildOverlappingPageWindows,
  ingestExercisesFromPdf
} from "@/lib/exercise-ingestion";
import type {
  ExerciseDetectionResult,
  ExerciseSolution
} from "@/lib/gemma-ingest";
import type { PageActivity } from "@/lib/curriculum";
import type {
  PdfPageRenderer,
  RenderedPdfPage
} from "@/lib/pdf-page-renderer";

const checksum = "a".repeat(64);

const catalogEntry: CatalogEntry = {
  id: "book-one",
  status: "review",
  publicationBlockers: ["publication-review-pending"],
  title: "Libro uno",
  levelId: "secundaria",
  gradeNumber: 1,
  courseId: "matematica",
  materialType: "student-workbook",
  language: "es-PE",
  description: "Material de prueba",
  pages: 5,
  sourceLabel: "Fuente oficial",
  sourcePageUrl: "https://example.edu/book",
  sourcePdfUrl: "https://repositorio.minedu.gob.pe/bitstream/handle/1/book.pdf",
  discoveredViaUrl: "https://example.edu/discovery",
  storageFile: "book-one.pdf",
  expectedBytes: 1_234,
  expectedSha256: checksum,
  edition: "2026",
  licenseName: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  licenseBasis: "official-repository-metadata",
  licenseEvidenceUrl: "https://example.edu/license",
  licenseReviewedAt: "2026-07-24",
  attribution: "Entidad educativa",
  provenance: "official-minedu"
};

function image(page: number): RenderedPdfPage {
  return {
    page,
    mimeType: "image/jpeg",
    base64: "/9j/",
    width: 800,
    height: 1_200,
    renderSha256: String(page).padStart(64, "0")
  };
}

function activity(
  page: number,
  stage: PageActivity["stage"] = "learn"
): PageActivity {
  return {
    unitId: "unit-one",
    unitNumber: 1,
    unitTitle: "Unidad uno",
    competency: "Resuelve problemas",
    stage,
    stageLabel: stage,
    startPage: 1,
    endPage: 5,
    tutorAvailable: stage === "learn" || stage === "practice"
  };
}

function rendererFixture(pageCount = 5): {
  renderer: PdfPageRenderer;
  renderPages: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const renderPages = vi.fn(async (pages: readonly number[]) =>
    pages.map(image)
  );
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    renderer: {
      pageCount,
      sourceSha256: checksum,
      renderPages,
      close
    },
    renderPages,
    close
  };
}

function emptyDetection(pages: readonly number[]): ExerciseDetectionResult {
  return {
    pagesReviewed: pages.map((page) => ({
      page,
      status: "no_exercise"
    })),
    exercises: []
  };
}

function denseDetection(
  pages: readonly number[],
  firstIndex: number,
  count: number
): ExerciseDetectionResult {
  return {
    pagesReviewed: pages.map((page) => ({
      page,
      status: "exercise_found"
    })),
    exercises: Array.from({ length: count }, (_, offset) => {
      const index = firstIndex + offset;
      return {
        candidateId: `candidate-${index}`,
        printedLabel: String(index),
        kind: "problem" as const,
        promptText: `Problema independiente ${index}.`,
        continuation: "none" as const,
        confidence: 0.99,
        regions: [
          {
            page: pages[0]!,
            box2d: [100, 100, 300, 900] as const,
            role: "statement" as const
          }
        ]
      };
    })
  };
}

function firstWindowDetection(): ExerciseDetectionResult {
  return {
    pagesReviewed: [
      { page: 1, status: "no_exercise" },
      { page: 2, status: "exercise_found" },
      { page: 3, status: "exercise_found" }
    ],
    exercises: [
      {
        candidateId: "window-one-item",
        printedLabel: "4",
        kind: "problem",
        promptText: "Calcula tres cuartos de la cantidad mostrada.",
        continuation: "to_next",
        confidence: 0.93,
        regions: [
          {
            page: 2,
            box2d: [100, 200, 400, 800],
            role: "statement"
          },
          {
            page: 3,
            box2d: [100, 100, 500, 900],
            role: "continuation"
          }
        ]
      }
    ]
  };
}

function secondWindowDetection(): ExerciseDetectionResult {
  return {
    pagesReviewed: [
      { page: 3, status: "exercise_found" },
      { page: 4, status: "exercise_found" },
      { page: 5, status: "no_exercise" }
    ],
    exercises: [
      {
        candidateId: "window-two-item",
        printedLabel: "4",
        kind: "problem",
        promptText:
          "Calcula tres cuartos de la cantidad mostrada y comprueba el resultado.",
        continuation: "from_previous",
        confidence: 0.89,
        regions: [
          {
            page: 3,
            box2d: [105, 105, 505, 905],
            role: "continuation"
          },
          {
            page: 4,
            box2d: [50, 100, 350, 900],
            role: "figure"
          }
        ]
      }
    ]
  };
}

function solution(): ExerciseSolution {
  return {
    finalAnswer: "3/4",
    pedagogicalSteps: ["Identifica el total.", "Calcula tres de cuatro partes."],
    hints: [
      { level: 1, text: "¿Cuál es el total?" },
      { level: 2, text: "Divide el total en cuatro partes." },
      { level: 3, text: "Toma tres de esas partes." }
    ],
    rubric: [
      {
        criterion: "Procedimiento",
        expectedEvidence: "Divide y multiplica correctamente"
      }
    ],
    confidence: 0.91
  };
}

describe("coordinador privado de ingesta", () => {
  it("crea ventanas de tres páginas con una página de solape", () => {
    expect(buildOverlappingPageWindows(1)).toEqual([[1]]);
    expect(buildOverlappingPageWindows(4)).toEqual([
      [1, 2, 3],
      [3, 4]
    ]);
    expect(buildOverlappingPageWindows(7)).toEqual([
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7]
    ]);
  });

  it("agrupa un ejercicio multipágina, normaliza cajas y separa solución privada", async () => {
    const fixture = rendererFixture();
    const detect = vi
      .fn()
      .mockResolvedValueOnce(firstWindowDetection())
      .mockResolvedValueOnce(secondWindowDetection());
    const solve = vi.fn().mockResolvedValue({
      ...solution(),
      thoughtProcess: "este campo no debe persistirse"
    });

    const result = await ingestExercisesFromPdf({
      catalogEntry,
      pdfPath: "/private/book-one.pdf",
      model: "gemma-4-26b-a4b-it",
      detect,
      solve,
      pageActivity: (_bookId, page) => activity(page),
      now: () => new Date("2026-07-24T20:00:00.000Z"),
      openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
    });

    expect(detect).toHaveBeenCalledTimes(2);
    expect(
      detect.mock.calls.map(([images]) =>
        (images as RenderedPdfPage[]).map((item) => item.page)
      )
    ).toEqual([
      [1, 2, 3],
      [3, 4, 5]
    ]);
    expect(fixture.renderPages.mock.calls.map(([pages]) => pages)).toEqual([
      [1, 2, 3],
      [4, 5],
      [2, 3, 4]
    ]);
    expect(solve).toHaveBeenCalledTimes(1);

    expect(result.publicManifest.exercises).toHaveLength(1);
    const exercise = result.publicManifest.exercises[0]!;
    expect(exercise).toMatchObject({
      status: "draft",
      unitId: "unit-one",
      stage: "learn",
      revision: 1,
      label: "4",
      title: "Ejercicio 4"
    });
    expect(exercise.id).toMatch(/^exercise-[a-f0-9]{24}$/u);
    expect(exercise.regions.map((region) => region.page)).toEqual([2, 3, 4]);
    expect(exercise.regions[0]?.rect).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.6,
      height: 0.3
    });

    expect(result.privateManifest.solutions).toEqual([
      {
        exerciseId: exercise.id,
        revision: 1,
        reviewed: false,
        finalAnswer: "3/4",
        pedagogicalSteps: [
          "Identifica el total.",
          "Calcula tres de cuatro partes."
        ],
        hints: solution().hints,
        rubric: [
          {
            criterion: "Procedimiento",
            expectedEvidence: "Divide y multiplica correctamente"
          }
        ],
        confidence: 0.91
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("thoughtProcess");
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });

  it("es determinista aunque cambien ids locales y orden de candidatos", async () => {
    async function run(reverse: boolean) {
      const fixture = rendererFixture();
      const first = firstWindowDetection();
      const extra = {
        candidateId: reverse ? "z-local" : "a-local",
        printedLabel: "2",
        kind: "problem" as const,
        promptText: "Suma dos cantidades.",
        continuation: "none" as const,
        confidence: 0.96,
        regions: [
          {
            page: 1,
            box2d: [100, 100, 300, 800] as const,
            role: "statement" as const
          }
        ]
      };
      first.exercises = reverse
        ? [first.exercises[0]!, extra]
        : [extra, first.exercises[0]!];
      const detect = vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(secondWindowDetection());
      return ingestExercisesFromPdf({
        catalogEntry,
        pdfPath: "/private/book-one.pdf",
        model: "gemma-4-26b-a4b-it",
        detect,
        solve: vi.fn().mockResolvedValue(solution()),
        pageActivity: (_bookId, page) => activity(page),
        now: () => new Date("2026-07-24T20:00:00.000Z"),
        openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
      });
    }

    const left = await run(false);
    const right = await run(true);
    expect(left.publicManifest).toEqual(right.publicManifest);
    expect(left.privateManifest).toEqual(right.privateManifest);
  });

  it("conserva el id ante jitter pequeño de OCR y coordenadas", async () => {
    async function run(variant: "base" | "jitter"): Promise<string> {
      const fixture = rendererFixture();
      const first = emptyDetection([1, 2, 3]);
      first.pagesReviewed[1] = { page: 2, status: "exercise_found" };
      first.exercises = [
        {
          candidateId: `local-${variant}`,
          printedLabel: variant === "base" ? "4." : "4",
          kind: "problem",
          promptText:
            variant === "base"
              ? "Calcula tres cuartos de la cantidad mostrada."
              : "CalcuIa tres cuartos de la cantidad mostrada",
          continuation: "none",
          confidence: 0.95,
          regions: [
            {
              page: 2,
              box2d:
                variant === "base"
                  ? [101, 199, 399, 801]
                  : [104, 202, 402, 798],
              role: "statement"
            }
          ]
        }
      ];

      const result = await ingestExercisesFromPdf({
        catalogEntry,
        pdfPath: "/private/book-one.pdf",
        model: "gemma-4-26b-a4b-it",
        detect: vi
          .fn()
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(emptyDetection([3, 4, 5])),
        solve: vi.fn().mockResolvedValue(solution()),
        pageActivity: (_bookId, page) => activity(page),
        now: () => new Date("2026-07-24T20:00:00.000Z"),
        openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
      });
      return result.publicManifest.exercises[0]!.id;
    }

    await expect(run("base")).resolves.toBe(await run("jitter"));
  });

  it("mantiene ids distintos para ejercicios separados con igual etiqueta", async () => {
    const fixture = rendererFixture();
    const first = emptyDetection([1, 2, 3]);
    first.pagesReviewed[1] = { page: 2, status: "exercise_found" };
    first.exercises = [
      {
        candidateId: "upper",
        printedLabel: "7",
        kind: "problem",
        promptText: "Resuelve el ejercicio indicado.",
        continuation: "none",
        confidence: 0.95,
        regions: [
          {
            page: 2,
            box2d: [100, 100, 300, 900],
            role: "statement"
          }
        ]
      },
      {
        candidateId: "lower",
        printedLabel: "7",
        kind: "problem",
        promptText: "Resuelve el ejercicio indicado.",
        continuation: "none",
        confidence: 0.95,
        regions: [
          {
            page: 2,
            box2d: [500, 100, 700, 900],
            role: "statement"
          }
        ]
      }
    ];

    const result = await ingestExercisesFromPdf({
      catalogEntry,
      pdfPath: "/private/book-one.pdf",
      model: "gemma-4-26b-a4b-it",
      detect: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(emptyDetection([3, 4, 5])),
      solve: vi.fn().mockResolvedValue(solution()),
      pageActivity: (_bookId, page) => activity(page),
      openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
    });

    const ids = result.publicManifest.exercises.map((exercise) => exercise.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("no fusiona cajas coincidentes si etiqueta y enunciado discrepan", async () => {
    const fixture = rendererFixture();
    const first = emptyDetection([1, 2, 3]);
    first.pagesReviewed[1] = { page: 2, status: "exercise_found" };
    first.exercises = [
      {
        candidateId: "first",
        printedLabel: "1",
        kind: "problem",
        promptText: "Calcula la fracción de la figura.",
        continuation: "none",
        confidence: 0.95,
        regions: [
          {
            page: 2,
            box2d: [100, 100, 500, 900],
            role: "statement"
          }
        ]
      },
      {
        candidateId: "second",
        printedLabel: "2",
        kind: "problem",
        promptText: "Describe el patrón geométrico observado.",
        continuation: "none",
        confidence: 0.95,
        regions: [
          {
            page: 2,
            box2d: [100, 100, 500, 900],
            role: "statement"
          }
        ]
      }
    ];
    const detect = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(emptyDetection([3, 4, 5]));
    const solve = vi.fn().mockResolvedValue(solution());

    const result = await ingestExercisesFromPdf({
      catalogEntry,
      pdfPath: "/private/book-one.pdf",
      model: "gemma-4-26b-a4b-it",
      detect,
      solve,
      pageActivity: (_bookId, page) => activity(page),
      openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
    });

    expect(result.publicManifest.exercises).toHaveLength(2);
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it("impide una fusión transitiva entre candidatos incompatibles", async () => {
    const fixture = rendererFixture();
    const first = emptyDetection([1, 2, 3]);
    first.pagesReviewed[1] = { page: 2, status: "exercise_found" };
    first.exercises = [
      {
        candidateId: "chain-a",
        printedLabel: "4",
        kind: "problem",
        promptText: "alfa beta gamma",
        continuation: "none",
        confidence: 0.95,
        regions: [
          {
            page: 2,
            box2d: [100, 100, 500, 500],
            role: "statement"
          }
        ]
      },
      {
        candidateId: "chain-b",
        printedLabel: "4",
        kind: "problem",
        promptText: "alfa beta gamma delta epsilon zeta",
        continuation: "none",
        confidence: 0.95,
        regions: [
          {
            page: 2,
            box2d: [100, 140, 500, 540],
            role: "statement"
          }
        ]
      },
      {
        candidateId: "chain-c",
        printedLabel: "4",
        kind: "problem",
        promptText: "delta epsilon zeta",
        continuation: "none",
        confidence: 0.95,
        regions: [
          {
            page: 2,
            box2d: [100, 180, 500, 580],
            role: "statement"
          }
        ]
      }
    ];
    const solve = vi.fn().mockResolvedValue(solution());

    const result = await ingestExercisesFromPdf({
      catalogEntry,
      pdfPath: "/private/book-one.pdf",
      model: "gemma-4-26b-a4b-it",
      detect: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(emptyDetection([3, 4, 5])),
      solve,
      pageActivity: (_bookId, page) => activity(page),
      openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
    });

    expect(result.publicManifest.exercises).toHaveLength(2);
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it("corta el libro antes de agrupar si supera el presupuesto global de candidatos", async () => {
    const pageCount = 13;
    const fixture = rendererFixture(pageCount);
    let nextCandidate = 1;
    const detect = vi.fn(async (images: readonly RenderedPdfPage[]) => {
      const count = nextCandidate <= 500 ? 100 : 13;
      const result = denseDetection(
        images.map((item) => item.page),
        nextCandidate,
        count
      );
      nextCandidate += count;
      return result;
    });

    await expect(
      ingestExercisesFromPdf({
        catalogEntry: { ...catalogEntry, pages: pageCount },
        pdfPath: "/private/book-one.pdf",
        model: "gemma-4-26b-a4b-it",
        detect,
        solve: vi.fn(),
        pageActivity: (_bookId, page) => activity(page),
        openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
      })
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(detect).toHaveBeenCalledTimes(6);
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });

  it("no inicia pre-soluciones si supera el presupuesto global de solves", async () => {
    const pageCount = 7;
    const fixture = rendererFixture(pageCount);
    const counts = [86, 86, 85];
    let nextCandidate = 1;
    const detect = vi.fn(async (images: readonly RenderedPdfPage[]) => {
      const count = counts.shift()!;
      const result = denseDetection(
        images.map((item) => item.page),
        nextCandidate,
        count
      );
      nextCandidate += count;
      return result;
    });
    const solve = vi.fn();

    await expect(
      ingestExercisesFromPdf({
        catalogEntry: { ...catalogEntry, pages: pageCount },
        pdfPath: "/private/book-one.pdf",
        model: "gemma-4-26b-a4b-it",
        detect,
        solve,
        pageActivity: (_bookId, page) => activity(page),
        openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
      })
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(detect).toHaveBeenCalledTimes(3);
    expect(solve).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });

  it("descarta de forma cerrada ejercicios en evaluación", async () => {
    const fixture = rendererFixture();
    const detect = vi
      .fn()
      .mockResolvedValueOnce(firstWindowDetection())
      .mockResolvedValueOnce(secondWindowDetection());
    const solve = vi.fn();

    const result = await ingestExercisesFromPdf({
      catalogEntry,
      pdfPath: "/private/book-one.pdf",
      model: "gemma-4-26b-a4b-it",
      detect,
      solve,
      pageActivity: (_bookId, page) =>
        activity(page, page === 4 ? "assessment" : "learn"),
      openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
    });

    expect(result.publicManifest.exercises).toEqual([]);
    expect(result.privateManifest.solutions).toEqual([]);
    expect(result.issues).toContainEqual({
      code: "candidate-forbidden-page",
      candidateId: "window-one-item"
    });
    expect(solve).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });

  it("falla si una ventana no declara todas sus páginas y siempre cierra", async () => {
    const fixture = rendererFixture();
    const invalid = firstWindowDetection();
    invalid.pagesReviewed = invalid.pagesReviewed.slice(0, 2);

    await expect(
      ingestExercisesFromPdf({
        catalogEntry,
        pdfPath: "/private/book-one.pdf",
        model: "gemma-4-26b-a4b-it",
        detect: vi.fn().mockResolvedValue(invalid),
        solve: vi.fn(),
        pageActivity: (_bookId, page) => activity(page),
        openRenderer: vi.fn().mockResolvedValue(fixture.renderer)
      })
    ).rejects.toMatchObject({ code: "INVALID_DETECTION" });
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
});
