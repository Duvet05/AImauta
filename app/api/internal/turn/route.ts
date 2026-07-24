import {
  InternalAuthConfigurationError,
  isAuthorizedAgentRequest
} from "@/lib/internal-auth";
import {
  LearningSessionError,
  learningSessionErrorStatus
} from "@/lib/learning-session";
import { RateLimitError } from "@/lib/rate-limit";
import { guideLearningTurn } from "@/lib/tutor-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InternalTurnRequest = {
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
  try {
    if (!isAuthorizedAgentRequest(request)) {
      return json({ error: "No autorizado." }, 401);
    }
  } catch (error) {
    if (error instanceof InternalAuthConfigurationError) {
      return json({ error: "Servicio no configurado." }, 503);
    }
    throw error;
  }

  let body: InternalTurnRequest;
  try {
    body = (await request.json()) as InternalTurnRequest;
  } catch {
    return json({ error: "Solicitud JSON inválida." }, 400);
  }

  const sessionToken = cleanText(body.sessionToken, 4_096);
  const message = cleanText(body.message, 1_500);
  const attempt = cleanText(body.attempt, 2_000);
  if (!sessionToken || !message) {
    return json({ error: "Se requieren sessionToken y message." }, 400);
  }

  try {
    return json(await guideLearningTurn({ sessionToken, message, attempt }));
  } catch (error) {
    if (error instanceof LearningSessionError) {
      return json({ error: error.message }, learningSessionErrorStatus(error));
    }
    if (error instanceof RateLimitError) {
      return json({ error: error.message }, 429, error.retryAfterSeconds);
    }
    console.error("Internal voice turn failure", error);
    return json({ error: "No se pudo procesar el turno de voz." }, 500);
  }
}
