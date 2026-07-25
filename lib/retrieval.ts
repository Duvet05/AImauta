import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getBook, type Book } from "@/lib/catalog";
import {
  getBookCurriculum,
  getPageActivity,
  type LearningStage
} from "@/lib/curriculum";
import type { PublicExercise } from "@/lib/exercise-manifest";

export const BOOK_INDEX_VERSION = 2 as const;
export const INDEX_EXTRACTOR_VERSION =
  "aimauta-pdf-parse-2.4.5-chunker-2" as const;

const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS_PER_PAGE = 50;
const MAX_CHUNK_TEXT_LENGTH = 50_000;
const MAX_CHUNK_ID_LENGTH = 240;
const MAX_CACHE_ENTRIES = 32;

const allowedKinds = new Set(["content", "exercise", "instruction"]);
const allowedStages = new Set<LearningStage>([
  "orientation",
  "learn",
  "practice",
  "assessment"
]);
const exerciseAnchorStopWords = new Set([
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
const sha256Pattern = /^[a-f0-9]{64}$/;

export type IndexedChunk = {
  id: string;
  page: number;
  text: string;
  kind: "content" | "exercise" | "instruction";
  teacherOnly: boolean;
  stage: LearningStage;
  unitId: string | null;
};

export type IndexTaxonomy = Pick<
  Book,
  "levelId" | "gradeNumber" | "courseId" | "materialType" | "language"
>;

export type IndexQualityOutlier = {
  page: number;
  wordCount: number;
  direction: "low" | "high";
};

export type IndexQualityReport = {
  missing: number[];
  outliers: IndexQualityOutlier[];
  teacherOnly: {
    chunkCount: number;
    pages: number[];
  };
};

export type BookIndex = {
  version: typeof BOOK_INDEX_VERSION;
  extractorVersion: typeof INDEX_EXTRACTOR_VERSION;
  generatedAt: string;
  bookId: string;
  sourceSha256: string;
  pageCount: number;
  taxonomy: IndexTaxonomy;
  curriculum: {
    version: string;
  };
  quality: IndexQualityReport;
  license: {
    name: string;
    url: string;
    attribution: string;
  };
  chunks: IndexedChunk[];
};

export type Evidence = IndexedChunk & {
  exerciseId: string | null;
  score: number;
  sourceId: string;
};

export class BookIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookIndexError";
  }
}

type CachedIndex = {
  mtimeMs: number;
  size: number;
  index: BookIndex;
};

const indexCache = new Map<string, CachedIndex>();

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-PE");
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter((token) => token.length >= 3)
  );
}

function exerciseAnchorTokens(value: string): Set<string> {
  return new Set(
    [...tokens(value)].filter(
      (token) => !exerciseAnchorStopWords.has(token)
    )
  );
}

function lexicalMatchCount(
  queryTokens: ReadonlySet<string>,
  text: string
): number {
  const chunkTokens = tokens(text);
  let matches = 0;
  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      matches += 1;
    }
  }
  return matches;
}

export function rankChunks(input: {
  chunks: readonly IndexedChunk[];
  query: string;
  page: number;
  focusPages?: readonly number[];
  limit?: number;
}): Evidence[] {
  const queryTokens = tokens(input.query);
  const limit = Math.max(1, Math.min(input.limit ?? 3, 5));
  const focusPages =
    input.focusPages && input.focusPages.length > 0
      ? input.focusPages
      : [input.page];

  return input.chunks
    .filter((chunk) => {
      const distance = Math.min(
        ...focusPages.map((page) => Math.abs(chunk.page - page))
      );
      return (
        !chunk.teacherOnly &&
        chunk.stage !== "assessment" &&
        distance <= 2
      );
    })
    .map((chunk) => {
      const lexicalMatches = lexicalMatchCount(
        queryTokens,
        chunk.text
      );
      const distance = Math.min(
        ...focusPages.map((page) => Math.abs(chunk.page - page))
      );
      const pageScore =
        distance === 0 ? 5 : distance === 1 ? 2.5 : distance === 2 ? 1 : 0;
      const lexicalScore =
        queryTokens.size === 0
          ? 0
          : (lexicalMatches / queryTokens.size) * 8;
      const exerciseBoost = chunk.kind === "exercise" ? 0.5 : 0;

      return {
        ...chunk,
        exerciseId: null,
        score: pageScore + lexicalScore + exerciseBoost,
        sourceId: ""
      };
    })
    .filter((chunk) => chunk.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Math.abs(left.page - input.page) - Math.abs(right.page - input.page)
    )
    .slice(0, limit)
    .map((chunk, index) => ({ ...chunk, sourceId: `S${index + 1}` }));
}

