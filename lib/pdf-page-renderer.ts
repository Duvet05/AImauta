import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import { MAX_INGEST_PDF_BYTES } from "@/lib/catalog";
import type { GemmaIngestImage } from "@/lib/gemma-ingest";

export const PDF_RENDER_VERSION =
  "aimauta-pdfjs-6.1.200-napi-canvas-jpeg-v1" as const;

const DEFAULT_MAX_DIMENSION = 1_600;
const MIN_MAX_DIMENSION = 256;
const MAX_PAGE_COUNT = 10_000;
const DEFAULT_JPEG_QUALITY = 90;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export type RenderedPdfPage = GemmaIngestImage & {
  width: number;
  height: number;
  renderSha256: string;
};

export type OpenPdfPageRendererInput = {
  pdfPath: string;
  expectedSha256: string;
  expectedPageCount: number;
  expectedBytes?: number;
  maxDimension?: number;
  jpegQuality?: number;
};

export type RenderPdfPagesInput = OpenPdfPageRendererInput & {
  pages: readonly number[];
};

export type PdfPageRenderer = {
  readonly pageCount: number;
  readonly sourceSha256: string;
  renderPages(pages: readonly number[]): Promise<RenderedPdfPage[]>;
  close(): Promise<void>;
};

export type PdfPageRendererErrorCode =
  | "INVALID_INPUT"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "INVALID_PDF"
  | "CHECKSUM_MISMATCH"
  | "PAGE_COUNT_MISMATCH"
  | "PAGE_OUT_OF_RANGE"
  | "RENDER_FAILED"
  | "CLOSED";

export class PdfPageRendererError extends Error {
  readonly code: PdfPageRendererErrorCode;

  constructor(code: PdfPageRendererErrorCode) {
    const messages: Record<PdfPageRendererErrorCode, string> = {
      INVALID_INPUT: "La configuración del renderizador no es válida.",
      FILE_NOT_FOUND: "No se encontró el PDF local.",
      FILE_TOO_LARGE: "El PDF supera el límite de 50 MiB.",
      INVALID_PDF: "El archivo local no es un PDF válido.",
      CHECKSUM_MISMATCH: "El PDF no coincide con el checksum del catálogo.",
      PAGE_COUNT_MISMATCH:
        "El número de páginas no coincide con el catálogo.",
      PAGE_OUT_OF_RANGE: "Se solicitó una página fuera del PDF.",
      RENDER_FAILED: "No se pudo renderizar una página del PDF.",
      CLOSED: "El renderizador de PDF ya está cerrado."
    };
    super(messages[code]);
    this.name = "PdfPageRendererError";
    this.code = code;
  }
}

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<
  ReturnType<PdfJsModule["getDocument"]>["promise"]
>;

function invalidInput(): never {
  throw new PdfPageRendererError("INVALID_INPUT");
}

function validateConfiguration(input: OpenPdfPageRendererInput): {
  maxDimension: number;
  jpegQuality: number;
} {
  if (
    typeof input.pdfPath !== "string" ||
    !path.isAbsolute(input.pdfPath) ||
    !sha256Pattern.test(input.expectedSha256) ||
    !Number.isSafeInteger(input.expectedPageCount) ||
    input.expectedPageCount < 1 ||
    input.expectedPageCount > MAX_PAGE_COUNT ||
    (input.expectedBytes !== undefined &&
      (!Number.isSafeInteger(input.expectedBytes) ||
        input.expectedBytes < 5 ||
        input.expectedBytes > MAX_INGEST_PDF_BYTES))
  ) {
    invalidInput();
  }

  const maxDimension = input.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const jpegQuality = input.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  if (
    !Number.isInteger(maxDimension) ||
    maxDimension < MIN_MAX_DIMENSION ||
    maxDimension > DEFAULT_MAX_DIMENSION ||
    !Number.isInteger(jpegQuality) ||
    jpegQuality < 60 ||
    jpegQuality > 100
  ) {
    invalidInput();
  }
  return { maxDimension, jpegQuality };
}

