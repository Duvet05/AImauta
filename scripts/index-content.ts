import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { PDFParse } from "pdf-parse";

import { getBook, getBooks, type Book } from "../lib/catalog";
import {
  getBookCurriculum,
  getPageActivity,
  type LearningStage
} from "../lib/curriculum";
import {
  BOOK_INDEX_VERSION,
  INDEX_EXTRACTOR_VERSION,
  type BookIndex,
  type IndexedChunk,
  type IndexQualityOutlier,
  type IndexQualityReport
} from "../lib/retrieval";

const contentDir =
  process.env.AIMAUTA_CONTENT_DIR ?? path.resolve(process.cwd(), "content");
const indexDir =
  process.env.AIMAUTA_INDEX_DIR ??
  path.resolve(process.cwd(), "data", "indexes");

const MIN_INDEXABLE_WORDS = 5;
const CHUNK_WORDS = 360;
const CHUNK_OVERLAP_WORDS = 40;

type ExtractedPage = {
  page: number;
  wordCount: number;
  chunks: IndexedChunk[];
};

function selectedBooks(): readonly Book[] {
  const index = process.argv.indexOf("--book");
  if (index === -1) {
    return getBooks();
  }
  const id = process.argv[index + 1];
  const book = id ? getBook(id) : undefined;
  if (!book) {
    throw new Error(`Libro desconocido o no publicado: ${id ?? "(vacío)"}`);
  }
  return [book];
}

