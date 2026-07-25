import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const HARD_DAILY_REQUEST_LIMIT = 300;
const HARD_DAILY_INPUT_TOKEN_LIMIT = 150_000;
const HARD_DAILY_OUTPUT_TOKEN_LIMIT = 6_000;

export type LlmUsageReservation = {
  day: string;
  inputTokens: number;
  outputTokens: number;
};

export class LlmBudgetExceededError extends Error {
  constructor() {
    super("El presupuesto diario del tutor alcanzó su límite.");
    this.name = "LlmBudgetExceededError";
  }
}

export class LlmBudgetUnavailableError extends Error {
  constructor() {
    super("El control de presupuesto del tutor no está disponible.");
    this.name = "LlmBudgetUnavailableError";
  }
}

function boundedPositiveInteger(
  name: string,
  fallback: number,
  hardMaximum: number,
): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, hardMaximum);
}

export function llmDailyLimits() {
  return {
    requests: boundedPositiveInteger(
      "AIMAUTA_LLM_DAILY_REQUEST_LIMIT",
      HARD_DAILY_REQUEST_LIMIT,
      HARD_DAILY_REQUEST_LIMIT,
    ),
    inputTokens: boundedPositiveInteger(
      "AIMAUTA_LLM_DAILY_INPUT_TOKEN_LIMIT",
      HARD_DAILY_INPUT_TOKEN_LIMIT,
      HARD_DAILY_INPUT_TOKEN_LIMIT,
    ),
    outputTokens: boundedPositiveInteger(
      "AIMAUTA_LLM_DAILY_OUTPUT_TOKEN_LIMIT",
      HARD_DAILY_OUTPUT_TOKEN_LIMIT,
      HARD_DAILY_OUTPUT_TOKEN_LIMIT,
    ),
  };
}

export function estimateLlmInputTokens(
  systemPrompt: string,
  userPrompt: string,
): number {
  // Spanish text is normally well below one token per two characters. Using
  // two characters per token plus fixed protocol overhead deliberately
  // over-reserves the daily budget.
  return Math.max(
    1,
    Math.ceil((systemPrompt.length + userPrompt.length) / 2) + 192,
  );
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function reserveLlmUsage(input: {
  estimatedInputTokens: number;
  maximumOutputTokens: number;
  now?: Date;
}): Promise<LlmUsageReservation> {
  const estimatedInputTokens = Math.max(
    1,
    Math.ceil(input.estimatedInputTokens),
  );
  const maximumOutputTokens = Math.max(
    1,
    Math.ceil(input.maximumOutputTokens),
  );
  const limits = llmDailyLimits();
  if (
    estimatedInputTokens > limits.inputTokens ||
    maximumOutputTokens > limits.outputTokens
  ) {
    throw new LlmBudgetExceededError();
  }

  const day = utcDay(input.now ?? new Date());
  let rows: Array<{ day: string }>;
  try {
    rows = await prisma.$queryRaw<Array<{ day: string }>>(
      Prisma.sql`
        INSERT INTO "LlmUsageDay" (
          "day",
          "requestCount",
          "inputTokens",
          "outputTokens",
          "reservedInputTokens",
          "reservedOutputTokens",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${day},
          1,
          0,
          0,
          ${estimatedInputTokens},
          ${maximumOutputTokens},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("day") DO UPDATE SET
          "requestCount" = "LlmUsageDay"."requestCount" + 1,
          "reservedInputTokens" =
            "LlmUsageDay"."reservedInputTokens" + ${estimatedInputTokens},
          "reservedOutputTokens" =
            "LlmUsageDay"."reservedOutputTokens" + ${maximumOutputTokens},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE
          "LlmUsageDay"."requestCount" < ${limits.requests} AND
          "LlmUsageDay"."inputTokens" +
            "LlmUsageDay"."reservedInputTokens" +
            ${estimatedInputTokens} <= ${limits.inputTokens} AND
          "LlmUsageDay"."outputTokens" +
            "LlmUsageDay"."reservedOutputTokens" +
            ${maximumOutputTokens} <= ${limits.outputTokens}
        RETURNING "day"
      `,
    );
  } catch {
    throw new LlmBudgetUnavailableError();
  }
  if (rows.length !== 1) {
    throw new LlmBudgetExceededError();
  }
  return {
    day,
    inputTokens: estimatedInputTokens,
    outputTokens: maximumOutputTokens,
  };
}

export async function settleLlmUsage(input: {
  reservation: LlmUsageReservation;
  actualInputTokens?: number;
  actualOutputTokens?: number;
}): Promise<void> {
  const actualInputTokens = Math.max(
    0,
    Math.ceil(
      input.actualInputTokens ?? input.reservation.inputTokens,
    ),
  );
  const actualOutputTokens = Math.max(
    0,
    Math.ceil(
      input.actualOutputTokens ?? input.reservation.outputTokens,
    ),
  );
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "LlmUsageDay"
      SET
        "reservedInputTokens" = GREATEST(
          0,
          "reservedInputTokens" - ${input.reservation.inputTokens}
        ),
        "reservedOutputTokens" = GREATEST(
          0,
          "reservedOutputTokens" - ${input.reservation.outputTokens}
        ),
        "inputTokens" = "inputTokens" + ${actualInputTokens},
        "outputTokens" = "outputTokens" + ${actualOutputTokens},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "day" = ${input.reservation.day}
    `,
  );
}
