import { createHash } from "node:crypto";

import { getBook } from "@/lib/catalog";
import { getBookCurriculum, getPageActivity } from "@/lib/curriculum";
import type { PublicExercise } from "@/lib/exercise-manifest";
import type { Evidence } from "@/lib/retrieval";

const CONTRACT_VERSION = "2";
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SOURCE_TEXT = 1_200;
const MAX_SOURCES = 3;
const DEFAULT_TIMEOUT_MS = 1_200;
const HARD_TIMEOUT_MS = 2_000;
const MAX_ANCHOR_TEXT = 2_000;
const MAX_QUERY_TEXT = 3_500;
const sourceIdPattern = /^[a-zA-Z0-9:._-]{1,240}$/;
const secretPattern = /^[A-Za-z0-9_-]{32,256}$/;
const allowedKinds = new Set(["content", "exercise", "instruction"]);
const anchorStopWords = new Set([
  "como",
  "con",
  "del",
  "desde",
  "ejercicio",
  "esta",
  "este",
  "estos",
  "estas",
  "las",
  "los",
  "para",
  "por",
  "problema",
  "que",
  "una",
  "uno",
  "unos",
  "unas"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-PE");
}

function anchorTokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter(
        (token) =>
          token.length >= 3 && !anchorStopWords.has(token)
      )
  );
}

function lexicalMatchCount(
  requiredTokens: ReadonlySet<string>,
  text: string
): number {
  const candidateTokens = new Set(
    normalize(text)
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter((token) => token.length >= 3)
  );
  let matches = 0;
  for (const token of requiredTokens) {
    if (candidateTokens.has(token)) {
      matches += 1;
    }
  }
  return matches;
}

function canonicalAnchor(value: string): string | null {
  const anchor = value.normalize("NFC").trim();
  if (
    anchor.length < 3 ||
    anchor.length > MAX_ANCHOR_TEXT ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(anchor)
  ) {
    return null;
  }
  return anchor;
}

function anchorDigest(anchor: string): string {
  return createHash("sha256").update(anchor, "utf8").digest("hex");
}

function timeoutMs(): number {
  const parsed = Number(process.env.AIMAUTA_RAG_SERVICE_TIMEOUT_MS);
  if (!Number.isSafeInteger(parsed) || parsed < 100) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(parsed, HARD_TIMEOUT_MS);
}

function serviceEndpoint(): URL | null {
  const configured = process.env.AIMAUTA_RAG_SERVICE_URL?.trim();
  if (!configured) {
    return null;
  }
  try {
    const url = new URL(configured);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "3311" ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return new URL("/api/v2/retrieve", url);
  } catch {
    return null;
  }
}

function serviceSecret(): string | null {
  const configured = process.env.AIMAUTA_RAG_SERVICE_SECRET?.trim();
  return configured && secretPattern.test(configured) ? configured : null;
}

async function readCappedJson(response: Response): Promise<unknown | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    (declaredLength < 0 || declaredLength > MAX_RESPONSE_BYTES)
  ) {
    return null;
  }
  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

const responseKeys = new Set([
  "schema_version",
  "book_id",
  "source_sha256",
  "curriculum_version",
  "exercise_id",
  "exercise_revision",
  "required_anchor_digest",
  "region_ids",
  "sources"
]);
const sourceKeys = new Set([
  "id",
  "exercise_id",
  "exercise_revision",
  "required_anchor_digest",
  "page",
  "text",
  "kind",
  "stage",
  "unit_id",
  "score"
]);

/**
 * Optional, loopback-only augmentation for an exercise that already has exact
 * human-reviewed release evidence. The caller must keep that local evidence as
 * the primary source; an unavailable or empty sidecar is never an error.
 */
