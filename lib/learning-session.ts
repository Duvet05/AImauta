import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

import { getBook } from "@/lib/catalog";
import {
  getPageActivity,
  type LearningStage,
  type PageActivity
} from "@/lib/curriculum";

const TOKEN_VERSION = 2;
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const MAX_TURNS_PER_SESSION = 40;
const MAX_TRACKED_SESSIONS = 20_000;

type RevisionStore = Map<
  string,
  { revision: number; expiresAt: number }
>;

type LearningSessionProcessState = {
  version: typeof TOKEN_VERSION;
  ephemeralSecret: Buffer;
  revisions: RevisionStore;
};

// Next.js can evaluate route bundles with independent module registries inside
// the same Node.js process. Symbol.for + globalThis keeps the anti-replay state
// (and the development-only ephemeral secret) coherent across those bundles.
// This remains intentionally process-local; multi-process deployments need a
// shared atomic store.
const PROCESS_STATE_KEY = Symbol.for(
  "org.aimauta.learning-session.process-state.v2"
);

function learningSessionProcessState(): LearningSessionProcessState {
  const processGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processGlobal[PROCESS_STATE_KEY];

  if (
    typeof existing === "object" &&
    existing !== null &&
    "version" in existing &&
    existing.version === TOKEN_VERSION &&
    "ephemeralSecret" in existing &&
    Buffer.isBuffer(existing.ephemeralSecret) &&
    "revisions" in existing &&
    existing.revisions instanceof Map
  ) {
    return existing as LearningSessionProcessState;
  }

  const created: LearningSessionProcessState = {
    version: TOKEN_VERSION,
    ephemeralSecret: randomBytes(32),
    revisions: new Map()
  };
  processGlobal[PROCESS_STATE_KEY] = created;
  return created;
}

const processState = learningSessionProcessState();
const ephemeralSecret = processState.ephemeralSecret;
const revisions = processState.revisions;

export type LearningSessionState = {
  sessionId: string;
  bookId: string;
  page: number;
  unitId: string | null;
  stage: LearningStage;
  attemptCount: number;
  turnCount: number;
  totalTurnCount: number;
  hintLevel: 0 | 1 | 2 | 3;
  revision: number;
  createdAt: number;
  expiresAt: number;
  lastAttemptDigest?: string;
};

type LearningSessionPayload = LearningSessionState & {
  version: typeof TOKEN_VERSION;
};

export class LearningSessionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid"
      | "expired"
      | "configuration"
      | "book"
      | "page"
      | "limit"
      | "stale"
  ) {
    super(message);
    this.name = "LearningSessionError";
  }
}

function secret(): Buffer {
  const configured = process.env.AIMAUTA_SESSION_SECRET;
  if (configured) {
    if (configured.length < 32) {
      throw new LearningSessionError(
        "AIMAUTA_SESSION_SECRET debe tener al menos 32 caracteres.",
        "configuration"
      );
    }
    return Buffer.from(configured, "utf8");
  }
  if (process.env.NODE_ENV === "production") {
    throw new LearningSessionError(
      "AIMAUTA_SESSION_SECRET es obligatorio en producción.",
      "configuration"
    );
  }
  return ephemeralSecret;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

function validateBookAndPage(bookId: string, page: number): PageActivity {
  const book = getBook(bookId);
  if (!book) {
    throw new LearningSessionError("Material no encontrado.", "book");
  }
  if (!Number.isInteger(page) || page < 1 || page > book.pages) {
    throw new LearningSessionError("Página fuera del material.", "page");
  }
  return getPageActivity(bookId, page);
}

function publicState(payload: LearningSessionPayload): LearningSessionState {
  return {
    sessionId: payload.sessionId,
    bookId: payload.bookId,
    page: payload.page,
    unitId: payload.unitId,
    stage: payload.stage,
    attemptCount: payload.attemptCount,
    turnCount: payload.turnCount,
    totalTurnCount: payload.totalTurnCount,
    hintLevel: payload.hintLevel,
    revision: payload.revision,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    lastAttemptDigest: payload.lastAttemptDigest
  };
}

function pruneRevisions(now: number): void {
  for (const [sessionId, tracked] of revisions) {
    if (tracked.expiresAt <= now) {
      revisions.delete(sessionId);
    }
  }
  while (revisions.size >= MAX_TRACKED_SESSIONS) {
    const oldest = revisions.keys().next().value as string | undefined;
    if (!oldest) break;
    revisions.delete(oldest);
  }
}

function trackIssued(payload: LearningSessionPayload): void {
  if (revisions.size >= MAX_TRACKED_SESSIONS) {
    pruneRevisions(Math.floor(Date.now() / 1_000));
  }
  revisions.set(payload.sessionId, {
    revision: payload.revision,
    expiresAt: payload.expiresAt
  });
}

function assertCurrentRevision(payload: LearningSessionPayload): void {
  const tracked = revisions.get(payload.sessionId);
  if (tracked && payload.revision < tracked.revision) {
    throw new LearningSessionError(
      "La sesión cambió en otro canal. Actualiza el contexto antes de continuar.",
      "stale"
    );
  }
  if (!tracked || payload.revision > tracked.revision) {
    trackIssued(payload);
  }
}

export function issueLearningSession(input: {
  bookId: string;
  page: number;
  now?: number;
}): { token: string; state: LearningSessionState; activity: PageActivity } {
  const activity = validateBookAndPage(input.bookId, input.page);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload: LearningSessionPayload = {
    version: TOKEN_VERSION,
    sessionId: randomUUID(),
    bookId: input.bookId,
    page: input.page,
    unitId: activity.unitId,
    stage: activity.stage,
    attemptCount: 0,
    turnCount: 0,
    totalTurnCount: 0,
    hintLevel: 0,
    revision: 0,
    createdAt: now,
    expiresAt: now + TOKEN_TTL_SECONDS
  };
  const token = serializeLearningSession(payload);
  trackIssued(payload);
  return {
    token,
    state: publicState(payload),
    activity
  };
}

function serializeLearningSession(payload: LearningSessionPayload): string {
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyLearningSession(
  token: string,
  now = Math.floor(Date.now() / 1000)
): LearningSessionState {
  if (!token || token.length > 4_096) {
    throw new LearningSessionError("Token de sesión inválido.", "invalid");
  }
  const [encodedPayload, providedSignature, extra] = token.split(".");
  if (!encodedPayload || !providedSignature || extra) {
    throw new LearningSessionError("Token de sesión inválido.", "invalid");
  }

  const expected = Buffer.from(sign(encodedPayload), "base64url");
  const provided = Buffer.from(providedSignature, "base64url");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new LearningSessionError("Firma de sesión inválida.", "invalid");
  }

  let payload: LearningSessionPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as LearningSessionPayload;
  } catch {
    throw new LearningSessionError("Sesión ilegible.", "invalid");
  }

  if (
    payload.version !== TOKEN_VERSION ||
    typeof payload.sessionId !== "string" ||
    typeof payload.bookId !== "string" ||
    !Number.isInteger(payload.page) ||
    !Number.isInteger(payload.attemptCount) ||
    !Number.isInteger(payload.turnCount) ||
    !Number.isInteger(payload.totalTurnCount) ||
    !Number.isInteger(payload.hintLevel) ||
    !Number.isInteger(payload.revision) ||
    payload.attemptCount < 0 ||
    payload.turnCount < 0 ||
    payload.totalTurnCount < 0 ||
    payload.hintLevel < 0 ||
    payload.hintLevel > 3 ||
    payload.revision < 0 ||
    typeof payload.createdAt !== "number" ||
    typeof payload.expiresAt !== "number"
  ) {
    throw new LearningSessionError("Contenido de sesión inválido.", "invalid");
  }
  if (payload.expiresAt <= now) {
    throw new LearningSessionError("La sesión expiró.", "expired");
  }

  const activity = validateBookAndPage(payload.bookId, payload.page);
  if (payload.stage !== activity.stage || payload.unitId !== activity.unitId) {
    throw new LearningSessionError("Estado pedagógico inconsistente.", "invalid");
  }

  assertCurrentRevision(payload);
  return publicState(payload);
}

