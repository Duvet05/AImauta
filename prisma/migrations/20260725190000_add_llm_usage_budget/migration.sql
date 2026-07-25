-- Aggregate-only daily model budget. This table intentionally contains no
-- prompts, responses, learner identifiers or provider credentials.
CREATE TABLE "LlmUsageDay" (
    "day" VARCHAR(10) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmUsageDay_pkey" PRIMARY KEY ("day"),
    CONSTRAINT "LlmUsageDay_day_check" CHECK (
      "day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ),
    CONSTRAINT "LlmUsageDay_counts_check" CHECK (
      "requestCount" >= 0 AND
      "inputTokens" >= 0 AND
      "outputTokens" >= 0 AND
      "reservedInputTokens" >= 0 AND
      "reservedOutputTokens" >= 0
    )
);
