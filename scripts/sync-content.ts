import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  promises as fs
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  type Book,
  getBook,
  getBooks,
  isAllowedOfficialSource
} from "../lib/catalog";

type ContentRecord = {
  bookId: string;
  file: string;
  sourceUrl: string;
  bytes: number;
  sha256: string;
  syncedAt: string;
};

const contentDir =
  process.env.AIMAUTA_CONTENT_DIR ?? path.resolve(process.cwd(), "content");
const manifestDir = path.resolve(process.cwd(), "data", "manifests");

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function assertPdf(filePath: string, book: Book): Promise<number> {
  const handle = await fs.open(filePath, "r");
  const signature = Buffer.alloc(5);
  try {
    await handle.read(signature, 0, signature.length, 0);
  } finally {
    await handle.close();
  }

  if (signature.toString("ascii") !== "%PDF-") {
    throw new Error(`${book.id}: la descarga no tiene firma PDF`);
  }

  const size = (await fs.stat(filePath)).size;
  if (book.expectedBytes && size !== book.expectedBytes) {
    throw new Error(
      `${book.id}: tamaño inesperado (${size}; esperado ${book.expectedBytes})`
    );
  }
  return size;
}

async function syncBook(book: Book, force: boolean): Promise<ContentRecord> {
  const source = new URL(book.sourcePdfUrl);
  if (!isAllowedOfficialSource(source)) {
    throw new Error(`${book.id}: dominio de descarga no autorizado`);
  }

  await fs.mkdir(contentDir, { recursive: true });
  const destination = path.join(contentDir, book.storageFile);

  if (!force) {
    try {
      const bytes = await assertPdf(destination, book);
      const digest = await sha256(destination);
      if (book.expectedSha256 && digest !== book.expectedSha256) {
        throw new Error(`${book.id}: el checksum no coincide con el catálogo`);
      }
      return {
        bookId: book.id,
        file: destination,
        sourceUrl: source.href,
        bytes,
        sha256: digest,
        syncedAt: new Date().toISOString()
      };
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        throw error;
      }
    }
  }

  const temporary = `${destination}.part-${process.pid}`;
  try {
    const response = await fetch(source, {
      headers: {
        "User-Agent": "AImauta/0.1 content-sync (educational material)"
      },
      redirect: "error"
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `${book.id}: la fuente respondió HTTP ${response.status}`
      );
    }
    if (!response.headers.get("content-type")?.includes("application/pdf")) {
      throw new Error(`${book.id}: la fuente no devolvió application/pdf`);
    }

    await pipeline(
      Readable.fromWeb(response.body as never),
      createWriteStream(temporary, { flags: "wx", mode: 0o640 })
    );
    const bytes = await assertPdf(temporary, book);
    const digest = await sha256(temporary);
    if (book.expectedSha256 && digest !== book.expectedSha256) {
      throw new Error(`${book.id}: el checksum no coincide con el catálogo`);
    }
    await fs.rename(temporary, destination);
    return {
      bookId: book.id,
      file: destination,
      sourceUrl: source.href,
      bytes,
      sha256: digest,
      syncedAt: new Date().toISOString()
    };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function selectedBooks(): readonly Book[] {
  const bookFlagIndex = process.argv.indexOf("--book");
  if (bookFlagIndex === -1) {
    return getBooks();
  }

  const id = process.argv[bookFlagIndex + 1];
  const book = id ? getBook(id) : undefined;
  if (!book) {
    throw new Error(`Libro desconocido: ${id ?? "(vacío)"}`);
  }
  return [book];
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const records: ContentRecord[] = [];

  for (const book of selectedBooks()) {
    process.stdout.write(`Sincronizando ${book.id}…\n`);
    records.push(await syncBook(book, force));
  }

  await fs.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(
    manifestDir,
    "content-manifest.generated.json"
  );
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify({ version: 1, records }, null, 2)}\n`,
    { mode: 0o640 }
  );

  for (const record of records) {
    process.stdout.write(
      `✓ ${record.bookId}: ${record.bytes} bytes · sha256 ${record.sha256}\n`
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
