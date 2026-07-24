import {
  issueLearningSession,
  LearningSessionError,
  learningSessionErrorStatus,
  moveLearningSession,
  verifyLearningSession
} from "@/lib/learning-session";
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
  console.error("Learning session failure", error);
  return json({ error: "No se pudo iniciar la sesión de aprendizaje." }, 500);
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
      result = moveLearningSession(sessionToken, page);
    } else {
      consumeRateLimit({
        scope: "session-create",
        key: requestRateLimitKey(request),
        limit: 12,
        windowMs: 60_000
      });
      result = issueLearningSession({ bookId, page });
    }
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
