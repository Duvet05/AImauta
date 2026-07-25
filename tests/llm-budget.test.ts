import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: database.queryRaw,
    $executeRaw: database.executeRaw,
  },
}));

import {
  estimateLlmInputTokens,
  llmDailyLimits,
  LlmBudgetExceededError,
  reserveLlmUsage,
  settleLlmUsage,
} from "@/lib/llm-budget";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.AIMAUTA_LLM_DAILY_REQUEST_LIMIT;
  delete process.env.AIMAUTA_LLM_DAILY_INPUT_TOKEN_LIMIT;
  delete process.env.AIMAUTA_LLM_DAILY_OUTPUT_TOKEN_LIMIT;
});

describe("presupuesto persistente del tutor", () => {
  it("aplica techos de código aunque el entorno pida valores mayores", () => {
    process.env.AIMAUTA_LLM_DAILY_REQUEST_LIMIT = "999999";
    process.env.AIMAUTA_LLM_DAILY_INPUT_TOKEN_LIMIT = "999999999";
    process.env.AIMAUTA_LLM_DAILY_OUTPUT_TOKEN_LIMIT = "999999999";

    expect(llmDailyLimits()).toEqual({
      requests: 300,
      inputTokens: 150_000,
      outputTokens: 6_000,
    });
  });

  it("sobreestima de forma conservadora el texto enviado", () => {
    expect(estimateLlmInputTokens("a".repeat(1_000), "b".repeat(500))).toBe(
      942,
    );
  });

  it("reserva antes de llamar al proveedor", async () => {
    database.queryRaw.mockResolvedValue([{ day: "2026-07-25" }]);

    await expect(
      reserveLlmUsage({
        estimatedInputTokens: 1_000,
        maximumOutputTokens: 16,
        now: new Date("2026-07-25T18:00:00Z"),
      }),
    ).resolves.toEqual({
      day: "2026-07-25",
      inputTokens: 1_000,
      outputTokens: 16,
    });
    expect(database.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("falla cerrado cuando PostgreSQL rechaza la reserva por cuota", async () => {
    database.queryRaw.mockResolvedValue([]);

    await expect(
      reserveLlmUsage({
        estimatedInputTokens: 1_000,
        maximumOutputTokens: 16,
      }),
    ).rejects.toBeInstanceOf(LlmBudgetExceededError);
  });

  it("liquida el uso real contra la reserva", async () => {
    database.executeRaw.mockResolvedValue(1);

    await settleLlmUsage({
      reservation: {
        day: "2026-07-25",
        inputTokens: 1_000,
        outputTokens: 16,
      },
      actualInputTokens: 420,
      actualOutputTokens: 2,
    });
    expect(database.executeRaw).toHaveBeenCalledTimes(1);
  });
});
