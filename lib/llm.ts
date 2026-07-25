import { createHash } from "node:crypto";

import {
  estimateLlmInputTokens,
  LlmBudgetExceededError,
  LlmBudgetUnavailableError,
  reserveLlmUsage,
  settleLlmUsage,
} from "@/lib/llm-budget";
import {
  parseGuidanceMove,
  type TurnPolicy,
} from "@/lib/pedagogy";

export type TutorLlmProvider = "openai" | "xai";

export type TutorLlmResult = {
  content: string;
  provider: TutorLlmProvider;
};

type TutorLlmInput = {
  sessionId: string;
  systemPrompt: string;
  studentMessage: string;
  attempt: string;
  policy: TurnPolicy;
};

type ProviderConfig = {
  apiKey: string;
  endpoint: string;
  model: string;
  provider: TutorLlmProvider;
};

type LlmProcessState = {
  activeRequests: number;
  minuteAttempts: number;
  minuteStartedAt: number;
};

const PROCESS_STATE_KEY = Symbol.for(
  "org.aimauta.foundation-model.process-state.v1",
);
const MAX_SYSTEM_PROMPT_CHARACTERS = 10_000;
const MAX_STUDENT_MESSAGE_CHARACTERS = 800;
const MAX_ATTEMPT_CHARACTERS = 1_200;
const HARD_MAX_CONCURRENCY = 2;
const HARD_MAX_ATTEMPTS_PER_MINUTE = 20;
const HARD_MAX_OUTPUT_TOKENS = 16;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

class ProviderRequestError extends Error {
  constructor(
    readonly provider: TutorLlmProvider,
    readonly status: number | null,
  ) {
    super(
      status === null
        ? `${provider} no respondió.`
        : `${provider} respondió HTTP ${status}.`,
    );
    this.name = "ProviderRequestError";
  }
}

function processState(): LlmProcessState {
  const processGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processGlobal[PROCESS_STATE_KEY];
  if (
    typeof existing === "object" &&
    existing !== null &&
    "activeRequests" in existing &&
    "minuteAttempts" in existing &&
    "minuteStartedAt" in existing
  ) {
    return existing as LlmProcessState;
  }
  const created: LlmProcessState = {
    activeRequests: 0,
    minuteAttempts: 0,
    minuteStartedAt: Date.now(),
  };
  processGlobal[PROCESS_STATE_KEY] = created;
  return created;
}

function boundedPositiveInteger(
  name: string,
  fallback: number,
  hardMaximum: number,
): number {
  const parsed = Number(process.env[name] ?? "");
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, hardMaximum);
}

function acquireCapacity(): (() => void) | null {
  const state = processState();
  const maximum = boundedPositiveInteger(
    "AIMAUTA_LLM_MAX_CONCURRENCY",
    HARD_MAX_CONCURRENCY,
    HARD_MAX_CONCURRENCY,
  );
  if (state.activeRequests >= maximum) {
    return null;
  }
  state.activeRequests += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      state.activeRequests = Math.max(0, state.activeRequests - 1);
    }
  };
}

function consumeMinuteAttempt(now = Date.now()): boolean {
  const state = processState();
  if (now - state.minuteStartedAt >= 60_000) {
    state.minuteStartedAt = now;
    state.minuteAttempts = 0;
  }
  const maximum = boundedPositiveInteger(
    "AIMAUTA_LLM_ATTEMPTS_PER_MINUTE",
    HARD_MAX_ATTEMPTS_PER_MINUTE,
    HARD_MAX_ATTEMPTS_PER_MINUTE,
  );
  if (state.minuteAttempts >= maximum) {
    return false;
  }
  state.minuteAttempts += 1;
  return true;
}

function providerOrder(): TutorLlmProvider[] {
  const primary = (
    process.env.LLM_PROVIDER ?? "openai"
  ).trim().toLowerCase();
  if (primary !== "openai") {
    return [];
  }
  const fallback = (
    process.env.LLM_FALLBACK_PROVIDER ??
    process.env.LLM_FALLBACK_PROVIDERS ??
    ""
  )
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  return fallback === "xai" ? ["openai", "xai"] : ["openai"];
}

function providerConfig(
  provider: TutorLlmProvider,
): ProviderConfig | null {
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;
    if (!apiKey || model !== "gpt-4.1") {
      return null;
    }
    return {
      apiKey,
      endpoint: "https://api.openai.com/v1/responses",
      model,
      provider,
    };
  }

  const apiKey = process.env.XAI_API_KEY;
  const model = process.env.XAI_MODEL;
  if (!apiKey || model !== "grok-4.3") {
    return null;
  }
  return {
    apiKey,
    endpoint: "https://api.x.ai/v1/responses",
    model,
    provider,
  };
}

function requestTimeoutMs(): number {
  const legacyTimeout = process.env.LLM_TIMEOUT_MS;
  if (
    !process.env.AIMAUTA_LLM_TIMEOUT_MS &&
    legacyTimeout
  ) {
    const parsed = Number(legacyTimeout);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? Math.min(parsed, 15_000)
      : 12_000;
  }
  return boundedPositiveInteger("AIMAUTA_LLM_TIMEOUT_MS", 12_000, 15_000);
}

