import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  promises as fs
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import {
  type AuthoringCatalogEntry,
  getAuthoringCatalogEntry,
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

type ContentManifest = {
  version: 2;
  records: ContentRecord[];
};

const contentDir =
  process.env.AIMAUTA_CONTENT_DIR ?? path.resolve(process.cwd(), "content");
const manifestDir =
  process.env.AIMAUTA_MANIFEST_DIR ??
  path.join(contentDir, ".manifests");
const downloadTimeoutMs = 120_000;

function assertPinnedBook(
  book: AuthoringCatalogEntry
): asserts book is AuthoringCatalogEntry & {
  expectedBytes: number;
  expectedSha256: string;
} {
  if (
    !Number.isSafeInteger(book.expectedBytes) ||
    book.expectedBytes <= 0 ||
    !/^[a-f0-9]{64}$/u.test(book.expectedSha256)
  ) {
    throw new Error(
      `${book.id}: tamaño y SHA-256 son obligatorios para sincronizar`
    );
  }
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function assertPdf(
  filePath: string,
  book: AuthoringCatalogEntry
): Promise<number> {
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

async function syncBook(
  book: AuthoringCatalogEntry,
  force: boolean
): Promise<ContentRecord> {
  assertPinnedBook(book);
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
      await fs.chmod(destination, 0o444);
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
      redirect: "error",
      signal: AbortSignal.timeout(downloadTimeoutMs)
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `${book.id}: la fuente respondió HTTP ${response.status}`
      );
    }
    if (
      !response.headers
        .get("content-type")
        ?.toLocaleLowerCase("en-US")
        .includes("application/pdf")
    ) {
      throw new Error(`${book.id}: la fuente no devolvió application/pdf`);
    }
    const declaredBytes = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes !== book.expectedBytes
    ) {
      throw new Error(
        `${book.id}: Content-Length inesperado (${declaredBytes}; esperado ${book.expectedBytes})`
      );
    }

    let streamedBytes = 0;
    const byteLimit = new Transform({
      transform(chunk, _encoding, callback) {
        const chunkBytes = Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk);
        streamedBytes += chunkBytes;
        if (streamedBytes > book.expectedBytes) {
          callback(
            new Error(
              `${book.id}: la descarga excedió el tamaño aprobado de ${book.expectedBytes} bytes`
            )
          );
          return;
        }
        callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(response.body as never),
      byteLimit,
      createWriteStream(temporary, { flags: "wx", mode: 0o640 })
    );
    const bytes = await assertPdf(temporary, book);
    const digest = await sha256(temporary);
    if (book.expectedSha256 && digest !== book.expectedSha256) {
      throw new Error(`${book.id}: el checksum no coincide con el catálogo`);
    }
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o444);
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

async function readManifest(manifestPath: string): Promise<ContentManifest> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(manifestPath, "utf8")
    ) as { version?: unknown; records?: unknown };
    if (
      (parsed.version === 1 || parsed.version === 2) &&
      Array.isArray(parsed.records)
    ) {
      return {
        version: 2,
        records: parsed.records.filter(
          (record): record is ContentRecord =>
            Boolean(
              record &&
                typeof record.bookId === "string" &&
                typeof record.file === "string" &&
                typeof record.sourceUrl === "string" &&
                Number.isSafeInteger(record.bytes) &&
                typeof record.sha256 === "string" &&
                typeof record.syncedAt === "string"
            )
        )
      };
    }
    throw new Error("El manifiesto de contenido existente es inválido.");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { version: 2, records: [] };
    }
    throw error;
  }
}

async function writeManifest(records: readonly ContentRecord[]): Promise<void> {
  await fs.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(
    manifestDir,
    "content-manifest.generated.json"
  );
  const existing = await readManifest(manifestPath);
  const recordsByBook = new Map(
    existing.records.map((record) => [record.bookId, record])
  );
  for (const record of records) {
    recordsByBook.set(record.bookId, record);
  }
  const manifest: ContentManifest = {
    version: 2,
    records: [...recordsByBook.values()].sort((left, right) =>
      left.bookId.localeCompare(right.bookId, "es")
    )
  };
  const temporary = `${manifestPath}.part-${process.pid}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o640
    });
    await fs.rename(temporary, manifestPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function selectedBooks(): readonly AuthoringCatalogEntry[] {
  const bookFlagIndex = process.argv.indexOf("--book");
  if (bookFlagIndex === -1) {
    return getBooks();
  }

  const id = process.argv[bookFlagIndex + 1];
  const book = id ? getAuthoringCatalogEntry(id) : undefined;
  if (!book) {
    throw new Error(
      `Libro desconocido, no tutorable o deshabilitado: ${id ?? "(vacío)"}`
    );
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

  await writeManifest(records);

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