/**
 * Retrieves validated index chunks for the exact, revisioned exercise selected
 * by the student. The current index has page-level chunks, so a public exercise
 * anchor is required in addition to the page and curriculum binding. Ambiguous
 * or unanchored chunks fail closed instead of becoming tutor context.
 */
export async function retrieveExerciseEvidence(input: {
  bookId: string;
  exercise: PublicExercise;
  question: string;
  attempt: string;
  page: number;
}): Promise<Evidence[]> {
  const { exercise } = input;
  const pages = [
    ...new Set(exercise.regions.map((region) => region.page))
  ].sort((left, right) => left - right);
  const anchor = [exercise.title.trim(), exercise.prompt.trim()]
    .filter(Boolean)
    .join("\n");
  if (
    exercise.status !== "published" ||
    !exercise.id ||
    exerciseAnchorTokens(anchor).size < 3 ||
    pages.length === 0 ||
    !pages.includes(input.page) ||
    (exercise.stage !== "learn" && exercise.stage !== "practice")
  ) {
    return [];
  }

  if (
    pages.some((page) => {
      const activity = getPageActivity(input.bookId, page);
      return (
        !activity.tutorAvailable ||
        activity.stage !== exercise.stage ||
        activity.unitId !== exercise.unitId
      );
    })
  ) {
    return [];
  }

  const evidence = await retrieveEvidence({
    bookId: input.bookId,
    question: [anchor, input.question.trim()].filter(Boolean).join("\n"),
    attempt: input.attempt,
    page: input.page,
    allowedPages: pages,
    requiredAnchor: anchor
  });

  return evidence
    .filter(
      (item) =>
        !item.teacherOnly &&
        item.stage === exercise.stage &&
        item.unitId === exercise.unitId &&
        pages.includes(item.page)
    )
    .map((item, index) => ({
      ...item,
      exerciseId: exercise.id,
      sourceId: `S${index + 1}`
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(bookId: string, reason: string): never {
  throw new BookIndexError(`Índice RAG inválido para ${bookId}: ${reason}`);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isSortedUniquePageList(
  value: unknown,
  pageCount: number
): value is number[] {
  if (!Array.isArray(value)) {
    return false;
  }
  let previous = 0;
  return value.every((page) => {
    if (
      !isPositiveInteger(page) ||
      page > pageCount ||
      page <= previous
    ) {
      return false;
    }
    previous = page;
    return true;
  });
}

function sameNumbers(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function expectedTaxonomy(book: Book): IndexTaxonomy {
  return {
    levelId: book.levelId,
    gradeNumber: book.gradeNumber,
    courseId: book.courseId,
    materialType: book.materialType,
    language: book.language
  };
}

function validateBookIndex(
  value: unknown,
  book: Book
): BookIndex {
  if (!isRecord(value)) {
    fail(book.id, "el documento raíz no es un objeto");
  }
  if (value.version !== BOOK_INDEX_VERSION) {
    fail(
      book.id,
      `se requiere versión ${BOOK_INDEX_VERSION}; vuelve a ejecutar content:index`
    );
  }
  if (value.extractorVersion !== INDEX_EXTRACTOR_VERSION) {
    fail(book.id, "extractorVersion no es compatible con este despliegue");
  }
  if (value.bookId !== book.id) {
    fail(book.id, "bookId no coincide con el material solicitado");
  }
  if (
    typeof value.sourceSha256 !== "string" ||
    !sha256Pattern.test(value.sourceSha256) ||
    value.sourceSha256 !== book.expectedSha256
  ) {
    fail(book.id, "sourceSha256 no coincide con el catálogo publicado");
  }
  if (value.pageCount !== book.pages) {
    fail(book.id, "pageCount no coincide con el catálogo publicado");
  }
  if (
    typeof value.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.generatedAt))
  ) {
    fail(book.id, "generatedAt no es una fecha válida");
  }

  const taxonomy = value.taxonomy;
  const expected = expectedTaxonomy(book);
  if (
    !isRecord(taxonomy) ||
    taxonomy.levelId !== expected.levelId ||
    taxonomy.gradeNumber !== expected.gradeNumber ||
    taxonomy.courseId !== expected.courseId ||
    taxonomy.materialType !== expected.materialType ||
    taxonomy.language !== expected.language
  ) {
    fail(book.id, "la taxonomía no coincide con el catálogo publicado");
  }

  const curriculum = getBookCurriculum(book.id);
  if (
    !curriculum ||
    !isRecord(value.curriculum) ||
    value.curriculum.version !== curriculum.version
  ) {
    fail(book.id, "la versión curricular no coincide con el despliegue");
  }
  if (
    !isRecord(value.license) ||
    value.license.name !== book.licenseName ||
    value.license.url !== book.licenseUrl ||
    value.license.attribution !== book.attribution
  ) {
    fail(book.id, "la licencia no coincide con el catálogo publicado");
  }

  if (
    !Array.isArray(value.chunks) ||
    value.chunks.length > book.pages * MAX_CHUNKS_PER_PAGE
  ) {
    fail(book.id, "la colección de fragmentos excede los límites");
  }

  const ids = new Set<string>();
  const coveredPages = new Set<number>();
  const teacherOnlyPages = new Set<number>();
  let teacherOnlyChunkCount = 0;
  const chunksPerPage = new Map<number, number>();

  for (const rawChunk of value.chunks) {
    if (!isRecord(rawChunk)) {
      fail(book.id, "un fragmento no es un objeto");
    }
    if (
      typeof rawChunk.id !== "string" ||
      rawChunk.id.length === 0 ||
      rawChunk.id.length > MAX_CHUNK_ID_LENGTH ||
      ids.has(rawChunk.id)
    ) {
      fail(book.id, "hay identificadores de fragmento inválidos o duplicados");
    }
    ids.add(rawChunk.id);

    if (
      !isPositiveInteger(rawChunk.page) ||
      rawChunk.page > book.pages
    ) {
      fail(book.id, "un fragmento referencia una página fuera del PDF");
    }
    if (
      typeof rawChunk.text !== "string" ||
      rawChunk.text.length === 0 ||
      rawChunk.text.length > MAX_CHUNK_TEXT_LENGTH ||
      rawChunk.text !== rawChunk.text.trim()
    ) {
      fail(book.id, "un fragmento contiene texto inválido");
    }
    if (
      typeof rawChunk.kind !== "string" ||
      !allowedKinds.has(rawChunk.kind)
    ) {
      fail(book.id, "un fragmento usa una clase no reconocida");
    }
    if (typeof rawChunk.teacherOnly !== "boolean") {
      fail(book.id, "un fragmento no declara teacherOnly");
    }
    if (
      typeof rawChunk.stage !== "string" ||
      !allowedStages.has(rawChunk.stage as LearningStage)
    ) {
      fail(book.id, "un fragmento usa una etapa no reconocida");
    }
    if (
      rawChunk.unitId !== null &&
      (typeof rawChunk.unitId !== "string" || rawChunk.unitId.length === 0)
    ) {
      fail(book.id, "un fragmento usa una unidad inválida");
    }

    const activity = getPageActivity(book.id, rawChunk.page);
    if (
      (activity.stage === "assessment" && activity.unitId === null) ||
      rawChunk.stage !== activity.stage ||
      rawChunk.unitId !== activity.unitId
    ) {
      fail(
        book.id,
        "la etapa o unidad de un fragmento no coincide con el currículo"
      );
    }

    const pageChunkCount = (chunksPerPage.get(rawChunk.page) ?? 0) + 1;
    if (pageChunkCount > MAX_CHUNKS_PER_PAGE) {
      fail(book.id, "una página contiene demasiados fragmentos");
    }
    chunksPerPage.set(rawChunk.page, pageChunkCount);
    coveredPages.add(rawChunk.page);

    if (rawChunk.teacherOnly) {
      teacherOnlyChunkCount += 1;
      teacherOnlyPages.add(rawChunk.page);
    }
  }

  const quality = value.quality;
  if (
    !isRecord(quality) ||
    !isSortedUniquePageList(quality.missing, book.pages) ||
    !Array.isArray(quality.outliers) ||
    !isRecord(quality.teacherOnly) ||
    quality.teacherOnly.chunkCount !== teacherOnlyChunkCount ||
    !isSortedUniquePageList(quality.teacherOnly.pages, book.pages)
  ) {
    fail(book.id, "el reporte de calidad tiene una estructura inválida");
  }

  const expectedMissing = Array.from(
    { length: book.pages },
    (_, index) => index + 1
  ).filter((page) => !coveredPages.has(page));
  if (!sameNumbers(quality.missing, expectedMissing)) {
    fail(book.id, "quality.missing no coincide con las páginas indexadas");
  }

  const expectedTeacherOnlyPages = [...teacherOnlyPages].sort(
    (left, right) => left - right
  );
  if (!sameNumbers(quality.teacherOnly.pages, expectedTeacherOnlyPages)) {
    fail(book.id, "quality.teacherOnly no coincide con los fragmentos");
  }

  const outlierPages = new Set<number>();
  for (const outlier of quality.outliers) {
    if (
      !isRecord(outlier) ||
      !isPositiveInteger(outlier.page) ||
      outlier.page > book.pages ||
      !isPositiveInteger(outlier.wordCount) ||
      (outlier.direction !== "low" && outlier.direction !== "high") ||
      outlierPages.has(outlier.page) ||
      expectedMissing.includes(outlier.page)
    ) {
      fail(book.id, "quality.outliers contiene una observación inválida");
    }
    outlierPages.add(outlier.page);
  }

  return value as BookIndex;
}

function cacheIndex(indexPath: string, entry: CachedIndex): void {
  if (indexCache.size >= MAX_CACHE_ENTRIES && !indexCache.has(indexPath)) {
    const oldest = indexCache.keys().next().value;
    if (typeof oldest === "string") {
      indexCache.delete(oldest);
    }
  }
  indexCache.delete(indexPath);
  indexCache.set(indexPath, entry);
}

async function loadBookIndex(
  indexPath: string,
  book: Book
): Promise<BookIndex> {
  const before = await stat(/* turbopackIgnore: true */ indexPath);
  if (!before.isFile() || before.size <= 0 || before.size > MAX_INDEX_BYTES) {
    fail(book.id, "el archivo no es regular o excede el tamaño permitido");
  }

  const cached = indexCache.get(indexPath);
  if (
    cached &&
    cached.mtimeMs === before.mtimeMs &&
    cached.size === before.size
  ) {
    indexCache.delete(indexPath);
    indexCache.set(indexPath, cached);
    return cached.index;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(/* turbopackIgnore: true */ indexPath, "utf8")
    );
  } catch {
    fail(book.id, "el archivo no contiene JSON válido");
  }

  const after = await stat(/* turbopackIgnore: true */ indexPath);
  if (
    !after.isFile() ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size
  ) {
    fail(book.id, "el archivo cambió mientras se estaba leyendo");
  }

  const index = validateBookIndex(parsed, book);
  cacheIndex(indexPath, {
    mtimeMs: after.mtimeMs,
    size: after.size,
    index
  });
  return index;
}

export async function retrieveEvidence(input: {
  bookId: string;
  question: string;
  attempt: string;
  page: number;
  allowedPages?: readonly number[];
  requiredAnchor?: string;
}): Promise<Evidence[]> {
  if (path.basename(input.bookId) !== input.bookId) {
    return [];
  }

  const book = getBook(input.bookId);
  if (
    !book ||
    !isPositiveInteger(input.page) ||
    input.page > book.pages
  ) {
    return [];
  }

  const activity = getPageActivity(book.id, input.page);
  if (activity.stage === "assessment" && activity.unitId === null) {
    fail(book.id, "la página solicitada no tiene clasificación curricular");
  }
  // Resolve the curricular gate before opening or parsing any RAG index.
  // Orientation, assessment and every fail-closed page return no evidence.
  if (!activity.tutorAvailable) {
    return [];
  }
  const allowedPages =
    input.allowedPages === undefined
      ? null
      : new Set(
          input.allowedPages.filter(
            (page) =>
              Number.isSafeInteger(page) &&
              page >= 1 &&
              page <= book.pages
          )
        );
  if (
    input.allowedPages !== undefined &&
    allowedPages?.size !== input.allowedPages.length
  ) {
    return [];
  }
  const requiredAnchorTokens =
    input.requiredAnchor === undefined
      ? null
      : exerciseAnchorTokens(input.requiredAnchor);
  if (
    requiredAnchorTokens !== null &&
    requiredAnchorTokens.size < 3
  ) {
    return [];
  }
  const minimumAnchorMatches =
    requiredAnchorTokens === null
      ? 0
      : Math.min(
          8,
          Math.max(3, Math.ceil(requiredAnchorTokens.size * 0.6))
        );

  const indexDir =
    process.env.AIMAUTA_INDEX_DIR ??
    path.resolve(process.cwd(), "data", "indexes");
  const indexPath = path.join(
    /* turbopackIgnore: true */ indexDir,
    `${book.id}.json`
  );

  try {
    const index = await loadBookIndex(indexPath, book);
    const query = [input.question.trim(), input.attempt.trim()]
      .filter(Boolean)
      .join("\n");
    return rankChunks({
      chunks: index.chunks.filter(
        (chunk) =>
          chunk.unitId === activity.unitId &&
          (allowedPages === null || allowedPages.has(chunk.page)) &&
          (requiredAnchorTokens === null ||
            lexicalMatchCount(requiredAnchorTokens, chunk.text) >=
              minimumAnchorMatches)
      ),
      query,
      page: input.page,
      focusPages:
        allowedPages === null ? undefined : [...allowedPages]
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}
