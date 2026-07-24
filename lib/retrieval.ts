import { readFile } from "node:fs/promises";
import path from "node:path";

export type IndexedChunk = {
  id: string;
  page: number;
  text: string;
  kind?: "content" | "exercise" | "instruction";
  teacherOnly?: boolean;
};

export type BookIndex = {
  version: 1;
  bookId: string;
  sourceSha256: string;
  chunks: IndexedChunk[];
};

export type Evidence = IndexedChunk & {
  score: number;
  sourceId: string;
};

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

export function rankChunks(input: {
  chunks: readonly IndexedChunk[];
  query: string;
  page: number;
  limit?: number;
}): Evidence[] {
  const queryTokens = tokens(input.query);
  const limit = Math.max(1, Math.min(input.limit ?? 3, 5));

  return input.chunks
    .filter(
      (chunk) =>
        !chunk.teacherOnly && Math.abs(chunk.page - input.page) <= 2
    )
    .map((chunk) => {
      const chunkTokens = tokens(chunk.text);
      let lexicalMatches = 0;
      for (const token of queryTokens) {
        if (chunkTokens.has(token)) {
          lexicalMatches += 1;
        }
      }

      const distance = Math.abs(chunk.page - input.page);
      const pageScore =
        distance === 0 ? 5 : distance === 1 ? 2.5 : distance === 2 ? 1 : 0;
      const lexicalScore =
        queryTokens.size === 0
          ? 0
          : (lexicalMatches / queryTokens.size) * 8;
      const exerciseBoost = chunk.kind === "exercise" ? 0.5 : 0;

      return {
        ...chunk,
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

function isBookIndex(value: unknown, expectedBookId: string): value is BookIndex {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<BookIndex>;
  return (
    candidate.version === 1 &&
    candidate.bookId === expectedBookId &&
    typeof candidate.sourceSha256 === "string" &&
    Array.isArray(candidate.chunks) &&
    candidate.chunks.every(
      (chunk) =>
        chunk &&
        typeof chunk.id === "string" &&
        Number.isInteger(chunk.page) &&
        chunk.page > 0 &&
        typeof chunk.text === "string"
    )
  );
}

export async function retrieveEvidence(input: {
  bookId: string;
  query: string;
  page: number;
}): Promise<Evidence[]> {
  if (path.basename(input.bookId) !== input.bookId) {
    return [];
  }

  const indexDir =
    process.env.AIMAUTA_INDEX_DIR ??
    path.resolve(process.cwd(), "data", "indexes");
  const indexPath = path.join(indexDir, `${input.bookId}.json`);

  try {
    const parsed: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    if (!isBookIndex(parsed, input.bookId)) {
      throw new Error(`Índice inválido para ${input.bookId}`);
    }
    return rankChunks({
      chunks: parsed.chunks,
      query: input.query,
      page: input.page
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
