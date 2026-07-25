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

const TOKEN_VERSION = 5;
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const MAX_TURNS_PER_SESSION = 40;
const MAX_TRACKED_SESSIONS = 20_000;
const MAX_DISTINCT_ATTEMPTS = 12;
const MAX_ASSIGNMENT_PROGRESS_BASE = 2_147_483_600;
const safeExerciseIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safeAssignmentIdPattern = /^[a-z0-9]{10,64}$/;
const attemptDigestPattern = /^[A-Za-z0-9_-]{16}$/;

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
  "org.aimauta.learning-session.process-state.v5"
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

export type LearningAssignmentBinding = {
  assignmentId: string;
  runId: string;
  itemId: string;
  allowedPages: readonly number[];
  exerciseId: string | null;
  exerciseRevision: number | null;
  maxHintLevel: 0 | 1 | 2 | 3;
  turnCountBase: number;
  attemptCountBase: number;
};

export type LearningSessionState = {
  sessionId: string;
  bookId: string;
  page: number;
  unitId: string | null;
  stage: LearningStage;
  exerciseId: string | null;
  exerciseRevision: number | null;
  attemptCount: number;
  turnCount: number;
  totalTurnCount: number;
  hintLevel: 0 | 1 | 2 | 3;
  revision: number;
  createdAt: number;
  expiresAt: number;
  attemptDigests: readonly string[];
  assignment: LearningAssignmentBinding | null;
};

