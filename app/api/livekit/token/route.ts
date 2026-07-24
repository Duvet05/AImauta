import {
  createVoiceAccess,
  VoiceConfigurationError,
  VoiceUnavailableError
} from "@/lib/livekit-server";
import { isVoiceTutorEnabled } from "@/lib/feature-flags";
import {
  LearningSessionError,
  learningSessionErrorStatus
} from "@/lib/learning-session";
import { RateLimitError } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isVoiceTutorEnabled()) {
    return json({ error: "El tutor por voz está deshabilitado." }, 404);
  }

  let sessionToken = "";
  try {
    const body = (await request.json()) as { sessionToken?: unknown };
    sessionToken =
      typeof body.sessionToken === "string"
        ? body.sessionToken.trim().slice(0, 4_096)
        : "";
  } catch {
    return json({ error: "Solicitud JSON inválida." }, 400);
  }

  if (!sessionToken) {
    return json({ error: "Se requiere una sesión de aprendizaje." }, 400);
  }

  try {
    const access = await createVoiceAccess(sessionToken);
    return json(access);
  } catch (error) {
    if (error instanceof LearningSessionError) {
      return json({ error: error.message }, learningSessionErrorStatus(error));
    }
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: error.message },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(error.retryAfterSeconds)
          }
        }
      );
    }
    if (error instanceof VoiceUnavailableError) {
      return json({ error: error.message }, 423);
    }
    if (error instanceof VoiceConfigurationError) {
      return json({ error: error.message }, 503);
    }
    console.error("LiveKit token failure", error);
    return json({ error: "No se pudo iniciar el tutor de voz." }, 502);
  }
}
