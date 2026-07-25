import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicExercise } from "@/lib/exercise-manifest";
import { retrieveRagServiceEvidence } from "@/lib/rag-service";

const originalFetch = global.fetch;
const checksum =
  "c220ec82ed676a813977d61afea236e761c5253ef0beb0b0de9afccaf2eeaac0";
const secret = "test-rag-secret-with-at-least-32-characters";
const anchor =
  "Compara las cantidades mediante fracciones equivalentes y explica tu estrategia.";
const digest = createHash("sha256").update(anchor).digest("hex");
const exercise: PublicExercise = {
  id: "ejercicio-fracciones",
  status: "published",
  unitId: "ficha-1-fracciones",
  stage: "learn",
  revision: 2,
  label: "Problema 1",
  title: "Comparamos fracciones",
  prompt: anchor,
  regions: [
    {
      id: "ejercicio-fracciones-contexto",
      page: 13,
      role: "context",
      order: 1,
      rect: { x: 0.08, y: 0.1, width: 0.84, height: 0.2 }
    },
    {
      id: "ejercicio-fracciones-pregunta",
      page: 14,
      role: "prompt",
      order: 2,
      rect: { x: 0.08, y: 0.4, width: 0.84, height: 0.22 }
    }
  ]
};

function response(body: unknown): Response {
  return Response.json(body, {
    headers: { "X-Aimauta-Rag-Contract": "2" }
  });
}

function validPayload(): Record<string, unknown> {
  return {
    schema_version: 2,
    book_id: "fichas-matematica-1-secundaria",
    source_sha256: checksum,
    curriculum_version: "2024.1",
    exercise_id: exercise.id,
    exercise_revision: exercise.revision,
    required_anchor_digest: digest,
    region_ids: exercise.regions.map((region) => region.id),
    sources: [
      {
        id: "fichas-matematica-1-secundaria:p13:c0",
        exercise_id: exercise.id,
        exercise_revision: exercise.revision,
        required_anchor_digest: digest,
        page: 13,
        text: anchor,
        kind: "exercise",
        stage: "learn",
        unit_id: "ficha-1-fracciones",
        score: 18.5
      }
    ]
  };
}

function request() {
  return retrieveRagServiceEvidence({
    bookId: "fichas-matematica-1-secundaria",
    exercise,
    requiredAnchor: anchor,
    question: "¿Cómo empiezo?",
    attempt: "Compararía las cantidades.",
    page: 13,
    allowedPages: [13, 14]
  });
}

beforeEach(() => {
  process.env.AIMAUTA_RAG_SERVICE_URL = "http://127.0.0.1:3311";
  process.env.AIMAUTA_RAG_SERVICE_SECRET = secret;
  process.env.AIMAUTA_RAG_SERVICE_TIMEOUT_MS = "1200";
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.AIMAUTA_RAG_SERVICE_URL;
  delete process.env.AIMAUTA_RAG_SERVICE_SECRET;
  delete process.env.AIMAUTA_RAG_SERVICE_TIMEOUT_MS;
  vi.restoreAllMocks();
});

describe("cliente opcional del servicio RAG por ejercicio", () => {
  it("acepta sólo evidencia ligada al ejercicio, revisión y ancla exactos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(validPayload()));
    global.fetch = fetchMock;

    await expect(request()).resolves.toMatchObject([
      {
        exerciseId: exercise.id,
        sourceId: "R1",
        page: 13,
        teacherOnly: false,
        stage: "learn",
        unitId: "ficha-1-fracciones"
      }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3311/api/v2/retrieve"),
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: `Bearer ${secret}`
        })
      })
    );
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      exercise_id: exercise.id,
      exercise_revision: exercise.revision,
      required_anchor: anchor,
      required_anchor_digest: digest,
      region_ids: exercise.regions.map((region) => region.id)
    });
  });

  it.each([
    ["exercise_id", "otro-ejercicio"],
    ["exercise_revision", 3],
    ["required_anchor_digest", "d".repeat(64)]
  ])("rechaza un %s de respuesta distinto", async (field, value) => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(response({ ...validPayload(), [field]: value }));
    await expect(request()).resolves.toBeNull();
  });

  it("rechaza una fuente vecina sin coincidencia léxica real con el ancla", async () => {
    const payload = validPayload();
    payload.sources = [
      {
        ...(payload.sources as Array<Record<string, unknown>>)[0],
        text: "Determina perímetros de polígonos usando medidas exactas."
      }
    ];
    global.fetch = vi.fn().mockResolvedValue(response(payload));

    await expect(request()).resolves.toBeNull();
  });

  it("acepta cero fuentes como resultado fail-closed", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(response({ ...validPayload(), sources: [] }));
    await expect(request()).resolves.toEqual([]);
  });

  it("no conecta sin secreto dedicado o fuera del loopback fijo", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    delete process.env.AIMAUTA_RAG_SERVICE_SECRET;
    await expect(request()).resolves.toBeNull();
    process.env.AIMAUTA_RAG_SERVICE_SECRET = secret;
    process.env.AIMAUTA_RAG_SERVICE_URL = "http://127.0.0.1:3310";
    await expect(request()).resolves.toBeNull();
    process.env.AIMAUTA_RAG_SERVICE_URL = "https://rag.example.test";
    await expect(request()).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mantiene el timeout activo mientras lee el cuerpo", async () => {
    process.env.AIMAUTA_RAG_SERVICE_TIMEOUT_MS = "100";
    global.fetch = vi.fn(async (_url, options) => {
      const signal = options?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('{"schema_version":2,')
          );
          signal?.addEventListener("abort", () => {
            controller.error(new Error("aborted"));
          });
        }
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/json",
          "X-Aimauta-Rag-Contract": "2"
        }
      });
    });

    await expect(request()).resolves.toBeNull();
  });
});
