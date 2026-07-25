import {
  LearningSessionError,
  learningSessionErrorStatus,
  verifyLearningSession
} from "@/lib/learning-session";
import { RateLimitError } from "@/lib/rate-limit";
import { ExerciseSolutionUnavailableError } from "@/lib/exercise-solution-store";
import { ExerciseManifestUnavailableError } from "@/lib/exercise-store";
import { guideLearningTurn } from "@/lib/tutor-service";
import { ApiError } from "@/lib/http";
import { DatabaseUnavailableError } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TutorRequest = {
  sessionToken?: unknown;
  message?: unknown;
  attempt?: unknown;
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function json(body: unknown, status = 200, retryAfter?: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {})
    }
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: TutorRequest;
  try {
    body = (await request.json()) as TutorRequest;
  } catch {
    return json({ error: "Solicitud JSON inválida." }, 400);
  }

  const sessionToken = cleanText(body.sessionToken, 4_096);
  const message = cleanText(body.message, 1_500);
  const attempt = cleanText(body.attempt, 2_000);

  if (!sessionToken) {
    return json(
      { error: "Inicia una sesión de aprendizaje antes de conversar." },
      401
    );
  }
  if (!message) {
    return json(
      { error: "Escribe una pregunta o cuéntame dónde te atascaste." },
      400
    );
  }

  try {
    verifyLearningSession(sessionToken);
    return json(await guideLearningTurn({ sessionToken, message, attempt }));
  } catch (error) {
    if (error instanceof LearningSessionError) {
      return json({ error: error.message }, learningSessionErrorStatus(error));
    }
    if (error instanceof ApiError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof DatabaseUnavailableError) {
      return json({ error: error.message }, 503);
    }
    if (error instanceof RateLimitError) {
      return json(
        { error: error.message },
        429,
        error.retryAfterSeconds
      );
    }
    if (
      error instanceof ExerciseManifestUnavailableError ||
      error instanceof ExerciseSolutionUnavailableError
    ) {
      return json(
        { error: "La guía revisada de este ejercicio no está disponible." },
        503
      );
    }
    console.error("Tutor turn failure", error);
    return json({ error: "AImauta no pudo procesar este turno." }, 500);
  }
}
