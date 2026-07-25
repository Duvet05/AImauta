import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  retrieveRagPageExercises,
  retrieveRagServiceEvidence,
} from "@/lib/rag-service";

const originalFetch = global.fetch;
const checksum =
  "c220ec82ed676a813977d61afea236e761c5253ef0beb0b0de9afccaf2eeaac0";

function response(body: unknown): Response {
  return Response.json(body, {
    headers: { "X-Aimauta-Rag-Contract": "1" },
  });
}

beforeEach(() => {
  process.env.AIMAUTA_RAG_SERVICE_URL = "http://127.0.0.1:3310";
  process.env.AIMAUTA_RAG_SERVICE_TIMEOUT_MS = "1200";
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.AIMAUTA_RAG_SERVICE_URL;
  delete process.env.AIMAUTA_RAG_SERVICE_TIMEOUT_MS;
  vi.restoreAllMocks();
});

describe("cliente del servicio RAG interno", () => {
  it("acepta sólo evidencia con linaje y alcance curricular exactos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        schema_version: 1,
        book_id: "fichas-matematica-1-secundaria",
        source_sha256: checksum,
        curriculum_version: "2024.1",
        sources: [
          {
            id: "fichas-matematica-1-secundaria:p13:c0",
            page: 13,
            text: "Compara los datos visibles antes de elegir una estrategia.",
            kind: "exercise",
            stage: "learn",
            unit_id: "ficha-1-fracciones",
            score: 8.5,
          },
        ],
      }),
    );
    global.fetch = fetchMock;

    await expect(
      retrieveRagServiceEvidence({
        bookId: "fichas-matematica-1-secundaria",
        question: "¿Cómo empiezo?",
        attempt: "Compararía los datos.",
        page: 13,
        allowedPages: [13],
      }),
    ).resolves.toMatchObject([
      {
        sourceId: "S1",
        page: 13,
        teacherOnly: false,
        stage: "learn",
        unitId: "ficha-1-fracciones",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3310/api/v1/retrieve"),
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("proyecta fragmentos exercise como actividades RAG estables y explícitas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        schema_version: 1,
        book_id: "fichas-matematica-1-secundaria",
        source_sha256: checksum,
        curriculum_version: "2024.1",
        sources: [
          {
            id: "fichas-matematica-1-secundaria:p13:c0",
            page: 13,
            text: "Compara las fracciones visibles y explica qué relación encuentras.",
            kind: "exercise",
            stage: "learn",
            unit_id: "ficha-1-fracciones",
            score: 5.5,
          },
          {
            id: "fichas-matematica-1-secundaria:p13:c1",
            page: 13,
            text: "Contenido general de la ficha.",
            kind: "content",
            stage: "learn",
            unit_id: "ficha-1-fracciones",
            score: 5,
          },
        ],
      }),
    );
    global.fetch = fetchMock;

    const exercises = await retrieveRagPageExercises({
      bookId: "fichas-matematica-1-secundaria",
      page: 13,
    });

    expect(exercises).toHaveLength(1);
    expect(exercises[0]).toMatchObject({
      id: expect.stringMatching(/^actividad-rag-13-[a-f0-9]{12}$/),
      status: "detected",
      origin: "rag-index",
      unitId: "ficha-1-fracciones",
      stage: "learn",
      label: "Actividad 1",
      prompt:
        "Compara las fracciones visibles y explica qué relación encuentras.",
      regions: [
        expect.objectContaining({
          page: 13,
          role: "prompt",
          rect: { x: 0.75, y: 0.03, width: 0.22, height: 0.065 },
        }),
      ],
    });
    expect(exercises[0].revision).toBeGreaterThan(0);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      page: 13,
      allowed_pages: [13],
      query: "",
      top_k: 3,
    });
  });

  it("rechaza respuestas con checksum o página fuera del alcance", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      response({
        schema_version: 1,
        book_id: "fichas-matematica-1-secundaria",
        source_sha256: "d".repeat(64),
        curriculum_version: "2024.1",
        sources: [
          {
            id: "page-21",
            page: 21,
            text: "No debe entrar.",
            kind: "exercise",
            stage: "assessment",
            unit_id: "ficha-1-fracciones",
            score: 9,
          },
        ],
      }),
    );

    await expect(
      retrieveRagServiceEvidence({
        bookId: "fichas-matematica-1-secundaria",
        question: "Dime la evaluación",
        attempt: "",
        page: 13,
        allowedPages: [13],
      }),
    ).resolves.toBeNull();
  });

  it("nunca conecta a un host distinto del loopback fijo", async () => {
    process.env.AIMAUTA_RAG_SERVICE_URL = "https://rag.example.test";
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    await expect(
      retrieveRagServiceEvidence({
        bookId: "fichas-matematica-1-secundaria",
        question: "¿Cómo empiezo?",
        attempt: "",
        page: 13,
        allowedPages: [13],
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
