import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  mkdtemp,
  open,
  rm,
  truncate
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const verifyOpenedPinnedFile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/file-integrity", () => ({ verifyOpenedPinnedFile }));

import {
  GET,
  HEAD
} from "@/app/api/materials/[bookId]/pdf/route";
import { getBook } from "@/lib/catalog";

const bookId = "fichas-matematica-1-secundaria";
const book = getBook(bookId);
let contentDir: string;
let pdfPath: string;

async function preparePinnedFile(): Promise<void> {
  if (!book) {
    throw new Error("El libro de prueba no está publicado.");
  }
  const handle = await open(pdfPath, "w", 0o600);
  try {
    await handle.write(Buffer.from("%PDF-"), 0, 5, 0);
  } finally {
    await handle.close();
  }
  await truncate(pdfPath, book.expectedBytes);
}

beforeAll(async () => {
  if (!book) {
    throw new Error("El catálogo de prueba no está disponible.");
  }
  contentDir = await mkdtemp(path.join(tmpdir(), "aimauta-material-route-"));
  pdfPath = path.join(contentDir, book.storageFile);
  process.env.AIMAUTA_CONTENT_DIR = contentDir;
  process.env.AIMAUTA_REMOTE_CONTENT_PROXY = "false";
});

beforeEach(async () => {
  verifyOpenedPinnedFile.mockResolvedValue(true);
  await preparePinnedFile();
});

afterAll(async () => {
  delete process.env.AIMAUTA_CONTENT_DIR;
  delete process.env.AIMAUTA_REMOTE_CONTENT_PROXY;
  await rm(contentDir, { recursive: true, force: true });
});

describe("ruta same-origin de materiales", () => {
  it("sirve rangos del PDF local fijado", async () => {
    const response = await GET(
      new Request(`http://localhost/api/materials/${bookId}/pdf`, {
        headers: { Range: "bytes=0-4" }
      }),
      { params: Promise.resolve({ bookId }) }
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-4/${book?.expectedBytes}`
    );
    expect(Buffer.from(await response.arrayBuffer()).toString("ascii")).toBe(
      "%PDF-"
    );
  });

  it("rechaza un archivo local cuyo tamaño cambió", async () => {
    await truncate(pdfPath, 6);

    const response = await HEAD(
      new Request(`http://localhost/api/materials/${bookId}/pdf`, {
        method: "HEAD"
      }),
      { params: Promise.resolve({ bookId }) }
    );

    expect(response.status).toBe(503);
  });

  it("rechaza un archivo local cuyo checksum cambió", async () => {
    verifyOpenedPinnedFile.mockResolvedValue(false);

    const response = await HEAD(
      new Request(`http://localhost/api/materials/${bookId}/pdf`, {
        method: "HEAD"
      }),
      { params: Promise.resolve({ bookId }) }
    );

    expect(response.status).toBe(503);
  });

  it("no activa el proxy remoto si no se habilita expresamente", async () => {
    await rm(pdfPath);

    const response = await GET(
      new Request(`http://localhost/api/materials/${bookId}/pdf`),
      { params: Promise.resolve({ bookId }) }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/proxy.+deshabilitado/iu)
    });
  });
});
