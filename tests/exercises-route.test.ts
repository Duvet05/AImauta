import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicExercise } from "@/lib/exercise-manifest";
import type { PageExercise } from "@/lib/page-exercises-response";

const store = vi.hoisted(() => {
  class NotPublishedError extends Error {}
  class UnavailableError extends Error {
    readonly reason = "integrity";
  }
  return {
    NotPublishedError,
    UnavailableError,
    getPublishedExercisesForPage: vi.fn(),
  };
});
const rag = vi.hoisted(() => ({
  retrieveRagPageExercises: vi.fn(),
}));

vi.mock("@/lib/exercise-store", () => ({
  ExerciseManifestNotPublishedError: store.NotPublishedError,
  ExerciseManifestUnavailableError: store.UnavailableError,
  getPublishedExercisesForPage: store.getPublishedExercisesForPage,
}));
vi.mock("@/lib/rag-service", () => ({
  retrieveRagPageExercises: rag.retrieveRagPageExercises,
}));

import { GET } from "@/app/api/materials/[bookId]/exercises/route";

const bookId = "fichas-matematica-1-secundaria";
const context = { params: Promise.resolve({ bookId }) };

const multipageExercise: PublicExercise = {
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
};

const reviewExercise: PublicExercise = {
  ...multipageExercise,
  id: "ejercicio-en-revision",
  status: "review",
  label: "Borrador",
  regions: multipageExercise.regions.map((region, index) => ({
    ...region,
    id: `ejercicio-en-revision-region-${index + 1}`,
  })),
};

const ragExercise: PageExercise = {
  id: "actividad-rag-13-aabbccddeeff",
  status: "detected",
  origin: "rag-index",
  unitId: "ficha-1-fracciones",
  stage: "learn",
  revision: 7,
  label: "Actividad 1",
  title: "Compara las fracciones de la página.",
  prompt: "Compara las fracciones de la página.",
  regions: [
    {
      id: "actividad-rag-13-aabbccddeeff-marcador",
      page: 13,
      role: "prompt",
      order: 1,
      rect: { x: 0.75, y: 0.03, width: 0.22, height: 0.065 },
    },
  ],
};

beforeEach(() => {
  store.getPublishedExercisesForPage.mockReset();
  store.getPublishedExercisesForPage.mockResolvedValue([
    multipageExercise,
    reviewExercise,
  ]);
  rag.retrieveRagPageExercises.mockReset();
  rag.retrieveRagPageExercises.mockResolvedValue([]);
});

describe("GET /api/materials/:bookId/exercises", () => {
  it("exige una sola página entera dentro del libro", async () => {
    for (const suffix of [
      "",
      "?page=",
      "?page=0",
      "?page=13.5",
      "?page=-1",
      "?page=101",
      "?page=13&page=14",
    ]) {
      const response = await GET(
        new Request(
          `http://aimauta.test/api/materials/${bookId}/exercises${suffix}`,
        ),
        context,
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(store.getPublishedExercisesForPage).not.toHaveBeenCalled();
  });

  it("devuelve 404 para un libro que no está publicado", async () => {
    const response = await GET(
      new Request(
        "http://aimauta.test/api/materials/libro-inexistente/exercises?page=13",
      ),
      { params: Promise.resolve({ bookId: "libro-inexistente" }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("devuelve el contrato público y conserva las regiones multipágina", async () => {
    const response = await GET(
      new Request(
        `http://aimauta.test/api/materials/${bookId}/exercises?page=13`,
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      bookId,
      page: 13,
      publicationStatus: "published",
      exercises: [
        {
          ...multipageExercise,
          status: "published",
          origin: "reviewed",
        },
      ],
    });
  });

  it("distingue un material aún no publicado sin convertirlo en error", async () => {
    store.getPublishedExercisesForPage.mockRejectedValue(
      new store.NotPublishedError(),
    );

    const response = await GET(
      new Request(
        `http://aimauta.test/api/materials/${bookId}/exercises?page=13`,
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      bookId,
      page: 13,
      publicationStatus: "not-published",
      exercises: [],
    });
  });

  it("expone actividades RAG cuando todavía no existe un manifiesto revisado", async () => {
    store.getPublishedExercisesForPage.mockRejectedValue(
      new store.NotPublishedError(),
    );
    rag.retrieveRagPageExercises.mockResolvedValue([ragExercise]);

    const response = await GET(
      new Request(
        `http://aimauta.test/api/materials/${bookId}/exercises?page=13`,
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(rag.retrieveRagPageExercises).toHaveBeenCalledWith({
      bookId,
      page: 13,
    });
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      bookId,
      page: 13,
      publicationStatus: "rag-indexed",
      exercises: [ragExercise],
    });
  });

  it("distingue una página vacía dentro de un manifiesto publicado", async () => {
    store.getPublishedExercisesForPage.mockResolvedValue([]);

    const response = await GET(
      new Request(
        `http://aimauta.test/api/materials/${bookId}/exercises?page=15`,
      ),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      bookId,
      page: 15,
      publicationStatus: "published",
      exercises: [],
    });
  });

  it("responde 304 cuando coincide If-None-Match", async () => {
    const first = await GET(
      new Request(
        `http://aimauta.test/api/materials/${bookId}/exercises?page=13`,
      ),
      context,
    );
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const cached = await GET(
      new Request(
        `http://aimauta.test/api/materials/${bookId}/exercises?page=13`,
        { headers: { "If-None-Match": etag ?? "" } },
      ),
      context,
    );

    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    expect(cached.headers.get("etag")).toBe(etag);
  });

  it("falla cerrado sin revelar errores internos del manifiesto", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    store.getPublishedExercisesForPage.mockRejectedValue(
      new store.UnavailableError("ruta-interna/secreta"),
    );

    const response = await GET(
      new Request(
        `http://aimauta.test/api/materials/${bookId}/exercises?page=13`,
      ),
      context,
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain("ruta-interna");
    expect(body).not.toContain("secreta");
    expect(consoleError).toHaveBeenCalledWith(
      "Public exercise manifest failure",
      { bookId, reason: "integrity" },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "ruta-interna",
    );
    consoleError.mockRestore();
  });
});