export async function retrieveRagServiceEvidence(input: {
  bookId: string;
  exercise: PublicExercise;
  requiredAnchor: string;
  question: string;
  attempt: string;
  page: number;
  allowedPages: readonly number[];
}): Promise<Evidence[] | null> {
  const endpoint = serviceEndpoint();
  const secret = serviceSecret();
  const book = getBook(input.bookId);
  const curriculum = getBookCurriculum(input.bookId);
  const activity = getPageActivity(input.bookId, input.page);
  const anchor = canonicalAnchor(input.requiredAnchor);
  const requiredTokens = anchor === null ? new Set<string>() : anchorTokens(anchor);
  const { exercise } = input;
  const exercisePages = [
    ...new Set(exercise.regions.map((region) => region.page))
  ].sort((left, right) => left - right);
  const allowedPages = [...new Set(input.allowedPages)].sort(
    (left, right) => left - right
  );
  const regionIds = exercise.regions.map((region) => region.id);

  if (
    !endpoint ||
    !secret ||
    !book ||
    !curriculum ||
    !anchor ||
    requiredTokens.size < 3 ||
    exercise.status !== "published" ||
    !Number.isSafeInteger(exercise.revision) ||
    exercise.revision < 1 ||
    exercisePages.length === 0 ||
    exercisePages.length > 32 ||
    regionIds.length === 0 ||
    regionIds.length > 64 ||
    new Set(regionIds).size !== regionIds.length ||
    regionIds.some((id) => !sourceIdPattern.test(id)) ||
    !exercisePages.includes(input.page) ||
    !activity.tutorAvailable ||
    activity.unitId !== exercise.unitId ||
    activity.stage !== exercise.stage ||
    (activity.stage !== "learn" && activity.stage !== "practice") ||
    allowedPages.length === 0 ||
    allowedPages.length > 32 ||
    !allowedPages.includes(input.page) ||
    allowedPages.some(
      (page) =>
        !exercisePages.includes(page) ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > book.pages
    ) ||
    exercisePages.some((page) => {
      const candidate = getPageActivity(input.bookId, page);
      return (
        !candidate.tutorAvailable ||
        candidate.unitId !== exercise.unitId ||
        candidate.stage !== exercise.stage
      );
    })
  ) {
    return null;
  }

  const digest = anchorDigest(anchor);
  const query = [input.question.trim(), input.attempt.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_QUERY_TEXT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        book_id: book.id,
        source_sha256: book.expectedSha256,
        curriculum_version: curriculum.version,
        exercise_id: exercise.id,
        exercise_revision: exercise.revision,
        required_anchor: anchor,
        required_anchor_digest: digest,
        region_ids: regionIds,
        page: input.page,
        allowed_pages: allowedPages,
        unit_id: exercise.unitId,
        stage: exercise.stage,
        query,
        top_k: MAX_SOURCES
      })
    });

    if (
      !response.ok ||
      response.headers.get("x-aimauta-rag-contract") !==
        CONTRACT_VERSION ||
      !response.headers
        .get("content-type")
        ?.toLocaleLowerCase("en-US")
        .startsWith("application/json")
    ) {
      return null;
    }

    const payload = await readCappedJson(response);
    if (
      !isRecord(payload) ||
      !hasOnlyKeys(payload, responseKeys) ||
      payload.schema_version !== 2 ||
      payload.book_id !== book.id ||
      payload.source_sha256 !== book.expectedSha256 ||
      payload.curriculum_version !== curriculum.version ||
      payload.exercise_id !== exercise.id ||
      payload.exercise_revision !== exercise.revision ||
      payload.required_anchor_digest !== digest ||
      !Array.isArray(payload.region_ids) ||
      payload.region_ids.length !== regionIds.length ||
      !payload.region_ids.every(
        (id, index) => id === regionIds[index]
      ) ||
      !Array.isArray(payload.sources) ||
      payload.sources.length > MAX_SOURCES
    ) {
      return null;
    }

    const allowed = new Set(allowedPages);
    const minimumAnchorMatches = Math.min(
      8,
      Math.max(3, Math.ceil(requiredTokens.size * 0.6))
    );
    const evidence: Evidence[] = [];
    for (const [index, rawSource] of payload.sources.entries()) {
      if (!isRecord(rawSource) || !hasOnlyKeys(rawSource, sourceKeys)) {
        return null;
      }
      const {
        id,
        exercise_id: exerciseId,
        exercise_revision: exerciseRevision,
        required_anchor_digest: sourceAnchorDigest,
        page,
        text,
        kind,
        stage,
        unit_id: unitId,
        score
      } = rawSource;
      if (
        typeof id !== "string" ||
        !sourceIdPattern.test(id) ||
        exerciseId !== exercise.id ||
        exerciseRevision !== exercise.revision ||
        sourceAnchorDigest !== digest ||
        !Number.isSafeInteger(page) ||
        !allowed.has(Number(page)) ||
        typeof text !== "string" ||
        text.length === 0 ||
        text.length > MAX_SOURCE_TEXT ||
        text !== text.trim() ||
        lexicalMatchCount(requiredTokens, text) < minimumAnchorMatches ||
        typeof kind !== "string" ||
        !allowedKinds.has(kind) ||
        stage !== exercise.stage ||
        unitId !== exercise.unitId ||
        typeof score !== "number" ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 100
      ) {
        return null;
      }
      evidence.push({
        id: `rag:${id}`,
        exerciseId: exercise.id,
        page: Number(page),
        text,
        kind: kind as Evidence["kind"],
        teacherOnly: false,
        stage: exercise.stage,
        unitId: exercise.unitId,
        score,
        sourceId: `R${index + 1}`
      });
    }
    return evidence;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
