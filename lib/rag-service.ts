import { createHash } from "node:crypto";

import { getBook } from "@/lib/catalog";
import { getBookCurriculum, getPageActivity } from "@/lib/curriculum";
import type { PageExercise } from "@/lib/page-exercises-response";
import type { Evidence } from "@/lib/retrieval";

const CONTRACT_VERSION = "1";
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SOURCE_TEXT = 1_200;
const MAX_SOURCES = 5;
const DEFAULT_TIMEOUT_MS = 1_200;
const HARD_TIMEOUT_MS = 2_000;
const sourceIdPattern = /^[a-zA-Z0-9:._-]{1,240}$/;
const allowedKinds = new Set(["content", "exercise", "instruction"]);
const MAX_PAGE_EXERCISE_CANDIDATES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
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
      url.port !== "3310" ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return new URL("/api/v1/retrieve", url);
  } catch {
    return null;
  }
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
  "sources",
]);
const sourceKeys = new Set([
  "id",
  "page",
  "text",
  "kind",
  "stage",
  "unit_id",
  "score",
]);

export async function retrieveRagServiceEvidence(input: {
  bookId: string;
  question: string;
  attempt: string;
  page: number;
  allowedPages: readonly number[];
}): Promise<Evidence[] | null> {
  const endpoint = serviceEndpoint();
  const book = getBook(input.bookId);
  const curriculum = getBookCurriculum(input.bookId);
  const activity = getPageActivity(input.bookId, input.page);
  const allowedPages = [...new Set(input.allowedPages)].sort(
    (left, right) => left - right,
  );
  if (
    !endpoint ||
    !book ||
    !curriculum ||
    !activity.tutorAvailable ||
    activity.unitId === null ||
    (activity.stage !== "learn" && activity.stage !== "practice") ||
    allowedPages.length === 0 ||
    allowedPages.length > 32 ||
    !allowedPages.includes(input.page) ||
    allowedPages.some((page) => {
      const candidate = getPageActivity(input.bookId, page);
      return (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > book.pages ||
        !candidate.tutorAvailable ||
        candidate.unitId !== activity.unitId ||
        candidate.stage !== activity.stage
      );
    })
  ) {
    return null;
  }

  const query = [input.question.trim(), input.attempt.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3_500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        book_id: book.id,
        source_sha256: book.expectedSha256,
        curriculum_version: curriculum.version,
        page: input.page,
        allowed_pages: allowedPages,
        unit_id: activity.unitId,
        stage: activity.stage,
        query,
        top_k: 3,
      }),
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (
    !response.ok ||
    response.headers.get("x-aimauta-rag-contract") !== CONTRACT_VERSION ||
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
    payload.schema_version !== 1 ||
    payload.book_id !== book.id ||
    payload.source_sha256 !== book.expectedSha256 ||
    payload.curriculum_version !== curriculum.version ||
    !Array.isArray(payload.sources) ||
    payload.sources.length > MAX_SOURCES
  ) {
    return null;
  }

  const allowed = new Set(allowedPages);
  const evidence: Evidence[] = [];
  for (const [index, rawSource] of payload.sources.entries()) {
    if (!isRecord(rawSource) || !hasOnlyKeys(rawSource, sourceKeys)) {
      return null;
    }
    const {
      id,
      page,
      text,
      kind,
      stage,
      unit_id: unitId,
      score,
    } = rawSource;
    if (
      typeof id !== "string" ||
      !sourceIdPattern.test(id) ||
      !Number.isSafeInteger(page) ||
      !allowed.has(Number(page)) ||
      typeof text !== "string" ||
      text.length === 0 ||
      text.length > MAX_SOURCE_TEXT ||
      text !== text.trim() ||
      typeof kind !== "string" ||
      !allowedKinds.has(kind) ||
      stage !== activity.stage ||
      unitId !== activity.unitId ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      return null;
    }
    evidence.push({
      id: `rag:${id}`,
      exerciseId: null,
      page: Number(page),
      text,
      kind: kind as Evidence["kind"],
      teacherOnly: false,
      stage: activity.stage,
      unitId: activity.unitId,
      score,
      sourceId: `S${index + 1}`,
    });
  }
  return evidence;
}

function compactTitle(text: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= 88) {
    return compact;
  }
  return `${compact.slice(0, 85).trimEnd()}…`;
}

function candidateIdentity(evidence: Evidence): {
  id: string;
  revision: number;
} {
  const idHash = createHash("sha256")
    .update(evidence.id)
    .digest("hex")
    .slice(0, 12);
  const revisionHash = createHash("sha256")
    .update(evidence.id)
    .update("\0")
    .update(evidence.text)
    .digest("hex")
    .slice(0, 8);
  return {
    id: `actividad-rag-${evidence.page}-${idHash}`,
    revision: (Number.parseInt(revisionHash, 16) % 2_147_483_646) + 1,
  };
}

/**
 * Projects exercise-shaped RAG chunks into browser activity markers.
 *
 * These are intentionally not canonical PublicExercise records. Their
 * `detected`/`rag-index` identity keeps session, solution and assignment
 * boundaries from mistaking an indexed fragment for a reviewed exercise.
 */
export async function retrieveRagPageExercises(input: {
  bookId: string;
  page: number;
}): Promise<PageExercise[]> {
  const activity = getPageActivity(input.bookId, input.page);
  if (
    !activity.tutorAvailable ||
    activity.unitId === null ||
    (activity.stage !== "learn" && activity.stage !== "practice")
  ) {
    return [];
  }
  const unitId = activity.unitId;
  const stage = activity.stage;

  const evidence = await retrieveRagServiceEvidence({
    bookId: input.bookId,
    page: input.page,
    allowedPages: [input.page],
    // An empty query lets the service's page and exercise-kind boosts rank
    // exercise chunks first instead of biasing toward arbitrary wording.
    question: "",
    attempt: "",
  });
  if (!evidence) {
    return [];
  }

  return evidence
    .filter(
      (item) =>
        item.kind === "exercise" &&
        item.page === input.page &&
        item.unitId === unitId &&
        item.stage === stage &&
        !item.teacherOnly,
    )
    .slice(0, MAX_PAGE_EXERCISE_CANDIDATES)
    .map((item, index) => {
      const identity = candidateIdentity(item);
      return {
        ...identity,
        status: "detected",
        origin: "rag-index",
        unitId,
        stage,
        label: `Actividad ${index + 1}`,
        title: compactTitle(item.text),
        prompt: item.text,
        regions: [
          {
            id: `${identity.id}-marcador`,
            page: input.page,
            role: "prompt",
            order: 1,
            // RAG v1 has page-level provenance but no reviewed geometry. This
            // is a clearly styled callout rail, not a claimed text highlight.
            rect: {
              x: 0.75,
              y: 0.03 + index * 0.085,
              width: 0.22,
              height: 0.065,
            },
          },
        ],
      };
    });
}
