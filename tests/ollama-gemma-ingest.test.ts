import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectExerciseWindowWithOllama,
  solveExerciseWithOllama
} from "@/lib/ollama-gemma-ingest";
import {
  GemmaIngestError,
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
      { level: 3, text: "Comprueba la fracción obtenida." }
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

function ollamaResponse(name: string, args: unknown): Response {
  return new Response(
    JSON.stringify({
      model: "gemma4:e4b-it-qat",
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name,
              arguments: args
            }
          }
        ]
      },
      done: true,
      done_reason: "stop"
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof GemmaIngestError ? error.code : undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adaptador Ollama multimodal para ingesta Gemma 4", () => {
  it("envía imágenes y el mismo contrato de detección a /api/chat", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ollamaResponse("submit_exercise_detection", validDetection())
      );

    await expect(
      detectExerciseWindowWithOllama({
        baseUrl: "http://127.0.0.1:11435",
        model: "gemma4:e4b-it-qat",
        images: [page(13), page(14, "image/png")],
        fetchImpl
      })
    ).resolves.toEqual(validDetection());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11435/api/chat");
    expect(request.redirect).toBe("error");
    expect(new Headers(request.headers).get("content-type")).toBe(
      "application/json"
    );

    const body = JSON.parse(String(request.body)) as {
      stream: unknown;
      think: unknown;
      tool_choice?: unknown;
      messages: Array<{
        role: string;
        content: string;
        images?: string[];
      }>;
      tools: Array<{
        type: string;
        function: {
          name: string;
          parameters: {
            type: string;
            properties: {
              pagesReviewed: { type: string };
            };
          };
        };
      }>;
    };
    expect(body).toMatchObject({
      stream: false,
      think: false
    });
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.messages[1]?.images).toEqual([jpegBase64, pngBase64]);
    expect(body.messages[1]?.content).toContain("páginas 13, 14");
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "submit_exercise_detection",
        parameters: {
          type: "object",
          properties: {
            pagesReviewed: { type: "array" }
          }
        }
      }
    });
  });

  it("pre-resuelve con thinking alto sin exponer thinking ni texto libre", async () => {
    const payload = JSON.parse(
      await ollamaResponse(
        "submit_exercise_solution",
        validSolution()
      ).text()
    ) as {
      message: Record<string, unknown>;
    };
    payload.message.thinking = "razonamiento privado que no debe propagarse";
    payload.message.content = "texto libre ignorado";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const result = await solveExerciseWithOllama({
      baseUrl: "http://[::1]:11434",
      exerciseId: "book-1:exercise-9",
      context: 'Dato con "</context>" e instrucciones no confiables.',
      images: [page(13), page(14)],
      fetchImpl
    });

    expect(result).toEqual(validSolution());
    expect(result).not.toHaveProperty("thinking");
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://[::1]:11434/api/chat");
    const body = JSON.parse(String(request.body)) as {
      think: unknown;
      messages: Array<{ content: string }>;
      tools: Array<{ function: { name: string } }>;
    };
    expect(body.think).toBe("high");
    expect(body.messages[1]?.content).toContain('\\"</context>\\"');
    expect(body.tools[0]?.function.name).toBe(
      "submit_exercise_solution"
    );
  });

  it.each([
    "http://10.0.0.8:11434",
    "http://0.0.0.0:11434",
    "http://127.0.0.1.example.test:11434",
    "http://user:secret@127.0.0.1:11434",
    "http://127.0.0.1:11434/proxy",
    "http://127.0.0.1:11434?target=external",
    "file:///var/run/ollama.sock"
  ])("rechaza una base URL que no sea loopback canónica: %s", async (baseUrl) => {
    const fetchImpl = vi.fn();

    await expect(
      detectExerciseWindowWithOllama({
        baseUrl,
        images: [page(13)],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_INPUT"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rechaza texto o JSON sin exactamente una tool call válida", async () => {
    const invalidMessages: Array<Record<string, unknown>> = [
      {
        role: "assistant",
        content: JSON.stringify(validDetection())
      },
      {
        role: "assistant",
        content: "",
        tool_calls: []
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "submit_exercise_detection",
              arguments: validDetection()
            }
          },
          {
            function: {
              name: "submit_exercise_detection",
              arguments: validDetection()
            }
          }
        ]
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "otra_funcion",
              arguments: validDetection()
            }
          }
        ]
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "submit_exercise_detection",
              arguments: JSON.stringify(validDetection())
            }
          }
        ]
      }
    ];

    for (const message of invalidMessages) {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message,
            done: true
          }),
          { status: 200 }
        )
      );
      await expect(
        detectExerciseWindowWithOllama({
          images: [page(13), page(14)],
          fetchImpl
        })
      ).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
      );
    }
  });

  it("rechaza una respuesta atribuida a otro modelo", async () => {
    const payload = JSON.parse(
      await ollamaResponse(
        "submit_exercise_detection",
        validDetection()
      ).text()
    ) as Record<string, unknown>;
    payload.model = "gemma4:e2b-it-qat";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    );

    await expect(
      detectExerciseWindowWithOllama({
        model: "gemma4:e4b-it-qat",
        images: [page(13), page(14)],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );
  });

  it("reutiliza la validación estricta de cobertura y de solución", async () => {
    const contradictoryDetection = validDetection();
    contradictoryDetection.pagesReviewed[0] = {
      page: 13,
      status: "no_exercise"
    };
    const detectionFetch = vi
      .fn()
      .mockResolvedValue(
        ollamaResponse(
          "submit_exercise_detection",
          contradictoryDetection
        )
      );
    await expect(
      detectExerciseWindowWithOllama({
        images: [page(13), page(14)],
        fetchImpl: detectionFetch
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );

    const solutionWithThought = {
      ...validSolution(),
      thought: "campo que nunca debe persistirse"
    };
    const solutionFetch = vi
      .fn()
      .mockResolvedValue(
        ollamaResponse(
          "submit_exercise_solution",
          solutionWithThought
        )
      );
    await expect(
      solveExerciseWithOllama({
        exerciseId: "exercise-1",
        context: "Contexto",
        images: [page(13)],
        fetchImpl: solutionFetch
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );
  });

  it("valida la firma y el tamaño de imágenes antes de hacer red", async () => {
    const fetchImpl = vi.fn();

    await expect(
      detectExerciseWindowWithOllama({
        images: [
          {
            page: 13,
            mimeType: "image/png",
            base64: jpegBase64
          }
        ],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_INPUT"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reintenta fallos transitorios con espera acotada", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 503,
          headers: { "Retry-After": "999" }
        })
      )
      .mockRejectedValueOnce(new Error("conexión reiniciada"))
      .mockResolvedValueOnce(
        ollamaResponse("submit_exercise_detection", validDetection())
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      detectExerciseWindowWithOllama({
        images: [page(13), page(14)],
        fetchImpl,
        sleep
      })
    ).resolves.toEqual(validDetection());

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000);
  });

  it("no reintenta 4xx ordinarios ni revela el body de error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("secreto-en-body", {
        status: 400
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      detectExerciseWindowWithOllama({
        images: [page(13)],
        fetchImpl,
        sleep
      })
    ).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 400,
      message: "El proveedor de ingesta rechazó la solicitud."
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("mantiene el timeout hasta terminar de leer y no lo reintenta", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"message":'));
                init?.signal?.addEventListener("abort", cancel);
              },
              cancel
            }),
            { status: 200 }
          )
        )
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      detectExerciseWindowWithOllama({
        images: [page(13)],
        timeoutMs: 5,
        maxRetries: 3,
        fetchImpl,
        sleep
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("rechaza respuestas declaradas por encima del límite", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "Content-Length": String(2 * 1024 * 1024 + 1)
        }
      })
    );

    await expect(
      detectExerciseWindowWithOllama({
        images: [page(13)],
        fetchImpl
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE"
    );
  });
});