export type LearningExerciseBinding = {
  id: string;
  revision: number;
  unitId: string;
  stage: Extract<LearningStage, "learn" | "practice">;
  pages: readonly number[];
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
      | "exercise"
      | "assignment"
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

function validateExerciseBinding(
  exercise: LearningExerciseBinding | null,
  activity: PageActivity,
  page: number
): void {
  if (exercise === null) {
    return;
  }

  const pages = new Set(exercise.pages);
  if (
    !safeExerciseIdPattern.test(exercise.id) ||
    !Number.isSafeInteger(exercise.revision) ||
    exercise.revision < 1 ||
    !safeExerciseIdPattern.test(exercise.unitId) ||
    (exercise.stage !== "learn" && exercise.stage !== "practice") ||
    pages.size !== exercise.pages.length ||
    exercise.pages.some(
      (exercisePage) =>
        !Number.isSafeInteger(exercisePage) || exercisePage < 1
    ) ||
    !pages.has(page) ||
    activity.unitId !== exercise.unitId ||
    activity.stage !== exercise.stage ||
    !activity.tutorAvailable
  ) {
    throw new LearningSessionError(
      "El ejercicio no está habilitado en esta página.",
      "exercise"
    );
  }
}

function assignmentBindingIsValid(
  assignment: LearningAssignmentBinding | null | undefined,
  page: number,
  exerciseId: string | null,
  exerciseRevision: number | null
): boolean {
  if (assignment === null) {
    return true;
  }
  if (assignment === undefined || typeof assignment !== "object") {
    return false;
  }
  if (
    !safeAssignmentIdPattern.test(assignment.assignmentId) ||
    !safeAssignmentIdPattern.test(assignment.runId) ||
    !safeAssignmentIdPattern.test(assignment.itemId) ||
    !Array.isArray(assignment.allowedPages) ||
    assignment.allowedPages.length < 1 ||
    assignment.allowedPages.length > 500 ||
    assignment.allowedPages.some(
      (allowedPage) =>
        !Number.isSafeInteger(allowedPage) || allowedPage < 1
    ) ||
    new Set(assignment.allowedPages).size !== assignment.allowedPages.length ||
    !assignment.allowedPages.includes(page) ||
    !Number.isSafeInteger(assignment.maxHintLevel) ||
    assignment.maxHintLevel < 0 ||
    assignment.maxHintLevel > 3 ||
    !Number.isSafeInteger(assignment.turnCountBase) ||
    assignment.turnCountBase < 0 ||
    assignment.turnCountBase > MAX_ASSIGNMENT_PROGRESS_BASE ||
    !Number.isSafeInteger(assignment.attemptCountBase) ||
    assignment.attemptCountBase < 0 ||
    assignment.attemptCountBase > MAX_ASSIGNMENT_PROGRESS_BASE ||
    assignment.attemptCountBase > assignment.turnCountBase ||
    !(
      (assignment.exerciseId === null &&
        assignment.exerciseRevision === null) ||
      (typeof assignment.exerciseId === "string" &&
        safeExerciseIdPattern.test(assignment.exerciseId) &&
        Number.isSafeInteger(assignment.exerciseRevision) &&
        Number(assignment.exerciseRevision) > 0)
    )
  ) {
    return false;
  }
  return (
    assignment.exerciseId === null ||
    (assignment.exerciseId === exerciseId &&
      assignment.exerciseRevision === exerciseRevision)
  );
}

function validateAssignmentBinding(
  assignment: LearningAssignmentBinding | null,
  page: number,
  exerciseId: string | null,
  exerciseRevision: number | null
): void {
  if (
    !assignmentBindingIsValid(
      assignment,
      page,
      exerciseId,
      exerciseRevision
    )
  ) {
    throw new LearningSessionError(
      "La navegación no pertenece a la tarea asignada.",
      "assignment"
    );
  }
}

function publicState(payload: LearningSessionPayload): LearningSessionState {
  return {
    sessionId: payload.sessionId,
    bookId: payload.bookId,
    page: payload.page,
    unitId: payload.unitId,
    stage: payload.stage,
    exerciseId: payload.exerciseId,
    exerciseRevision: payload.exerciseRevision,
    attemptCount: payload.attemptCount,
    turnCount: payload.turnCount,
    totalTurnCount: payload.totalTurnCount,
    hintLevel: payload.hintLevel,
    revision: payload.revision,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    attemptDigests: [...payload.attemptDigests],
    assignment: payload.assignment
      ? {
          ...payload.assignment,
          allowedPages: [...payload.assignment.allowedPages]
        }
      : null
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
  exercise?: LearningExerciseBinding | null;
  assignment?: LearningAssignmentBinding | null;
  initialHintLevel?: 0 | 1 | 2 | 3;
  now?: number;
}): { token: string; state: LearningSessionState; activity: PageActivity } {
  const activity = validateBookAndPage(input.bookId, input.page);
  const exercise = input.exercise ?? null;
  const assignment = input.assignment ?? null;
  validateExerciseBinding(exercise, activity, input.page);
  validateAssignmentBinding(
    assignment,
    input.page,
    exercise?.id ?? null,
    exercise?.revision ?? null
  );
  const initialHintLevel = input.initialHintLevel ?? 0;
  if (
    !Number.isSafeInteger(initialHintLevel) ||
    initialHintLevel < 0 ||
    initialHintLevel > (assignment?.maxHintLevel ?? 3) ||
    (activity.stage === "assessment" && initialHintLevel !== 0)
  ) {
    throw new LearningSessionError(
      "El nivel inicial de ayuda no es válido.",
      "assignment"
    );
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload: LearningSessionPayload = {
    version: TOKEN_VERSION,
    sessionId: randomUUID(),
    bookId: input.bookId,
    page: input.page,
    unitId: activity.unitId,
    stage: activity.stage,
    exerciseId: exercise?.id ?? null,
    exerciseRevision: exercise?.revision ?? null,
    attemptCount: 0,
    turnCount: 0,
    totalTurnCount: 0,
    hintLevel: initialHintLevel,
    revision: 0,
    createdAt: now,
    expiresAt: now + TOKEN_TTL_SECONDS,
    attemptDigests: [],
    assignment
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
    !(
      (payload.exerciseId === null &&
        payload.exerciseRevision === null) ||
      (typeof payload.exerciseId === "string" &&
        safeExerciseIdPattern.test(payload.exerciseId) &&
        Number.isSafeInteger(payload.exerciseRevision) &&
        Number(payload.exerciseRevision) > 0)
    ) ||
    !Number.isInteger(payload.attemptCount) ||
    !Number.isInteger(payload.turnCount) ||
    !Number.isInteger(payload.totalTurnCount) ||
    !Number.isInteger(payload.hintLevel) ||
    !Number.isInteger(payload.revision) ||
    !assignmentBindingIsValid(
      payload.assignment,
      payload.page,
      payload.exerciseId,
      payload.exerciseRevision
    ) ||
    !Array.isArray(payload.attemptDigests) ||
    payload.attemptDigests.length > MAX_DISTINCT_ATTEMPTS ||
    payload.attemptDigests.some(
      (digest) =>
        typeof digest !== "string" ||
        !attemptDigestPattern.test(digest)
    ) ||
    new Set(payload.attemptDigests).size !== payload.attemptDigests.length ||
    payload.attemptCount !== payload.attemptDigests.length ||
    payload.attemptCount < 0 ||
    payload.turnCount < 0 ||
    payload.totalTurnCount < 0 ||
    payload.hintLevel < 0 ||
    payload.hintLevel > 3 ||
    (payload.assignment !== null &&
      payload.hintLevel > payload.assignment.maxHintLevel) ||
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
  maximum: 0 | 1 | 2 | 3;
}): 0 | 1 | 2 | 3 {
  if (input.stage === "assessment") {
    return 0;
  }
  const withAttempt = input.attemptCount > 0 ? 1 : 0;
  return Math.min(
    input.maximum,
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
  validateAssignmentBinding(
    nextState.assignment,
    nextState.page,
    nextState.exerciseId,
    nextState.exerciseRevision
  );
  const payload: LearningSessionPayload = {
    ...nextState,
    version: TOKEN_VERSION,
    unitId: activity.unitId,
    stage: activity.stage,
    hintLevel: Math.max(
      nextState.hintLevel,
      hintLevelFor({
        attemptCount: nextState.attemptCount,
        turnCount: nextState.turnCount,
        stage: activity.stage,
        maximum: nextState.assignment?.maxHintLevel ?? 3
      })
    ) as 0 | 1 | 2 | 3
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
  page: number,
  exercise: LearningExerciseBinding | null = null
): { token: string; state: LearningSessionState; activity: PageActivity } {
  const current = verifyLearningSession(token);
  const activity = validateBookAndPage(current.bookId, page);
  validateExerciseBinding(exercise, activity, page);
  validateAssignmentBinding(
    current.assignment,
    page,
    exercise?.id ?? null,
    exercise?.revision ?? null
  );
  const sameExercise =
    exercise !== null &&
    current.exerciseId === exercise.id &&
    current.exerciseRevision === exercise.revision;
  return evolve(current, {
    page,
    exerciseId: exercise?.id ?? null,
    exerciseRevision: exercise?.revision ?? null,
    attemptCount: sameExercise ? current.attemptCount : 0,
    turnCount: sameExercise ? current.turnCount : 0,
    hintLevel: sameExercise ? current.hintLevel : 0,
    attemptDigests: sameExercise ? current.attemptDigests : []
  });
}

function normalizeAttempt(attempt: string): string {
  return attempt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("es-PE");
}

function isSubstantiveAttempt(attempt: string): boolean {
  const normalized = normalizeAttempt(attempt);
  const words =
    normalized.match(/\p{Letter}[\p{Letter}\p{Mark}\p{Number}]*/gu) ?? [];
  const numbers = normalized.match(/\p{Number}+(?:[.,/]\p{Number}+)?/gu) ?? [];
  const mathematicalRelation = /[=<>+\-*/×÷]/u.test(normalized);

  return (
    (normalized.length >= 18 && words.length >= 3) ||
    (normalized.length >= 7 &&
      numbers.length >= 2 &&
      mathematicalRelation)
  );
}

const irrelevantAttemptWords = new Set([
  "ambos",
  "cada",
  "como",
  "con",
  "cuidado",
  "del",
  "despues",
  "desde",
  "donde",
  "el",
  "ella",
  "en",
  "entonces",
  "finalmente",
  "esta",
  "este",
  "esto",
  "la",
  "las",
  "los",
  "para",
  "pero",
  "por",
  "porque",
  "primero",
  "que",
  "sin",
  "una",
  "uno",
  "usar",
  "usaria",
  "voy",
  "y"
]);

function relevantTokens(value: string): Set<string> {
  return new Set(
    normalizeAttempt(value)
      .split(/[^\p{Letter}\p{Mark}\p{Number}]+/gu)
      .filter(
        (token) =>
          token.length >= 4 &&
          /\p{Letter}/u.test(token) &&
          !irrelevantAttemptWords.has(token)
      )
  );
}

function conceptMatches(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  const maximumPrefix = Math.min(left.length, right.length);
  let commonPrefix = 0;
  while (
    commonPrefix < maximumPrefix &&
    left[commonPrefix] === right[commonPrefix]
  ) {
    commonPrefix += 1;
  }
  return (
    commonPrefix >= 5 &&
    commonPrefix / maximumPrefix >= 0.7
  );
}

function matchedAttemptConcepts(
  attempt: string,
  referenceText: string
): string[] | null {
  const reference = [...relevantTokens(referenceText)];
  const attemptTokens = [...relevantTokens(attempt)];
  if (reference.length === 0 || attemptTokens.length === 0) {
    return null;
  }
  const matchedConcepts = new Set<string>();
  let matchedAttemptTokens = 0;
  for (const token of attemptTokens) {
    const concept = reference
      .filter((candidate) => conceptMatches(token, candidate))
      .sort((left, right) => left.localeCompare(right))[0];
    if (concept) {
      matchedAttemptTokens += 1;
      matchedConcepts.add(concept);
    }
  }
  if (
    matchedConcepts.size < 2 ||
    matchedAttemptTokens / attemptTokens.length < 0.3
  ) {
    return null;
  }
  return [...matchedConcepts].sort((left, right) =>
    left.localeCompare(right)
  );
}

function canonicalAttemptText(attempt: string): string {
  return normalizeAttempt(attempt)
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function attemptDigest(attempt: string): string {
  return createHmac("sha256", secret())
    .update(normalizeAttempt(attempt))
    .digest("base64url")
    .slice(0, 16);
}

export function recordLearningTurn(input: {
  token: string;
  attempt: string;
  attemptReference?: string;
}): { token: string; state: LearningSessionState; activity: PageActivity } {
  const current = verifyLearningSession(input.token);
  if (current.totalTurnCount >= MAX_TURNS_PER_SESSION) {
    throw new LearningSessionError(
      "Esta sesión alcanzó su límite de turnos. Inicia una nueva para continuar.",
      "limit"
    );
  }
  const concepts =
    input.attemptReference === undefined
      ? null
      : matchedAttemptConcepts(
          input.attempt,
          input.attemptReference
        );
  const digestMaterial =
    isSubstantiveAttempt(input.attempt) &&
    (input.attemptReference === undefined || concepts !== null)
      ? concepts?.join("\u0000") ?? canonicalAttemptText(input.attempt)
      : null;
  const digest =
    digestMaterial === null
      ? undefined
      : attemptDigest(digestMaterial);
  const isNewAttempt = Boolean(
    digest &&
      current.attemptDigests.length < MAX_DISTINCT_ATTEMPTS &&
      !current.attemptDigests.includes(digest)
  );

  return evolve(current, {
    turnCount: current.turnCount + 1,
    totalTurnCount: current.totalTurnCount + 1,
    attemptCount: current.attemptCount + (isNewAttempt ? 1 : 0),
    attemptDigests:
      isNewAttempt && digest
        ? [...current.attemptDigests, digest]
        : current.attemptDigests
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