function maximumOutputTokens(policy: TurnPolicy): number {
  // OpenAI Responses rejects values below 16. The strict label parser still
  // limits the accepted semantic output to a single pedagogical move.
  return Math.max(
    16,
    Math.min(policy.maxOutputTokens, HARD_MAX_OUTPUT_TOKENS),
  );
}

function userPrompt(input: TutorLlmInput): string {
  const question = input.studentMessage
    .trim()
    .slice(0, MAX_STUDENT_MESSAGE_CHARACTERS);
  const attempt = input.attempt
    .trim()
    .slice(0, MAX_ATTEMPT_CHARACTERS);
  return attempt
    ? `Mi pregunta: ${question}\nMi intento: ${attempt}`
    : question;
}

function safetyIdentifier(sessionId: string): string {
  return `aimauta_${createHash("sha256")
    .update(sessionId)
    .digest("base64url")
    .slice(0, 32)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function responseText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (
    typeof payload.output_text === "string" &&
    payload.output_text.trim()
  ) {
    return payload.output_text.trim();
  }
  if (!Array.isArray(payload.output)) {
    return null;
  }
  for (const item of payload.output) {
    if (!isRecord(item)) {
      continue;
    }
    if (item.type !== undefined && item.type !== "message") {
      continue;
    }
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }
      if (
        content.type !== undefined &&
        content.type !== "output_text"
      ) {
        continue;
      }
      if (typeof content.text === "string" && content.text.trim()) {
        return content.text.trim();
      }
    }
  }
  return null;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers
    .get("content-type")
    ?.toLocaleLowerCase("en-US");
  if (!contentType?.includes("application/json") || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Respuesta LLM no JSON.");
  }
  const declaredLength = response.headers.get("content-length")?.trim();
  if (
    declaredLength &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("Respuesta LLM excesiva.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Respuesta LLM excesiva.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error("Respuesta LLM inválida.");
  }
}

function tokenCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= 10_000_000
    ? Number(value)
    : undefined;
}

async function settleReservationSafely(input: {
  reservation: Awaited<ReturnType<typeof reserveLlmUsage>>;
  actualInputTokens?: number;
  actualOutputTokens?: number;
}): Promise<void> {
  try {
    await settleLlmUsage({
      reservation: input.reservation,
      actualInputTokens: input.actualInputTokens,
      actualOutputTokens: input.actualOutputTokens,
    });
  } catch {
    // The unresolved reservation remains in PostgreSQL and therefore fails
    // closed for the rest of the UTC day instead of permitting extra spend.
    console.error("LLM usage settlement unavailable");
  }
}

async function askProvider(
  config: ProviderConfig,
  input: TutorLlmInput,
): Promise<TutorLlmResult> {
  if (!consumeMinuteAttempt()) {
    throw new LlmBudgetExceededError();
  }
  const prompt = userPrompt(input);
  const maxOutputTokens = maximumOutputTokens(input.policy);
  const reservation = await reserveLlmUsage({
    estimatedInputTokens: estimateLlmInputTokens(
      input.systemPrompt,
      prompt,
    ),
    maximumOutputTokens: maxOutputTokens,
  });

  let actualInputTokens: number | undefined;
  let actualOutputTokens: number | undefined;
  try {
    const body: Record<string, unknown> = {
      model: config.model,
      input: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: prompt },
      ],
      max_output_tokens: maxOutputTokens,
      store: false,
    };
    if (config.provider === "openai") {
      body.safety_identifier = safetyIdentifier(input.sessionId);
    } else {
      body.reasoning = { effort: "none" };
    }

    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      };
      response = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs()),
        redirect: "error",
      });
    } catch {
      throw new ProviderRequestError(config.provider, null);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderRequestError(config.provider, response.status);
    }
    let payload: unknown;
    try {
      payload = await readBoundedJson(response);
    } catch {
      throw new ProviderRequestError(config.provider, null);
    }
    const content = responseText(payload);
    if (!content) {
      throw new ProviderRequestError(config.provider, null);
    }
    if (isRecord(payload) && isRecord(payload.usage)) {
      actualInputTokens = tokenCount(payload.usage.input_tokens);
      actualOutputTokens = tokenCount(payload.usage.output_tokens);
    }
    return { content, provider: config.provider };
  } finally {
    await settleReservationSafely({
      reservation,
      actualInputTokens,
      actualOutputTokens,
    });
  }
}

export async function askTutorModel(
  input: TutorLlmInput,
): Promise<TutorLlmResult | null> {
  if (
    !input.sessionId ||
    input.systemPrompt.length === 0 ||
    input.systemPrompt.length > MAX_SYSTEM_PROMPT_CHARACTERS
  ) {
    return null;
  }
  const release = acquireCapacity();
  if (!release) {
    return null;
  }

  const failedProviders: TutorLlmProvider[] = [];
  try {
    for (const provider of providerOrder()) {
      const config = providerConfig(provider);
      if (!config) {
        continue;
      }
      try {
        const result = await askProvider(config, input);
        if (parseGuidanceMove(result.content)) {
          return result;
        }
        failedProviders.push(provider);
      } catch (error) {
        if (
          error instanceof LlmBudgetExceededError ||
          error instanceof LlmBudgetUnavailableError
        ) {
          return null;
        }
        failedProviders.push(provider);
      }
    }
  } finally {
    release();
  }

  if (failedProviders.length > 0) {
    throw new Error(
      `Proveedores LLM no disponibles: ${failedProviders.join(", ")}`,
    );
  }
  return null;
}
