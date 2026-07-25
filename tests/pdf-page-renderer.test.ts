import { createHash } from "node:crypto";
import {
  mkdtemp,
  open,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_INGEST_PDF_BYTES } from "@/lib/catalog";
import {
  PdfPageRendererError,
  openPdfPageRenderer,
  renderPdfPages
} from "@/lib/pdf-page-renderer";

const temporaryDirectories: string[] = [];

function buildPdf(pageCount = 1): Buffer {
  const entries = new Map<number, string>();
  const fontObject = 3 + pageCount * 2;
  const kids: string[] = [];
  entries.set(1, "<< /Type /Catalog /Pages 2 0 R >>");

  for (let index = 0; index < pageCount; index += 1) {
    const pageObject = 3 + index * 2;
    const contentObject = pageObject + 1;
    kids.push(`${pageObject} 0 R`);
    const stream = `BT /F1 18 Tf 20 50 Td (Page ${index + 1}) Tj ET`;
    entries.set(
      pageObject,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] " +
        `/Resources << /Font << /F1 ${fontObject} 0 R >> >> ` +
        `/Contents ${contentObject} 0 R >>`
    );
    entries.set(
      contentObject,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
    );
  }
  entries.set(
    2,
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`
  );
  entries.set(
    fontObject,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  );

  const header = "%PDF-1.4\n%----\n";
  let body = header;
  const offsets = new Map<number, number>();
  for (let object = 1; object <= fontObject; object += 1) {
    offsets.set(object, Buffer.byteLength(body));
    body += `${object} 0 obj\n${entries.get(object)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${fontObject + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let object = 1; object <= fontObject; object += 1) {
    body += `${String(offsets.get(object)).padStart(10, "0")} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${fontObject + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

async function pdfFixture(pageCount = 1): Promise<{
  directory: string;
  pdfPath: string;
  bytes: Buffer;
  sha256: string;
}> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "aimauta-pdf-renderer-")
  );
  temporaryDirectories.push(directory);
  const pdfPath = path.join(directory, "book.pdf");
  const bytes = buildPdf(pageCount);
  await writeFile(pdfPath, bytes);
  return {
    directory,
    pdfPath,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("renderizador PDF server-side", () => {
  it("valida el PDF y renderiza JPEG limitado a 1600 px", async () => {
    const fixture = await pdfFixture(2);
    const pages = await renderPdfPages({
      pdfPath: fixture.pdfPath,
      expectedSha256: fixture.sha256,
      expectedPageCount: 2,
      expectedBytes: fixture.bytes.length,
      pages: [1, 2]
    });

    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
    for (const page of pages) {
      expect(page.mimeType).toBe("image/jpeg");
      expect(Math.max(page.width, page.height)).toBeLessThanOrEqual(1_600);
      expect(page.width).toBe(1_600);
      expect(page.height).toBe(800);
      expect(Buffer.from(page.base64, "base64").subarray(0, 3)).toEqual(
        Buffer.from([0xff, 0xd8, 0xff])
      );
      expect(page.renderSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("rechaza checksum, magic y número de páginas incorrectos", async () => {
    const fixture = await pdfFixture(1);
    await expect(
      renderPdfPages({
        pdfPath: fixture.pdfPath,
        expectedSha256: "0".repeat(64),
        expectedPageCount: 1,
        pages: [1]
      })
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });

    const invalidPath = path.join(fixture.directory, "invalid.pdf");
    const invalid = Buffer.from("not-a-pdf");
    await writeFile(invalidPath, invalid);
    await expect(
      renderPdfPages({
        pdfPath: invalidPath,
        expectedSha256: createHash("sha256").update(invalid).digest("hex"),
        expectedPageCount: 1,
        pages: [1]
      })
    ).rejects.toMatchObject({ code: "INVALID_PDF" });

    await expect(
      renderPdfPages({
        pdfPath: fixture.pdfPath,
        expectedSha256: fixture.sha256,
        expectedPageCount: 2,
        pages: [1]
      })
    ).rejects.toMatchObject({ code: "PAGE_COUNT_MISMATCH" });
  });

  it("rechaza archivos mayores al límite antes de leerlos", async () => {
    const fixture = await pdfFixture(1);
    const oversizedPath = path.join(fixture.directory, "oversized.pdf");
    const handle = await open(oversizedPath, "w");
    try {
      await handle.write(Buffer.from("%PDF-"));
      await handle.truncate(MAX_INGEST_PDF_BYTES + 1);
    } finally {
      await handle.close();
    }

    await expect(
      openPdfPageRenderer({
        pdfPath: oversizedPath,
        expectedSha256: "0".repeat(64),
        expectedPageCount: 1
      })
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("no sigue enlaces simbólicos hacia un PDF", async () => {
    const fixture = await pdfFixture(1);
    const linkedPath = path.join(fixture.directory, "linked.pdf");
    await symlink(fixture.pdfPath, linkedPath);

    await expect(
      openPdfPageRenderer({
        pdfPath: linkedPath,
        expectedSha256: fixture.sha256,
        expectedPageCount: 1
      })
    ).rejects.toMatchObject({ code: "INVALID_PDF" });
  });

  it("cierra recursos y rechaza páginas inválidas o repetidas", async () => {
    const fixture = await pdfFixture(1);
    const renderer = await openPdfPageRenderer({
      pdfPath: fixture.pdfPath,
      expectedSha256: fixture.sha256,
      expectedPageCount: 1
    });

    await expect(renderer.renderPages([2])).rejects.toMatchObject({
      code: "PAGE_OUT_OF_RANGE"
    });
    await expect(renderer.renderPages([1, 1])).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
    await renderer.close();
    await renderer.close();
    await expect(renderer.renderPages([1])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PdfPageRendererError && error.code === "CLOSED"
    );
  });
});
