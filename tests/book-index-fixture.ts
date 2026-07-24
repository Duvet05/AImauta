import { getBook } from "@/lib/catalog";
import {
  getBookCurriculum,
  getPageActivity
} from "@/lib/curriculum";
import {
  BOOK_INDEX_VERSION,
  INDEX_EXTRACTOR_VERSION,
  type BookIndex,
  type IndexedChunk
} from "@/lib/retrieval";

const defaultBookId = "fichas-matematica-1-secundaria";

type TestChunk = Pick<IndexedChunk, "id" | "page" | "text"> &
  Partial<
    Pick<
      IndexedChunk,
      "kind" | "teacherOnly" | "stage" | "unitId"
    >
  >;

export function makeBookIndex(
  chunks: readonly TestChunk[],
  overrides: Partial<BookIndex> = {}
): BookIndex {
  const book = getBook(defaultBookId);
  const curriculum = getBookCurriculum(defaultBookId);
  if (!book || !curriculum) {
    throw new Error("El catálogo de prueba no está disponible");
  }

  const normalizedChunks: IndexedChunk[] = chunks.map((chunk) => {
    const activity = getPageActivity(book.id, chunk.page);
    return {
      id: chunk.id,
      page: chunk.page,
      text: chunk.text,
      kind: chunk.kind ?? "exercise",
      teacherOnly: chunk.teacherOnly ?? false,
      stage: chunk.stage ?? activity.stage,
      unitId:
        chunk.unitId === undefined ? activity.unitId : chunk.unitId
    };
  });
  const coveredPages = new Set(normalizedChunks.map((chunk) => chunk.page));
  const teacherOnlyChunks = normalizedChunks.filter(
    (chunk) => chunk.teacherOnly
  );

  return {
    version: BOOK_INDEX_VERSION,
    extractorVersion: INDEX_EXTRACTOR_VERSION,
    generatedAt: "2026-07-24T00:00:00.000Z",
    bookId: book.id,
    sourceSha256: book.expectedSha256,
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
    quality: {
      missing: Array.from(
        { length: book.pages },
        (_, index) => index + 1
      ).filter((page) => !coveredPages.has(page)),
      outliers: [],
      teacherOnly: {
        chunkCount: teacherOnlyChunks.length,
        pages: [
          ...new Set(teacherOnlyChunks.map((chunk) => chunk.page))
        ].sort((left, right) => left - right)
      }
    },
    license: {
      name: book.licenseName,
      url: book.licenseUrl,
      attribution: book.attribution
    },
    chunks: normalizedChunks,
    ...overrides
  };
}