function hintLevelFor(input: {
  attemptCount: number;
  turnCount: number;
  stage: LearningStage;
}): 0 | 1 | 2 | 3 {
  if (input.stage === "assessment") {
    return 0;
  }
  const withAttempt = input.attemptCount > 0 ? 1 : 0;
  return Math.min(
    3,
    withAttempt + Math.floor(input.turnCount / 2)
  ) as 0 | 1 | 2 | 3;
}

function evolve(
  current: LearningSessionState,
  changes: Partial<LearningSessionState>
): { token: string; state: LearningSessionState; activity: PageActivity } {
  const nextState = {
    ...current,
    ...changes,
    revision: current.revision + 1
  };
  const activity = validateBookAndPage(nextState.bookId, nextState.page);
  const payload: LearningSessionPayload = {
    ...nextState,
    version: TOKEN_VERSION,
    unitId: activity.unitId,
    stage: activity.stage,
    hintLevel: hintLevelFor({
      attemptCount: nextState.attemptCount,
      turnCount: nextState.turnCount,
      stage: activity.stage
    })
  };
  const tracked = revisions.get(current.sessionId);
  if (tracked && tracked.revision !== current.revision) {
    throw new LearningSessionError(
      "La sesión cambió en otro canal. Actualiza el contexto antes de continuar.",
      "stale"
    );
  }
  const token = serializeLearningSession(payload);
  trackIssued(payload);
  return {
    token,
    state: publicState(payload),
    activity
  };
}

export function moveLearningSession(
  token: string,
  page: number
): { token: string; state: LearningSessionState; activity: PageActivity } {
  const current = verifyLearningSession(token);
  validateBookAndPage(current.bookId, page);
  return evolve(current, {
    page,
    attemptCount: 0,
    turnCount: 0,
    hintLevel: 0,
    lastAttemptDigest: undefined
  });
}

function attemptDigest(attempt: string): string {
  return createHmac("sha256", secret())
    .update(attempt.trim())
    .digest("base64url")
    .slice(0, 16);
}

export function recordLearningTurn(input: {
  token: string;
  attempt: string;
}): { token: string; state: LearningSessionState; activity: PageActivity } {
  const current = verifyLearningSession(input.token);
  if (current.totalTurnCount >= MAX_TURNS_PER_SESSION) {
    throw new LearningSessionError(
      "Esta sesión alcanzó su límite de turnos. Inicia una nueva para continuar.",
      "limit"
    );
  }
  const digest = input.attempt.trim() ? attemptDigest(input.attempt) : undefined;
  const isNewAttempt = Boolean(
    digest && digest !== current.lastAttemptDigest
  );

  return evolve(current, {
    turnCount: current.turnCount + 1,
    totalTurnCount: current.totalTurnCount + 1,
    attemptCount: current.attemptCount + (isNewAttempt ? 1 : 0),
    lastAttemptDigest: digest ?? current.lastAttemptDigest
  });
}

export function learningSessionErrorStatus(
  error: LearningSessionError
): 400 | 401 | 409 | 429 | 503 {
  if (error.code === "configuration") {
    return 503;
  }
  if (error.code === "expired" || error.code === "invalid") {
    return 401;
  }
  if (error.code === "limit") {
    return 429;
  }
  if (error.code === "stale") {
    return 409;
  }
  return 400;
}