async function readPinnedPdf(
  input: OpenPdfPageRendererInput
): Promise<Uint8Array> {
  let handle: FileHandle;
  try {
    handle = await open(
      input.pdfPath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new PdfPageRendererError("FILE_NOT_FOUND");
    }
    throw new PdfPageRendererError("INVALID_PDF");
  }

  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 5) {
      throw new PdfPageRendererError("INVALID_PDF");
    }
    if (metadata.size > MAX_INGEST_PDF_BYTES) {
      throw new PdfPageRendererError("FILE_TOO_LARGE");
    }
    if (
      input.expectedBytes !== undefined &&
      metadata.size !== input.expectedBytes
    ) {
      throw new PdfPageRendererError("CHECKSUM_MISMATCH");
    }

    const bytes = await handle.readFile();
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new PdfPageRendererError("INVALID_PDF");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== input.expectedSha256) {
      throw new PdfPageRendererError("CHECKSUM_MISMATCH");
    }
    return Uint8Array.from(bytes);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function validateRequestedPages(
  pages: readonly number[],
  pageCount: number
): number[] {
  if (!Array.isArray(pages) || pages.length === 0) {
    invalidInput();
  }
  const unique = new Set<number>();
  for (const page of pages) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > pageCount
    ) {
      throw new PdfPageRendererError("PAGE_OUT_OF_RANGE");
    }
    if (unique.has(page)) {
      invalidInput();
    }
    unique.add(page);
  }
  return [...pages];
}

async function renderPage(input: {
  pdfjs: PdfJsModule;
  document: PdfDocument;
  page: number;
  maxDimension: number;
  jpegQuality: number;
}): Promise<RenderedPdfPage> {
  let pdfPage: Awaited<ReturnType<PdfDocument["getPage"]>> | undefined;
  try {
    pdfPage = await input.document.getPage(input.page);
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const longest = Math.max(baseViewport.width, baseViewport.height);
    if (!Number.isFinite(longest) || longest <= 0) {
      throw new PdfPageRendererError("RENDER_FAILED");
    }

    const scale = input.maxDimension / longest;
    const viewport = pdfPage.getViewport({ scale });
    const width = Math.max(1, Math.min(
      input.maxDimension,
      Math.floor(viewport.width)
    ));
    const height = Math.max(1, Math.min(
      input.maxDimension,
      Math.floor(viewport.height)
    ));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    await pdfPage.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      annotationMode: input.pdfjs.AnnotationMode.DISABLE,
      background: "rgb(255,255,255)"
    }).promise;

    const jpeg = await canvas.encode("jpeg", input.jpegQuality);
    return {
      page: input.page,
      mimeType: "image/jpeg",
      base64: jpeg.toString("base64"),
      width,
      height,
      renderSha256: createHash("sha256").update(jpeg).digest("hex")
    };
  } catch (error) {
    if (error instanceof PdfPageRendererError) {
      throw error;
    }
    throw new PdfPageRendererError("RENDER_FAILED");
  } finally {
    pdfPage?.cleanup();
  }
}

export async function openPdfPageRenderer(
  input: OpenPdfPageRendererInput
): Promise<PdfPageRenderer> {
  const { maxDimension, jpegQuality } = validateConfiguration(input);
  const data = await readPinnedPdf(input);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let loadingTask: ReturnType<PdfJsModule["getDocument"]> | undefined;

  try {
    const documentOptions = {
      data,
      isEvalSupported: false,
      useSystemFonts: true
    };
    loadingTask = pdfjs.getDocument(documentOptions);
    const document = await loadingTask.promise;
    if (document.numPages !== input.expectedPageCount) {
      throw new PdfPageRendererError("PAGE_COUNT_MISMATCH");
    }

    const activeLoadingTask = loadingTask;
    let closed = false;
    const destroy = async () => {
      if (closed) {
        return;
      }
      closed = true;
      await activeLoadingTask.destroy().catch(() => undefined);
    };

    return {
      pageCount: document.numPages,
      sourceSha256: input.expectedSha256,
      async renderPages(pages) {
        if (closed) {
          throw new PdfPageRendererError("CLOSED");
        }
        const requested = validateRequestedPages(pages, document.numPages);
        const rendered: RenderedPdfPage[] = [];
        try {
          for (const page of requested) {
            rendered.push(
              await renderPage({
                pdfjs,
                document,
                page,
                maxDimension,
                jpegQuality
              })
            );
          }
          return rendered;
        } catch (error) {
          await destroy();
          throw error;
        }
      },
      async close() {
        await destroy();
      }
    };
  } catch (error) {
    await loadingTask?.destroy().catch(() => undefined);
    if (error instanceof PdfPageRendererError) {
      throw error;
    }
    throw new PdfPageRendererError("INVALID_PDF");
  }
}

export async function renderPdfPages(
  input: RenderPdfPagesInput
): Promise<RenderedPdfPage[]> {
  const renderer = await openPdfPageRenderer(input);
  try {
    return await renderer.renderPages(input.pages);
  } finally {
    await renderer.close();
  }
}
