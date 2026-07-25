import { createHash } from "node:crypto";

import { getBook } from "@/lib/catalog";
import {
  ExerciseManifestNotPublishedError,
  ExerciseManifestUnavailableError,
  getPublishedExercisesForPage,
} from "@/lib/exercise-store";
import {
  PAGE_EXERCISES_SCHEMA_VERSION,
  type PageExercisesResponse,
} from "@/lib/page-exercises-response";
import { retrieveRagPageExercises } from "@/lib/rag-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ bookId: string }>;
};

// A stale overlay must never be rebound silently to a newer reviewed solution.
// ETags still avoid transferring an unchanged manifest, but every selection is
// revalidated against the current revision by /api/session.
const SUCCESS_CACHE_CONTROL = "no-cache, no-store, must-revalidate";

function errorResponse(message: string, status: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function requestedPage(request: Request, pageCount: number): number | null {
  const values = new URL(request.url).searchParams.getAll("page");
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) {
    return null;
  }
  const page = Number(values[0]);
  return Number.isSafeInteger(page) && page <= pageCount ? page : null;
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) {
    return false;
  }
  const normalizedEtag = etag.replace(/^W\//, "");
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === normalizedEtag;
  });
}

function notPublishedResponse(
  bookId: string,
  page: number,
): Response {
  return Response.json(
    {
      schemaVersion: PAGE_EXERCISES_SCHEMA_VERSION,
      bookId,
      page,
      publicationStatus: "not-published",
      exercises: [],
    } satisfies PageExercisesResponse,
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function availableResponse(
  request: Request,
  response: PageExercisesResponse,
): Response {
  const body = JSON.stringify(response);
  const etag = `"${createHash("sha256")
    .update(body)
    .digest("base64url")}"`;
  const headers = new Headers({
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    ETag: etag,
  });

  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(body, { status: 200, headers });
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { bookId } = await context.params;
  const book = getBook(bookId);
  if (!book) {
    return errorResponse("Material no encontrado.", 404);
  }

  const page = requestedPage(request, book.pages);
  if (page === null) {
    return errorResponse(
      `La página debe ser un entero entre 1 y ${book.pages}.`,
      400,
    );
  }

  try {
    const exercises = (
      await getPublishedExercisesForPage(book.id, page)
    ).filter(
      (exercise) =>
        exercise.status === "published" &&
        exercise.regions.some((region) => region.page === page),
    );
    return availableResponse(request, {
      schemaVersion: PAGE_EXERCISES_SCHEMA_VERSION,
      bookId: book.id,
      page,
      publicationStatus: "published",
      exercises: exercises.map((exercise) => ({
        ...exercise,
        status: "published",
        origin: "reviewed",
      })),
    });
  } catch (error) {
    if (error instanceof ExerciseManifestNotPublishedError) {
      try {
        const exercises = await retrieveRagPageExercises({
          bookId: book.id,
          page,
        });
        if (exercises.length > 0) {
          return availableResponse(request, {
            schemaVersion: PAGE_EXERCISES_SCHEMA_VERSION,
            bookId: book.id,
            page,
            publicationStatus: "rag-indexed",
            exercises,
          });
        }
      } catch {
        // A page marker is optional; page tutoring retains its own validated
        // local fallback if the isolated RAG service is unavailable.
      }
      return notPublishedResponse(book.id, page);
    }

    console.error("Public exercise manifest failure", {
      bookId,
      reason:
        error instanceof ExerciseManifestUnavailableError
          ? error.reason
          : "unexpected",
    });
    return errorResponse(
      "Los ejercicios de este material no están disponibles.",
      503,
    );
  }
}
