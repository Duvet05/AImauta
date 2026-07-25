import {
  issueLearningSession,
  type LearningExerciseBinding,
  LearningSessionError,
  learningSessionErrorStatus,
  moveLearningSession,
  verifyLearningSession
} from "@/lib/learning-session";
import {
  ExerciseManifestUnavailableError,
  getPublishedExercise
} from "@/lib/exercise-store";
import {
  consumeRateLimit,
  RateLimitError,
  requestRateLimitKey
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionRequest = {
  bookId?: unknown;
  page?: unknown;
  exerciseId?: unknown;
  exerciseRevision?: unknown;
  exerciseRegionId?: unknown;
  sessionToken?: unknown;
};

function json(body: unknown, status = 200, retryAfter?: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {})
    }
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof LearningSessionError) {
    return json({ error: error.message }, learningSessionErrorStatus(error));
  }
  if (error instanceof RateLimitError) {
    return json({ error: error.message }, 429, error.retryAfterSeconds);
  }
  if (error instanceof ExerciseManifestUnavailableError) {
    return json(
      { error: "Los ejercicios de este material no están disponibles." },
      503
    );
  }
  console.error("Learning session failure", error);
  return json({ error: "No se pudo iniciar la sesión de aprendizaje." }, 500);
}

async function resolveExerciseBinding(
  bookId: string,
  exerciseId: string | null,
  exerciseRevision: number | null,
  exerciseRegionId: string | null,
  page: number
): Promise<LearningExerciseBinding | null> {
  if (exerciseId === null) {
    if (exerciseRevision !== null || exerciseRegionId !== null) {
      throw new LearningSessionError(
        "La selección de ejercicio está incompleta.",
        "exercise"
      );
    }
    return null;
  }
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(exerciseId) ||
    exerciseId.length > 160 ||
    !Number.isSafeInteger(exerciseRevision) ||
    Number(exerciseRevision) < 1 ||
    exerciseRegionId === null ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(exerciseRegionId) ||
    exerciseRegionId.length > 200
  ) {
    throw new LearningSessionError(
      "El ejercicio solicitado no es válido.",
      "exercise"
    );
  }

  const exercise = await getPublishedExercise(bookId, exerciseId);
  if (
    !exercise ||
    exercise.revision !== exerciseRevision ||
    !exercise.regions.some(
      (region) =>
        region.id === exerciseRegionId && region.page === page
    )
  ) {
    throw new LearningSessionError(
      "El ejercicio no está habilitado en esta página.",
      "exercise"
    );
  }

  return {
    id: exercise.id,
    revision: exercise.revision,
    unitId: exercise.unitId,
    stage: exercise.stage,
    pages: [
      ...new Set(exercise.regions.map((region) => region.page))
    ].sort((left, right) => left - right)
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: SessionRequest;
  try {
    body = (await request.json()) as SessionRequest;
  } catch {
    return json({ error: "Solicitud JSON inválida." }, 400);
  }

  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  const sessionToken =
    typeof body.sessionToken === "string" ? body.sessionToken : "";
  const page = Number(body.page);
  if (
    body.exerciseId !== undefined &&
    body.exerciseId !== null &&
    typeof body.exerciseId !== "string"
  ) {
    return json({ error: "El identificador de ejercicio no es válido." }, 400);
  }
  const exerciseId =
    typeof body.exerciseId === "string"
      ? body.exerciseId.trim()
      : null;
  const exerciseRevision =
    body.exerciseRevision === undefined ||
    body.exerciseRevision === null
      ? null
      : Number(body.exerciseRevision);
  const exerciseRegionId =
    typeof body.exerciseRegionId === "string"
      ? body.exerciseRegionId.trim()
      : null;
  if (
    (body.exerciseRegionId !== undefined &&
      body.exerciseRegionId !== null &&
      typeof body.exerciseRegionId !== "string") ||
    (body.exerciseRevision !== undefined &&
      body.exerciseRevision !== null &&
      (typeof body.exerciseRevision !== "number" ||
        !Number.isSafeInteger(body.exerciseRevision)))
  ) {
    return json({ error: "La selección de ejercicio no es válida." }, 400);
  }

  try {
    let result;
    if (sessionToken) {
      const current = verifyLearningSession(sessionToken);
      consumeRateLimit({
        scope: "session-navigation",
        key: current.sessionId,
        limit: 60,
        windowMs: 60_000
      });
      const exercise = await resolveExerciseBinding(
        current.bookId,
        exerciseId,
        exerciseRevision,
        exerciseRegionId,
        page
      );
      result = moveLearningSession(sessionToken, page, exercise);
    } else {
      consumeRateLimit({
        scope: "session-create",
        key: requestRateLimitKey(request),
        limit: 12,
        windowMs: 60_000
      });
      const exercise = await resolveExerciseBinding(
        bookId,
        exerciseId,
        exerciseRevision,
        exerciseRegionId,
        page
      );
      result = issueLearningSession({ bookId, page, exercise });
    }
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
