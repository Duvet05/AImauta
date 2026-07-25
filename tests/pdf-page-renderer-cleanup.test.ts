import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn()
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  AnnotationMode: { DISABLE: 0 },
  getDocument: pdfjs.getDocument
}));

import { openPdfPageRenderer } from "@/lib/pdf-page-renderer";

const temporaryDirectories: string[] = [];

async function sourceFixture(): Promise<{
  pdfPath: string;
  sha256: string;
}> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "aimauta-pdf-cleanup-")
  );
  temporaryDirectories.push(directory);
  const pdfPath = path.join(directory, "book.pdf");
  const bytes = Buffer.from("%PDF-cleanup-regression", "ascii");
  await writeFile(pdfPath, bytes);
  return {
    pdfPath,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

beforeEach(() => {
  pdfjs.getDocument.mockReset();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("limpieza de recursos del renderizador PDF", () => {
  it("destruye el loading task cuando falla la carga del documento", async () => {
    const fixture = await sourceFixture();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const rejectedLoad = Promise.reject(new Error("documento corrupto"));
    void rejectedLoad.catch(() => undefined);
    pdfjs.getDocument.mockReturnValue({
      promise: rejectedLoad,
      destroy
    });

    await expect(
      openPdfPageRenderer({
        pdfPath: fixture.pdfPath,
        expectedSha256: fixture.sha256,
        expectedPageCount: 1
      })
    ).rejects.toMatchObject({ code: "INVALID_PDF" });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destruye el documento cargado si no coincide el número de páginas", async () => {
    const fixture = await sourceFixture();
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2 }),
      destroy
    });

    await expect(
      openPdfPageRenderer({
        pdfPath: fixture.pdfPath,
        expectedSha256: fixture.sha256,
        expectedPageCount: 1
      })
    ).rejects.toMatchObject({ code: "PAGE_COUNT_MISMATCH" });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destruye y cierra el renderer tras un fallo de página", async () => {
    const fixture = await sourceFixture();
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockRejectedValue(new Error("render roto"))
      }),
      destroy
    });
    const renderer = await openPdfPageRenderer({
      pdfPath: fixture.pdfPath,
      expectedSha256: fixture.sha256,
      expectedPageCount: 1
    });

    await expect(renderer.renderPages([1])).rejects.toMatchObject({
      code: "RENDER_FAILED"
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(renderer.renderPages([1])).rejects.toMatchObject({
      code: "CLOSED"
    });
  });
});
