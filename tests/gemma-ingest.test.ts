import { describe, expect, it, vi } from "vitest";

import {
  GemmaIngestError,
  detectExerciseWindowWithGemma,
  solveExerciseWithGemma,
  type GemmaIngestImage
} from "@/lib/gemma-ingest";

const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]).toString(
  "base64"
);
const pngBase64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
]).toString("base64");

function page(
  number: number,
  mimeType: GemmaIngestImage["mimeType"] = "image/jpeg"
): GemmaIngestImage {
  return {
    page: number,
    mimeType,
    base64: mimeType === "image/jpeg" ? jpegBase64 : pngBase64
  };
}

function providerResponse(name: string, args: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ functionCall: { name, args } }]
          }
        }
      ]
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}

function validDetection() {
  return {
    pagesReviewed: [
      { page: 13, status: "exercise_found" },
      { page: 14, status: "exercise_found" }
    ],
    exercises: [
      {
        candidateId: "window-13-exercise-1",
        printedLabel: "1",
        kind: "problem",
        promptText: "Calcula la cantidad solicitada.",
        continuation: "to_next",
        confidence: 0.91,
        regions: [
          {
            page: 13,
            box2d: [120, 80, 930, 920],
            role: "statement"
          },
          {
            page: 14,
            box2d: [30, 70, 350, 930],
            role: "continuation"
          }
        ]
      }
    ]
  };
}

