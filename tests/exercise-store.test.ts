import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getBook } from "@/lib/catalog";
import {
  ExerciseManifestUnavailableError,
  getPublishedExercise,
  getPublishedExercisesForPage,
  loadPublicExerciseManifest,
} from "@/lib/exercise-store";
import {
  EXERCISE_COORDINATE_SPACE,
  type PublicExerciseManifest,
} from "@/lib/exercise-manifest";

const bookId = "fichas-matematica-1-secundaria";
const book = getBook(bookId);
let manifestDir: string;
let publicManifestPath: string;

function manifest(
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
    model: "reasoning-api-test",
    generatedAt: "2026-07-24T20:00:00.000Z",
    exercises: [
      {
        id: "ejercicio-publicado",
        status: "published",
        unitId: "ficha-1-fracciones",
        stage: "learn",
        revision: 1,
        label: "Problema 1",
        title: "Fracciones en dos páginas",
        prompt: "¿Qué fracción representa la situación?",
        regions: [
          {
            id: "ejercicio-publicado-contexto",
            page: 13,
            role: "context",
            order: 1,
            rect: { x: 0.08, y: 0.1, width: 0.84, height: 0.2 },
          },
          {
            id: "ejercicio-publicado-pregunta",
            page: 14,
            role: "prompt",
            order: 2,
            rect: { x: 0.08, y: 0.12, width: 0.84, height: 0.3 },
          },
        ],
      },
      {
        id: "ejercicio-en-revision",
        status: "review",
        unitId: "ficha-1-fracciones",
        stage: "learn",
        revision: 1,
        label: "Borrador",
        title: "Todavía no publicado",
        prompt: "Este ejercicio no debe llegar a estudiantes.",
        regions: [
          {
            id: "ejercicio-en-revision-pregunta",
            page: 13,
            role: "prompt",
            order: 1,
            rect: { x: 0.1, y: 0.55, width: 0.8, height: 0.2 },
          },
        ],
      },
    ],
    ...overrides,
  };
}

async function publishFixture(value: unknown = manifest()): Promise<void> {
  await writeFile(publicManifestPath, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
  });
}

beforeAll(async () => {
  if (!book) {
    throw new Error("El catálogo de prueba no está disponible.");
  }
  manifestDir = await mkdtemp(
    path.join(tmpdir(), "aimauta-exercise-store-"),
  );
  publicManifestPath = path.join(manifestDir, `${bookId}.public.json`);
  process.env.AIMAUTA_EXERCISE_MANIFEST_DIR = manifestDir;
});

beforeEach(async () => {
  await rm(publicManifestPath, { force: true });
});

afterAll(async () => {
  delete process.env.AIMAUTA_EXERCISE_MANIFEST_DIR;
  await rm(manifestDir, { recursive: true, force: true });
});

describe("almacén público de ejercicios", () => {
  it("trata una primera ausencia como no publicada y detecta una promoción sin caché negativa", async () => {
    await expect(loadPublicExerciseManifest(bookId)).rejects.toMatchObject({
      name: "ExerciseManifestNotPublishedError",
    });

    await publishFixture();
    await expect(loadPublicExerciseManifest(bookId)).resolves.toMatchObject({
      bookId,
    });
  });

  it("valida el manifiesto y nunca abre ni proyecta soluciones privadas", async () => {
    await publishFixture();
    await writeFile(
      path.join(manifestDir, `${bookId}.private.json`),
      JSON.stringify({
        finalAnswer: "SECRETO-QUE-NO-DEBE-SALIR",
      }),
      { mode: 0o600 },
    );

    const loaded = await loadPublicExerciseManifest(bookId);

    expect(loaded.bookId).toBe(bookId);
    expect(JSON.stringify(loaded)).not.toContain("SECRETO-QUE-NO-DEBE-SALIR");
    expect(loaded).not.toHaveProperty("solutions");
  });

  it("devuelve sólo publicados que tocan la página y conserva sus regiones multipágina", async () => {
    await publishFixture();

    const exercises = await getPublishedExercisesForPage(bookId, 13);

    expect(exercises.map((exercise) => exercise.id)).toEqual([
      "ejercicio-publicado",
    ]);
    expect(exercises[0]?.regions.map((region) => region.page)).toEqual([
      13,
      14,
    ]);
    await expect(
      getPublishedExercise(bookId, "ejercicio-publicado"),
    ).resolves.toMatchObject({ status: "published" });
    await expect(
      getPublishedExercise(bookId, "ejercicio-en-revision"),
    ).resolves.toBeUndefined();
  });

  it("considera no publicado un archivo retirado y falla cerrado si el existente no coincide", async () => {
    await publishFixture();
    await loadPublicExerciseManifest(bookId);
    await rm(publicManifestPath, { force: true });
    await expect(loadPublicExerciseManifest(bookId)).rejects.toMatchObject({
      name: "ExerciseManifestNotPublishedError",
    });

    await publishFixture({
      ...manifest(),
      sourceSha256: "0".repeat(64),
    });
    await expect(loadPublicExerciseManifest(bookId)).rejects.toBeInstanceOf(
      ExerciseManifestUnavailableError,
    );
  });

  it("se recupera cuando un manifiesto corrupto es reemplazado por uno válido", async () => {
    await publishFixture({ schemaVersion: 999, bookId });
    await expect(loadPublicExerciseManifest(bookId)).rejects.toMatchObject({
      name: "ExerciseManifestUnavailableError",
      reason: "integrity",
    });

    await publishFixture();
    await expect(loadPublicExerciseManifest(bookId)).resolves.toMatchObject({
      bookId,
    });
  });

  it("rechaza un manifiesto que ubica ejercicios en evaluación", async () => {
    const source = manifest();
    const first = source.exercises[0];
    await publishFixture({
      ...source,
      exercises: [
        {
          ...first,
          regions: [
            {
              ...first.regions[0],
              page: 21,
              role: "prompt",
            },
          ],
        },
      ],
    });

    await expect(loadPublicExerciseManifest(bookId)).rejects.toBeInstanceOf(
      ExerciseManifestUnavailableError,
    );
  });

  it("rechaza campos privados incrustados en el manifiesto público", async () => {
    await publishFixture({
      ...manifest(),
      solutions: [{ finalAnswer: "No publicar" }],
    });

    await expect(loadPublicExerciseManifest(bookId)).rejects.toBeInstanceOf(
      ExerciseManifestUnavailableError,
    );
  });
});
