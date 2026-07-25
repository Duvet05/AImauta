import { hashAssignmentToken } from "@/lib/assignment-security";
import { createAssignmentRun } from "@/lib/assignment-service";
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

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { token } = await context.params;
    consumeRateLimit({
      scope: "assignment-run-create",
      key:
        `${requestRateLimitKey(request)}:` +
        hashAssignmentToken("assignment-public", token).slice(0, 22),
      limit: 60,
      windowMs: 60_000
    });
    return jsonResponse(await createAssignmentRun(token), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