function validSolution() {
  return {
    finalAnswer: "3/4",
    pedagogicalSteps: [
      "Identifica las cantidades dadas.",
      "Expresa ambas cantidades con el mismo denominador.",
      "Comprueba que el resultado esté simplificado."
    ],
    hints: [
      { level: 1, text: "¿Qué cantidades aparecen en el enunciado?" },
      { level: 2, text: "Busca un denominador común." },
      { level: 3, text: "Compara el numerador obtenido con el denominador." }
    ],
    rubric: [
      {
        criterion: "Representación",
        expectedEvidence: "Escribe fracciones equivalentes."
      }
    ],
    confidence: 0.94
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof GemmaIngestError ? error.code : undefined;
}

describe("proveedor Gemma 4 para ingesta", () => {
  it("detecta una ventana multimodal con thinking mínimo y función obligatoria", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        providerResponse("submit_exercise_detection", validDetection())
      );

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13), page(14, "image/png")],
        fetchImpl
      })
    ).resolves.toEqual(validDetection());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent"
    );
    expect(new Headers(request.headers).get("x-goog-api-key")).toBe(
      "test-api-key"
    );
    expect(request.redirect).toBe("error");

    const body = JSON.parse(String(request.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: {
        thinkingConfig: Record<string, unknown>;
      };
      toolConfig: {
        functionCallingConfig: Record<string, unknown>;
      };
      tools: Array<{
        functionDeclarations: Array<{ name: string }>;
      }>;
    };
    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "minimal",
      includeThoughts: false
    });
    expect(body.toolConfig.functionCallingConfig).toEqual({
      mode: "ANY",
      allowedFunctionNames: ["submit_exercise_detection"]
    });
    expect(body.tools[0]?.functionDeclarations[0]?.name).toBe(
      "submit_exercise_detection"
    );
    expect(body.contents[0]?.parts[0]).toHaveProperty("inlineData");
    expect(body.contents[0]?.parts[1]).toHaveProperty("inlineData");
    expect(body.contents[0]?.parts[2]).toHaveProperty("text");
  });

  it("pre-resuelve con thinking alto y no expone partes thought", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { thought: true, text: "resumen que debe ignorarse" },
                  {
                    functionCall: {
                      name: "submit_exercise_solution",
                      args: validSolution()
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await solveExerciseWithGemma({
      apiKey: "test-api-key",
      exerciseId: "book-1:exercise-9",
      context: "Ejercicio de suma de fracciones.",
      images: [page(13), page(14)],
      endpoint: "https://provider.example/v1beta/",
      allowNonGoogleEndpoint: true,
      model: "gemma-4-31b-it",
      fetchImpl
    });

    expect(result).toEqual(validSolution());
    expect(result).not.toHaveProperty("thought");
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://provider.example/v1beta/models/gemma-4-31b-it:generateContent"
    );
    const body = JSON.parse(String(request.body)) as {
      generationConfig: { thinkingConfig: Record<string, unknown> };
      toolConfig: { functionCallingConfig: Record<string, unknown> };
    };
    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "high",
      includeThoughts: false
    });
    expect(body.toolConfig.functionCallingConfig).toEqual({
      mode: "ANY",
      allowedFunctionNames: ["submit_exercise_solution"]
    });
  });

  it("rechaza cajas fuera de rango o con ejes invertidos", async () => {
    const invalid = validDetection();
    invalid.exercises[0]!.regions[0]!.box2d = [800, 80, 200, 920];
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        providerResponse("submit_exercise_detection", invalid)
      );

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13), page(14)],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );
  });

  it("exige cobertura exacta de las páginas solicitadas", async () => {
    const invalid = validDetection();
    invalid.pagesReviewed = [{ page: 13, status: "exercise_found" }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        providerResponse("submit_exercise_detection", invalid)
      );

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13), page(14)],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );
  });

  it("ignora texto pero rechaza una función ausente o distinta", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { text: JSON.stringify(validDetection()) },
                  {
                    functionCall: {
                      name: "otra_funcion",
                      args: validDetection()
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13), page(14)],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );
  });

  it("valida imágenes, tipo real y máximo de tres páginas de detección", async () => {
    const fetchImpl = vi.fn();
    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [
          page(1),
          page(2),
          page(3),
          page(4)
        ],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_INPUT"
    );

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [{ page: 1, mimeType: "image/png", base64: jpegBase64 }],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_INPUT"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rechaza endpoints no oficiales salvo opt-in explícito", async () => {
    const fetchImpl = vi.fn();

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        endpoint: "https://generativelanguage.googleapis.com.evil.test/v1beta",
        images: [page(13)],
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rechaza campos extra y exige las pistas 1, 2 y 3 en orden", async () => {
    const withThought = {
      ...validSolution(),
      thought: "no debe persistirse"
    };
    const fetchWithThought = vi
      .fn()
      .mockResolvedValue(
        providerResponse("submit_exercise_solution", withThought)
      );
    await expect(
      solveExerciseWithGemma({
        apiKey: "test-api-key",
        exerciseId: "exercise-1",
        context: "Contexto",
        images: [page(1)],
        fetchImpl: fetchWithThought
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );

    const wrongHints = validSolution();
    wrongHints.hints = [
      wrongHints.hints[1]!,
      wrongHints.hints[0]!,
      wrongHints.hints[2]!
    ];
    const fetchWrongHints = vi
      .fn()
      .mockResolvedValue(
        providerResponse("submit_exercise_solution", wrongHints)
      );
    await expect(
      solveExerciseWithGemma({
        apiKey: "test-api-key",
        exerciseId: "exercise-1",
        context: "Contexto",
        images: [page(1)],
        fetchImpl: fetchWrongHints
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );
  });

  it("reintenta sólo 429 y 5xx, respeta Retry-After acotado y se recupera", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "999" }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        providerResponse("submit_exercise_detection", validDetection())
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13), page(14)],
        fetchImpl,
        sleep
      })
    ).resolves.toEqual(validDetection());

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000);
  });

  it("limita a tres reintentos y no reintenta errores 4xx ordinarios", async () => {
    const retryingFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13)],
        fetchImpl: retryingFetch,
        sleep
      })
    ).rejects.toMatchObject({ code: "HTTP_ERROR", status: 500 });
    expect(retryingFetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);

    const ordinaryFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 400 }));
    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13)],
        fetchImpl: ordinaryFetch,
        sleep
      })
    ).rejects.toMatchObject({ code: "HTTP_ERROR", status: 400 });
    expect(ordinaryFetch).toHaveBeenCalledTimes(1);
  });

  it("aplica timeout sin reintentar ni revelar el error de red", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("la clave nunca debe aparecer"));
          });
        })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "secret-api-key",
        images: [page(13)],
        timeoutMs: 5,
        fetchImpl,
        sleep
      })
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "El proveedor de ingesta excedió el tiempo permitido."
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("mantiene el timeout activo hasta terminar de leer el body", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('{"candidates":[')
                );
                init?.signal?.addEventListener("abort", () => {
                  cancel();
                });
              },
              cancel
            }),
            { status: 200 }
          )
        )
    );

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "secret-api-key",
        images: [page(13)],
        timeoutMs: 5,
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(cancel).toHaveBeenCalled();
  });

  it("rechaza un body transmitido que supera el límite sin Content-Length", async () => {
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
    oversized.fill(0x20);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          }
        }),
        { status: 200 }
      )
    );

    await expect(
      detectExerciseWindowWithGemma({
        apiKey: "test-api-key",
        images: [page(13)],
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
