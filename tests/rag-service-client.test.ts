import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { retrieveRagServiceEvidence } from "@/lib/rag-service";

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
