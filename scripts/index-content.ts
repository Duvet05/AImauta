import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { PDFParse } from "pdf-parse";

import { getBook, getBooks, type Book } from "../lib/catalog";
import type { BookIndex, IndexedChunk } from "../lib/retrieval";

const contentDir =
  process.env.AIMAUTA_CONTENT_DIR ?? path.resolve(process.cwd(), "content");
const indexDir =
  process.env.AIMAUTA_INDEX_DIR ??
  path.resolve(process.cwd(), "data", "indexes");

function selectedBooks(): readonly Book[] {
  const index = process.argv.indexOf("--book");
  if (index === -1) {
    return getBooks();
  }
  const id = process.argv[index + 1];
  const book = id ? getBook(id) : undefined;
  if (!book) {
    throw new Error(`Libro desconocido: ${id ?? "(vacío)"}`);
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

function inferKind(text: string): IndexedChunk["kind"] {
  if (
    /\b(situación|actividad|resuelve|evaluamos|comprobamos|pregunta)\b/i.test(
      text
    )
  ) {
    return "exercise";
  }
  if (/\b(indicación|instrucción|lee|observa|completa)\b/i.test(text)) {
    return "instruction";
  }
  return "content";
}

function pageChunks(bookId: string, page: number, rawText: string): IndexedChunk[] {
  const words = compactText(rawText).split(/\s+/).filter(Boolean);
  if (words.length < 5) {
    return [];
  }

  const size = 360;
  const overlap = 40;
  const chunks: IndexedChunk[] = [];

  for (let start = 0, position = 0; start < words.length; position += 1) {
    const end = Math.min(start + size, words.length);
    const text = words.slice(start, end).join(" ");
    chunks.push({
      id: `${bookId}:p${page}:c${position}`,
      page,
      text,
      kind: inferKind(text),
      teacherOnly:
        /\b(?:solución|resolución|respuesta)\s*:/iu.test(text) || undefined
    });
    if (end === words.length) {
      break;
    }
    start = end - overlap;
  }

  return chunks;
}

async function indexBook(book: Book): Promise<void> {
  const pdfPath = path.join(contentDir, book.storageFile);
  const data = await fs.readFile(pdfPath);
  const digest = createHash("sha256").update(data).digest("hex");
  if (book.expectedSha256 && digest !== book.expectedSha256) {
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

    const chunks = result.pages.flatMap((page) =>
      pageChunks(book.id, page.num, page.text)
    );
    const index: BookIndex & {
      generatedAt: string;
      license: { name: string; url: string; attribution: string };
    } = {
      version: 1,
      bookId: book.id,
      sourceSha256: digest,
      generatedAt: new Date().toISOString(),
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
