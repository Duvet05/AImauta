import { afterEach, describe, expect, it, vi } from "vitest";

const budget = vi.hoisted(() => {
  class BudgetExceeded extends Error {}
  class BudgetUnavailable extends Error {}
  return {
    BudgetExceeded,
    BudgetUnavailable,
    reserve: vi.fn(async () => ({
      day: "2026-07-25",
      inputTokens: 500,
      outputTokens: 16,
    })),
    settle: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/llm-budget", () => ({
  estimateLlmInputTokens: vi.fn(() => 500),
  LlmBudgetExceededError: budget.BudgetExceeded,
  LlmBudgetUnavailableError: budget.BudgetUnavailable,
  reserveLlmUsage: budget.reserve,
  settleLlmUsage: budget.settle,
}));

import { askTutorModel } from "@/lib/llm";

const envKeys = [
  "LLM_PROVIDER",
  "LLM_FALLBACK_PROVIDER",
  "LLM_FALLBACK_PROVIDERS",
  "AIMAUTA_LLM_TIMEOUT_MS",
  "AIMAUTA_LLM_MAX_CONCURRENCY",
  "AIMAUTA_LLM_ATTEMPTS_PER_MINUTE",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "XAI_API_KEY",
  "XAI_MODEL",
] as const;

const tutorInput = {
  sessionId: "0dfc2ca0-6902-4c61-9357-e51e78d8508d",
  systemPrompt: "Devuelve únicamente una etiqueta permitida.",
  studentMessage: "¿Cómo empiezo?",
  attempt: "Observaría los datos.",
  policy: {
    hintLevel: 1 as const,
    canRevealSolution: false,
    maxOutputTokens: 12,
    stage: "learn" as const,
  },
};

function response(content: string): Response {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: content }],
        },
      ],
      usage: {
        input_tokens: 321,
        output_tokens: 2,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function configureProviders(): void {
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_FALLBACK_PROVIDER = "xai";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.OPENAI_MODEL = "gpt-4.1";
  process.env.XAI_API_KEY = "xai-test-key";
  process.env.XAI_MODEL = "grok-4.3";
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  budget.reserve.mockResolvedValue({
    day: "2026-07-25",
    inputTokens: 500,
    outputTokens: 16,
  });
  budget.settle.mockResolvedValue(undefined);
  for (const key of envKeys) {
    delete process.env[key];
  }
});

describe("router LLM del tutor", () => {
  it("usa OpenAI gpt-4.1 como proveedor principal sin almacenar la respuesta", async () => {
    configureProviders();
    const fetchMock = vi.fn().mockResolvedValue(response("OBSERVA"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askTutorModel(tutorInput)).resolves.toEqual({
      content: "OBSERVA",
      provider: "openai",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/responses",
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      Authorization: "Bearer openai-test-key",
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-4.1",
      max_output_tokens: 16,
      store: false,
      safety_identifier: expect.stringMatching(/^aimauta_[A-Za-z0-9_-]{32}$/),
      input: [
        { role: "system" },
        {
          role: "user",
          content:
            "Mi pregunta: ¿Cómo empiezo?\nMi intento: Observaría los datos.",
        },
      ],
    });
    expect(budget.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        actualInputTokens: 321,
        actualOutputTokens: 2,
      }),
    );
  });

  it("cambia una sola vez a xAI Grok 4.3 cuando OpenAI falla", async () => {
    configureProviders();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(response("DIVIDE"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askTutorModel(tutorInput)).resolves.toEqual({
      content: "DIVIDE",
      provider: "xai",
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.openai.com/v1/responses",
      "https://api.x.ai/v1/responses",
    ]);
    const fallbackRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(fallbackRequest.body))).toMatchObject({
      model: "grok-4.3",
      reasoning: { effort: "none" },
      store: false,
    });
    expect(budget.reserve).toHaveBeenCalledTimes(2);
  });

  it("cambia a xAI si OpenAI rompe el contrato de etiquetas", async () => {
    configureProviders();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response("Aquí tienes una explicación larga."))
      .mockResolvedValueOnce(response("REFORMULA"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askTutorModel(tutorInput)).resolves.toEqual({
      content: "REFORMULA",
      provider: "xai",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("usa xAI si falta la credencial primaria pero nunca habilita Ollama", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_FALLBACK_PROVIDER = "xai";
    process.env.XAI_API_KEY = "xai-test-key";
    process.env.XAI_MODEL = "grok-4.3";
    const fetchMock = vi.fn().mockResolvedValue(response("COMPARA"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askTutorModel(tutorInput)).resolves.toEqual({
      content: "COMPARA",
      provider: "xai",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.x.ai/v1/responses",
    );
  });

  it("cae al tutor determinista si el presupuesto no puede reservarse", async () => {
    configureProviders();
    budget.reserve.mockRejectedValueOnce(new budget.BudgetExceeded());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(askTutorModel(tutorInput)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza modelos distintos de los dos modelos aprobados", async () => {
    configureProviders();
    process.env.OPENAI_MODEL = "expensive-unreviewed-model";
    process.env.XAI_MODEL = "deprecated-model";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(askTutorModel(tutorInput)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falla sin incluir credenciales cuando ambos proveedores caen", async () => {
    configureProviders();
    process.env.OPENAI_API_KEY = "do-not-leak-openai";
    process.env.XAI_API_KEY = "do-not-leak-xai";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );

    const error = await askTutorModel(tutorInput).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("openai, xai");
    expect(String(error)).not.toContain("do-not-leak");
  });
});
