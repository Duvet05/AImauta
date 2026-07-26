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
  parseGuideMessage,
  type TurnPolicy,
} from "@/lib/pedagogy";

export type TutorLlmProvider =
  | "ollama"
  | "openai"
  | "xai"
  | "gemini";

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

type ProviderConfig =
  | {
      endpoint: string;
      model: string;
      provider: "ollama";
    }
  | {
      apiKey: string;
      endpoint: string;
      model: string;
      provider: Exclude<TutorLlmProvider, "ollama">;
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
const HARD_MAX_OUTPUT_TOKENS = 320;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const APPROVED_OLLAMA_MODEL = "gemma4:e4b-it-qat";
const APPROVED_GEMINI_MODEL = "gemini-3.6-flash";

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
  const allowed = new Set<TutorLlmProvider>([
    "ollama",
    "openai",
    "xai",
    "gemini",
  ]);
  const primary = (
    process.env.LLM_PROVIDER ?? "ollama"
  ).trim().toLowerCase();
  if (!allowed.has(primary as TutorLlmProvider)) {
    return [];
  }
  const fallbacks = (
    process.env.LLM_FALLBACK_PROVIDERS ??
    process.env.LLM_FALLBACK_PROVIDER ??
    ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(
      (value): value is TutorLlmProvider =>
        allowed.has(value as TutorLlmProvider) && value !== primary,
    );
  return [
    primary as TutorLlmProvider,
    ...new Set(fallbacks),
  ].slice(0, 3);
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") {
    return true;
  }
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets.every(
      (octet) =>
        /^\d{1,3}$/u.test(octet) &&
        Number(octet) >= 0 &&
        Number(octet) <= 255,
    ) &&
    Number(octets[0]) === 127
  );
}

function ollamaEndpoint(): string | null {
  let baseUrl: URL;
  try {
    baseUrl = new URL(
      process.env.OLLAMA_BASE_URL?.trim() ??
        "http://127.0.0.1:11435",
    );
  } catch {
    return null;
  }
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
    !isLoopbackHostname(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash ||
    (baseUrl.port !== "" && Number(baseUrl.port) === 0)
  ) {
    return null;
  }
  return `${baseUrl.origin}/api/chat`;
}

function providerConfig(
  provider: TutorLlmProvider,
): ProviderConfig | null {
  if (provider === "ollama") {
    const model =
      process.env.OLLAMA_MODEL?.trim() ?? APPROVED_OLLAMA_MODEL;
    const endpoint = ollamaEndpoint();
    if (model !== APPROVED_OLLAMA_MODEL || !endpoint) {
      return null;
    }
    return {
      endpoint,
      model,
      provider,
    };
  }
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
  if (provider === "gemini") {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    const model = process.env.GOOGLE_GENAI_MODEL;
    if (
      !apiKey ||
      apiKey !== apiKey.trim() ||
      apiKey.length > 4_096 ||
      model !== APPROVED_GEMINI_MODEL
    ) {
      return null;
    }
    return {
      apiKey,
      endpoint:
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        `${APPROVED_GEMINI_MODEL}:generateContent`,
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

function requestTimeoutMs(provider: TutorLlmProvider): number {
  if (provider === "ollama") {
    return boundedPositiveInteger(
      "OLLAMA_TIMEOUT_MS",
      45_000,
      45_000,
    );
  }
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
  // OpenAI Responses rejects values below 16. The mode-specific parser still
  // limits the accepted semantic output to a single pedagogical move
  // (socratic) or a short bounded guidance message (guide).
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

function ollamaResult(
  payload: unknown,
  config: Extract<ProviderConfig, { provider: "ollama" }>,
): {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
} | null {
  if (
    !isRecord(payload) ||
    payload.model !== config.model ||
    payload.done !== true ||
    !isRecord(payload.message) ||
    payload.message.role !== "assistant" ||
    typeof payload.message.content !== "string" ||
    !payload.message.content.trim()
  ) {
    return null;
  }
  return {
    content: payload.message.content.trim(),
    inputTokens: tokenCount(payload.prompt_eval_count),
    outputTokens: tokenCount(payload.eval_count),
  };
}

function geminiResult(
  payload: unknown,
): {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
} | null {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.candidates) ||
    payload.candidates.length !== 1
  ) {
    return null;
  }
  const candidate = payload.candidates[0];
  if (
    !isRecord(candidate) ||
    candidate.finishReason !== "STOP" ||
    !isRecord(candidate.content) ||
    candidate.content.role !== "model" ||
    !Array.isArray(candidate.content.parts)
  ) {
    return null;
  }

  const textParts: string[] = [];
  for (const part of candidate.content.parts) {
    if (!isRecord(part)) {
      return null;
    }
    if (part.thought === true) {
      continue;
    }
    if (typeof part.text !== "string" || !part.text.trim()) {
      return null;
    }
    textParts.push(part.text.trim());
  }
  if (textParts.length !== 1) {
    return null;
  }

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  if (isRecord(payload.usageMetadata)) {
    inputTokens = tokenCount(payload.usageMetadata.promptTokenCount);
    const answerTokens = tokenCount(
      payload.usageMetadata.candidatesTokenCount,
    );
    const thinkingTokens =
      tokenCount(payload.usageMetadata.thoughtsTokenCount) ?? 0;
    if (
      answerTokens !== undefined &&
      answerTokens + thinkingTokens <= 10_000_000
    ) {
      outputTokens = answerTokens + thinkingTokens;
    }
  }
  return {
    content: textParts[0],
    inputTokens,
    outputTokens,
  };
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
    let body: Record<string, unknown>;
    if (config.provider === "ollama") {
      body = {
        model: config.model,
        stream: false,
        think: false,
        keep_alive: "10m",
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: prompt },
        ],
        options: {
          temperature: 0,
          num_ctx: 4_096,
          num_predict: maxOutputTokens,
        },
      };
    } else if (config.provider === "gemini") {
      body = {
        systemInstruction: {
          parts: [{ text: input.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens,
          thinkingConfig: {
            thinkingLevel: "minimal",
            includeThoughts: false,
          },
        },
        store: false,
      };
    } else {
      body = {
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
    }

    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.provider === "gemini") {
        headers["x-goog-api-key"] = config.apiKey;
      } else if (config.provider !== "ollama") {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }
      response = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs(config.provider)),
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
    const ollama =
      config.provider === "ollama"
        ? ollamaResult(payload, config)
        : null;
    const gemini =
      config.provider === "gemini" ? geminiResult(payload) : null;
    const content =
      config.provider === "ollama"
        ? ollama?.content ?? null
        : config.provider === "gemini"
          ? gemini?.content ?? null
          : responseText(payload);
    if (!content) {
      throw new ProviderRequestError(config.provider, null);
    }
    if (ollama) {
      actualInputTokens = ollama.inputTokens;
      actualOutputTokens = ollama.outputTokens;
    } else if (gemini) {
      actualInputTokens = gemini.inputTokens;
      actualOutputTokens = gemini.outputTokens;
    } else if (isRecord(payload) && isRecord(payload.usage)) {
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
        const valid =
          input.policy.mode === "socratic"
            ? parseGuidanceMove(result.content) !== null
            : parseGuideMessage(result.content) !== null;
        if (valid) {
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
