import { afterEach, describe, expect, it, vi } from "vitest";

import { askOllama } from "@/lib/ollama";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
});

describe("cliente Ollama", () => {
  it("desactiva razonamiento oculto para reservar la salida al alumno", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11435";
    process.env.OLLAMA_MODEL = "gemma4:e4b-it-qat";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { content: "OBSERVA" }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      askOllama({
        systemPrompt: "Guía con una pregunta.",
        studentMessage: "No entiendo.",
        attempt: "Identificaría los datos.",
        policy: {
          hintLevel: 1,
          canRevealSolution: false,
          maxOutputTokens: 12,
          stage: "learn"
        }
      })
    ).resolves.toBe("OBSERVA");

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      think?: unknown;
      stream?: unknown;
      options?: { num_predict?: unknown };
    };
    expect(body).toMatchObject({
      think: false,
      stream: false,
      options: { num_predict: 12 }
    });
  });
});
