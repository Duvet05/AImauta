import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

import {
  getBook,
  isAllowedOfficialSource,
  type Book
} from "@/lib/catalog";
import { parseByteRange } from "@/lib/ranges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ bookId: string }>;
};

function pdfHeaders(): Headers {
  return new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": 'inline; filename="material-aimauta.pdf"',
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin"
  });
}

async function localPdfResponse(
  request: Request,
  book: Book,
  headOnly: boolean
): Promise<Response | null> {
  const contentDir = process.env.AIMAUTA_CONTENT_DIR;
  if (
    !contentDir ||
    path.basename(book.storageFile) !== book.storageFile
  ) {
    return null;
  }

  const filePath = path.join(contentDir, book.storageFile);
  let fileSize: number;

  try {
    fileSize = (await stat(filePath)).size;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
  if (fileSize !== book.expectedBytes) {
    return Response.json(
      { error: "El material local no coincide con la edición aprobada." },
      { status: 503 }
    );
  }

  const headers = pdfHeaders();
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");

  try {
    const range = parseByteRange(request.headers.get("range"), fileSize);
    if (!range) {
      headers.set("Content-Length", String(fileSize));
      const body = headOnly
        ? null
        : (Readable.toWeb(createReadStream(filePath)) as ReadableStream);
      return new Response(body, { status: 200, headers });
    }

    const length = range.end - range.start + 1;
    headers.set("Content-Length", String(length));
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${fileSize}`
    );
    const body = headOnly
      ? null
      : (Readable.toWeb(
          createReadStream(filePath, { start: range.start, end: range.end })
        ) as ReadableStream);
    return new Response(body, { status: 206, headers });
  } catch (error) {
    if (error instanceof RangeError) {
      headers.set("Content-Range", `bytes */${fileSize}`);
      return new Response(null, { status: 416, headers });
    }
    throw error;
  }
}

async function remotePdfResponse(
  request: Request,
  book: Book,
  headOnly: boolean
): Promise<Response> {
  if (process.env.AIMAUTA_REMOTE_CONTENT_PROXY !== "true") {
    return Response.json(
      { error: "El proxy de contenido remoto está deshabilitado." },
      { status: 503 }
    );
  }

  const source = new URL(book.sourcePdfUrl);
  if (!isAllowedOfficialSource(source)) {
    return Response.json(
      { error: "La fuente del material no está autorizada." },
      { status: 403 }
    );
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  const upstream = await fetch(source, {
    method: headOnly ? "HEAD" : "GET",
    headers: upstreamHeaders,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });

  if (!upstream.ok && upstream.status !== 206) {
    return Response.json(
      { error: "No se pudo obtener el material desde la fuente oficial." },
      { status: 502 }
    );
  }
  if (
    !upstream.headers
      .get("content-type")
      ?.toLocaleLowerCase("en-US")
      .includes("application/pdf")
  ) {
    await upstream.body?.cancel();
    return Response.json(
      { error: "La fuente oficial no devolvió un archivo PDF." },
      { status: 502 }
    );
  }

  const contentLength = Number(upstream.headers.get("content-length"));
  if (
    !range &&
    Number.isFinite(contentLength) &&
    contentLength !== book.expectedBytes
  ) {
    await upstream.body?.cancel();
    return Response.json(
      { error: "El archivo remoto no coincide con la edición aprobada." },
      { status: 502 }
    );
  }

  const headers = pdfHeaders();
  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "etag",
    "last-modified"
  ]) {
    const value = upstream.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  headers.set("Cache-Control", "private, max-age=900");
  headers.set("X-AImauta-Content-Source", "official-remote");

  return new Response(headOnly ? null : upstream.body, {
    status: upstream.status,
    headers
  });
}

async function handle(
  request: Request,
  context: RouteContext,
  headOnly: boolean
): Promise<Response> {
  const { bookId } = await context.params;
  const book = getBook(bookId);
  if (!book) {
    return Response.json({ error: "Material no encontrado." }, { status: 404 });
  }

  const local = await localPdfResponse(request, book, headOnly);
  if (local) {
    return local;
  }

  return remotePdfResponse(request, book, headOnly);
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return handle(request, context, false);
}

export async function HEAD(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return handle(request, context, true);
}