function compactText(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wordsIn(value: string): string[] {
  const compacted = compactText(value);
  return compacted ? compacted.split(/\s+/).filter(Boolean) : [];
}

function inferKind(text: string): IndexedChunk["kind"] {
  if (
    /\b(situación|actividad|resuelve|evaluamos|comprobamos|pregunta)\b/iu.test(
      text
    )
  ) {
    return "exercise";
  }
  if (/\b(indicación|instrucción|lee|observa|completa)\b/iu.test(text)) {
    return "instruction";
  }
  return "content";
}

function isTeacherOnly(text: string): boolean {
  return [
    /\b(?:solución|resolución|respuesta)\s*:/iu,
    /\bclave\s+de\s+respuestas\b/iu,
    /\bsolucionario\b/iu,
    /\brespuestas\s+correctas\b/iu
  ].some((pattern) => pattern.test(text));
}

function pageChunks(input: {
  bookId: string;
  page: number;
  rawText: string;
  stage: LearningStage;
  unitId: string | null;
}): ExtractedPage {
  const words = wordsIn(input.rawText);
  if (words.length < MIN_INDEXABLE_WORDS) {
    return {
      page: input.page,
      wordCount: words.length,
      chunks: []
    };
  }

  const chunks: IndexedChunk[] = [];
  for (let start = 0, position = 0; start < words.length; position += 1) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    const text = words.slice(start, end).join(" ");
    chunks.push({
      id: `${input.bookId}:p${input.page}:c${position}`,
      page: input.page,
      text,
      kind: inferKind(text),
      teacherOnly: isTeacherOnly(text),
      stage: input.stage,
      unitId: input.unitId
    });
    if (end === words.length) {
      break;
    }
    start = end - CHUNK_OVERLAP_WORDS;
  }

  return {
    page: input.page,
    wordCount: words.length,
    chunks
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function qualityReport(
  pages: readonly ExtractedPage[]
): IndexQualityReport {
  const missing = pages
    .filter((page) => page.chunks.length === 0)
    .map((page) => page.page);
  const indexedWordCounts = pages
    .filter((page) => page.chunks.length > 0)
    .map((page) => page.wordCount);
  const medianWordCount = median(indexedWordCounts);
  const lowThreshold = Math.max(
    MIN_INDEXABLE_WORDS,
    Math.floor(medianWordCount * 0.2)
  );
  const highThreshold = Math.max(
    1_000,
    Math.ceil(medianWordCount * 3.5)
  );

  const outliers = pages.reduce<IndexQualityOutlier[]>((report, page) => {
    if (page.chunks.length === 0) {
      return report;
    }
    if (page.wordCount < lowThreshold) {
      report.push({
        page: page.page,
        wordCount: page.wordCount,
        direction: "low"
      });
    } else if (page.wordCount > highThreshold) {
      report.push({
        page: page.page,
        wordCount: page.wordCount,
        direction: "high"
      });
    }
    return report;
  }, []);

  const teacherOnlyChunks = pages.flatMap((page) =>
    page.chunks.filter((chunk) => chunk.teacherOnly)
  );
  const teacherOnlyPages = [
    ...new Set(teacherOnlyChunks.map((chunk) => chunk.page))
  ].sort((left, right) => left - right);

  return {
    missing,
    outliers,
    teacherOnly: {
      chunkCount: teacherOnlyChunks.length,
      pages: teacherOnlyPages
    }
  };
}

function formatPageSummary(pages: readonly number[]): string {
  if (pages.length === 0) {
    return "ninguna";
  }
  const preview = pages.slice(0, 12).join(", ");
  return pages.length > 12
    ? `${preview}… (${pages.length} en total)`
    : preview;
}

async function indexBook(book: Book): Promise<void> {
  const curriculum = getBookCurriculum(book.id);
  if (!curriculum) {
    throw new Error(`${book.id}: no tiene currículo publicado; no se indexará`);
  }

  const pdfPath = path.join(contentDir, book.storageFile);
  const data = await fs.readFile(pdfPath);
  const digest = createHash("sha256").update(data).digest("hex");
  if (digest !== book.expectedSha256) {
    throw new Error(`${book.id}: checksum distinto al catálogo; no se indexará`);
  }

  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    if (result.total !== book.pages) {
      throw new Error(
        `${book.id}: el PDF tiene ${result.total} páginas, catálogo ${book.pages}`
      );
    }

    const textByPage = new Map<number, string>();
    for (const page of result.pages) {
      if (
        !Number.isInteger(page.num) ||
        page.num < 1 ||
        page.num > book.pages ||
        textByPage.has(page.num)
      ) {
        throw new Error(
          `${book.id}: el extractor devolvió una numeración de páginas inválida`
        );
      }
      textByPage.set(page.num, page.text);
    }

    const extractedPages = Array.from(
      { length: book.pages },
      (_, index) => index + 1
    ).map((page) => {
      const activity = getPageActivity(book.id, page);
      if (activity.stage === "assessment" && activity.unitId === null) {
        throw new Error(
          `${book.id}: la página ${page} no tiene clasificación curricular`
        );
      }
      return pageChunks({
        bookId: book.id,
        page,
        rawText: textByPage.get(page) ?? "",
        stage: activity.stage,
        unitId: activity.unitId
      });
    });
    const chunks = extractedPages.flatMap((page) => page.chunks);
    const quality = qualityReport(extractedPages);
    const index: BookIndex = {
      version: BOOK_INDEX_VERSION,
      extractorVersion: INDEX_EXTRACTOR_VERSION,
      generatedAt: new Date().toISOString(),
      bookId: book.id,
      sourceSha256: digest,
      pageCount: book.pages,
      taxonomy: {
        levelId: book.levelId,
        gradeNumber: book.gradeNumber,
        courseId: book.courseId,
        materialType: book.materialType,
        language: book.language
      },
      curriculum: {
        version: curriculum.version
      },
      quality,
      license: {
        name: book.licenseName,
        url: book.licenseUrl,
        attribution: book.attribution
      },
      chunks
    };

    await fs.mkdir(indexDir, { recursive: true });
    const destination = path.join(indexDir, `${book.id}.json`);
    const temporary = `${destination}.part-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(index)}\n`, {
      mode: 0o640
    });
    await fs.rename(temporary, destination);
    process.stdout.write(
      `✓ ${book.id}: ${result.total} páginas · ${chunks.length} fragmentos\n`
    );
    process.stdout.write(
      `  Calidad · missing: ${formatPageSummary(quality.missing)} · ` +
        `outliers: ${formatPageSummary(quality.outliers.map((item) => item.page))} · ` +
        `teacherOnly: ${quality.teacherOnly.chunkCount} fragmentos en ` +
        `${formatPageSummary(quality.teacherOnly.pages)}\n`
    );
  } finally {
    await parser.destroy();
  }
}

async function main(): Promise<void> {
  for (const book of selectedBooks()) {
    process.stdout.write(`Indexando ${book.id}…\n`);
    await indexBook(book);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
