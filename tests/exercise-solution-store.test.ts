import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { getBook } from "@/lib/catalog";
import {
  EXERCISE_COORDINATE_SPACE,
  type PrivateExerciseSolution,
  type PrivateExerciseSolutionsManifest,
  type PublicExerciseManifest,
} from "@/lib/exercise-manifest";
import {
  ExerciseSolutionUnavailableError,
  getReviewedExerciseSolution,
} from "@/lib/exercise-solution-store";

const bookId = "fichas-matematica-1-secundaria";
const book = getBook(bookId);
let manifestDir: string;
let solutionDir: string;
let publicManifestPath: string;
let privateManifestPath: string;
let privateTargetPath: string;

function publicManifest(
  overrides: Partial<PublicExerciseManifest> = {},
): PublicExerciseManifest {
  if (!book) {
    throw new Error("El libro de prueba no está publicado.");
  }
  return {
    schemaVersion: 1,
    bookId,
    sourceSha256: book.expectedSha256,
    pageCount: book.pages,
    coordinateSpace: EXERCISE_COORDINATE_SPACE,
    renderVersion: "pdfjs-6.1.200@2x",
    model: "vision-api-test",
    generatedAt: "2026-07-24T20:00:00.000Z",
    exercises: [
      {
        id: "ejercicio-uno",
        status: "published",
        unitId: "ficha-1-fracciones",
        stage: "learn",
        revision: 1,
        label: "Problema 1",
        title: "Primera pregunta",
        prompt: "¿Qué fracción representa la primera situación?",
        regions: [
          {
            id: "ejercicio-uno-pregunta",
            page: 13,
            role: "prompt",
            order: 1,
            rect: { x: 0.08, y: 0.1, width: 0.84, height: 0.25 },
          },
        ],
      },
      {
        id: "ejercicio-dos",
        status: "published",
        unitId: "ficha-1-fracciones",
        stage: "learn",
        revision: 3,
        label: "Problema 2",
        title: "Segunda pregunta",
        prompt: "¿Qué fracción representa la segunda situación?",
        regions: [
          {
            id: "ejercicio-dos-pregunta",
            page: 14,
            role: "prompt",
            order: 1,
            rect: { x: 0.08, y: 0.45, width: 0.84, height: 0.25 },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function privateSolution(
  exerciseId: string,
  revision: number,
  finalAnswer: string,
  overrides: Partial<PrivateExerciseSolution> = {},
): PrivateExerciseSolution {
  return {
    exerciseId,
    revision,
    reviewed: true,
    finalAnswer,
    pedagogicalSteps: [
      "Identificar el total.",
      "Relacionar una parte con el total.",
    ],
    hints: [
      { level: 1, text: "Observa cuántas partes iguales hay." },
      { level: 2, text: "Usa el total como denominador." },
      { level: 3, text: "Compara una parte con el total." },
    ],
    rubric: [
      {
        criterion: "Reconoce el total",
        expectedEvidence: "Identifica todas las partes iguales.",
      },
    ],
    confidence: 0.95,
    ...overrides,
  };
}

function privateManifest(
  overrides: Partial<PrivateExerciseSolutionsManifest> = {},
): PrivateExerciseSolutionsManifest {
  if (!book) {
    throw new Error("El libro de prueba no está publicado.");
  }
  return {
    schemaVersion: 1,
    bookId,
    sourceSha256: book.expectedSha256,
    model: "reasoning-api-test",
    generatedAt: "2026-07-24T20:01:00.000Z",
    solutions: [
      privateSolution("ejercicio-uno", 1, "RESPUESTA-PRIVADA-UNO"),
      privateSolution("ejercicio-dos", 3, "RESPUESTA-PRIVADA-DOS"),
    ],
    ...overrides,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
  });
}

async function publishPair(
  publicValue: unknown = publicManifest(),
  privateValue: unknown = privateManifest(),
): Promise<void> {
  await Promise.all([
    writeJson(publicManifestPath, publicValue),
    writeJson(privateManifestPath, privateValue),
  ]);
}

beforeAll(async () => {
  if (!book) {
    throw new Error("El catálogo de prueba no está disponible.");
  }
  manifestDir = await mkdtemp(
    path.join(tmpdir(), "aimauta-solution-public-"),
  );
  solutionDir = await mkdtemp(
    path.join(tmpdir(), "aimauta-solution-private-"),
  );
  publicManifestPath = path.join(
    manifestDir,
    `${bookId}.public.json`,
  );
  privateManifestPath = path.join(
    solutionDir,
    `${bookId}.private.json`,
  );
  privateTargetPath = path.join(solutionDir, "private-target.json");
  process.env.AIMAUTA_EXERCISE_MANIFEST_DIR = manifestDir;
  process.env.AIMAUTA_EXERCISE_SOLUTION_DIR = solutionDir;
});

beforeEach(async () => {
  await Promise.all([
    rm(publicManifestPath, { force: true }),
    rm(privateManifestPath, { force: true }),
    rm(privateTargetPath, { force: true }),
  ]);
});

afterAll(async () => {
  delete process.env.AIMAUTA_EXERCISE_MANIFEST_DIR;
  delete process.env.AIMAUTA_EXERCISE_SOLUTION_DIR;
  await Promise.all([
    rm(manifestDir, { recursive: true, force: true }),
    rm(solutionDir, { recursive: true, force: true }),
  ]);
});

describe("almacén privado de soluciones", () => {
  it("acepta un par público/privado válido y devuelve una copia revisada", async () => {
    await publishPair();

    const solution = await getReviewedExerciseSolution({
      bookId,
      exerciseId: "ejercicio-uno",
      revision: 1,
    });

    expect(solution).toEqual(privateManifest().solutions[0]);
    expect(JSON.stringify(solution)).not.toContain(
      "RESPUESTA-PRIVADA-DOS",
    );
    (solution.pedagogicalSteps as string[]).push("Mutación local");

    await expect(
      getReviewedExerciseSolution({
        bookId,
        exerciseId: "ejercicio-uno",
        revision: 1,
      }),
    ).resolves.not.toMatchObject({
      pedagogicalSteps: expect.arrayContaining(["Mutación local"]),
    });
  });

  it.each([
    {
      name: "no revisada",
      solution: privateSolution(
        "ejercicio-uno",
        1,
        "RESPUESTA-PRIVADA-UNO",
        { reviewed: false },
      ),
    },
    {
      name: "de otra revisión",
      solution: privateSolution(
        "ejercicio-uno",
        2,
        "RESPUESTA-PRIVADA-UNO",
      ),
    },
  ])("rechaza una solución $name", async ({ solution }) => {
    const source = privateManifest();
    await publishPair(undefined, {
      ...source,
      solutions: [solution, source.solutions[1]],
    });

    await expect(
      getReviewedExerciseSolution({
        bookId,
        exerciseId: "ejercicio-uno",
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(ExerciseSolutionUnavailableError);
  });

  it.each(["chain_of_thought", "providerPayload"])(
    "rechaza el campo privado no permitido %s",
    async (field) => {
      const source = privateManifest();
      await publishPair(undefined, {
        ...source,
        solutions: [
          {
            ...source.solutions[0],
            [field]: "dato que no pertenece al contrato",
          },
          source.solutions[1],
        ],
      });

      await expect(
        getReviewedExerciseSolution({
          bookId,
          exerciseId: "ejercicio-uno",
          revision: 1,
        }),
      ).rejects.toBeInstanceOf(ExerciseSolutionUnavailableError);
    },
  );

  it("rechaza un manifiesto privado ligado a otro checksum", async () => {
    await publishPair(undefined, {
      ...privateManifest(),
      sourceSha256: "0".repeat(64),
    });

    await expect(
      getReviewedExerciseSolution({
        bookId,
        exerciseId: "ejercicio-uno",
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(ExerciseSolutionUnavailableError);
  });

  it("falla cerrado si falta el archivo privado o si es un symlink", async () => {
    await writeJson(publicManifestPath, publicManifest());

    await expect(
      getReviewedExerciseSolution({
        bookId,
        exerciseId: "ejercicio-uno",
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(ExerciseSolutionUnavailableError);

    await writeJson(privateTargetPath, privateManifest());
    await symlink(privateTargetPath, privateManifestPath);
    await expect(
      getReviewedExerciseSolution({
        bookId,
        exerciseId: "ejercicio-uno",
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(ExerciseSolutionUnavailableError);
  });

  it("nunca devuelve una solución distinta de la solicitada", async () => {
    await publishPair();

    const second = await getReviewedExerciseSolution({
      bookId,
      exerciseId: "ejercicio-dos",
      revision: 3,
    });
    expect(second).toMatchObject({
      exerciseId: "ejercicio-dos",
      revision: 3,
      finalAnswer: "RESPUESTA-PRIVADA-DOS",
    });
    expect(JSON.stringify(second)).not.toContain(
      "RESPUESTA-PRIVADA-UNO",
    );

    await expect(
      getReviewedExerciseSolution({
        bookId,
        exerciseId: "ejercicio-inexistente",
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(ExerciseSolutionUnavailableError);

    const source = publicManifest();
    await publishPair({
      ...source,
      exercises: source.exercises.map((exercise) =>
        exercise.id === "ejercicio-dos"
          ? { ...exercise, status: "review" as const }
          : exercise,
      ),
    });
    await expect(
      getReviewedExerciseSolution({
        bookId,
        exerciseId: "ejercicio-dos",
        revision: 3,
      }),
    ).rejects.toBeInstanceOf(ExerciseSolutionUnavailableError);
  });
});
