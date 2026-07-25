import {
  hashAssignmentToken
} from "@/lib/assignment-security";
import { resolvePublicAssignment } from "@/lib/assignment-service";
import { errorResponse, jsonResponse } from "@/lib/http";
import {
  consumeRateLimit,
  requestRateLimitKey
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { token } = await context.params;
    consumeRateLimit({
      scope: "assignment-resolve",
      key:
        `${requestRateLimitKey(request)}:` +
        hashAssignmentToken("assignment-public", token).slice(0, 22),
      limit: 120,
      windowMs: 60_000
    });
    const resolved = await resolvePublicAssignment(token);
    return jsonResponse(resolved.public);
  } catch (error) {
    return errorResponse(error);
  }
}
