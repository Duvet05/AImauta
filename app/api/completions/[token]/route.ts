import { hashAssignmentToken } from "@/lib/assignment-security";
import { verifyCompletionReceipt } from "@/lib/assignment-service";
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
      scope: "assignment-receipt",
      key:
        `${requestRateLimitKey(request)}:` +
        hashAssignmentToken("assignment-receipt", token).slice(0, 22),
      limit: 120,
      windowMs: 60_000
    });
    return jsonResponse(await verifyCompletionReceipt(token));
  } catch (error) {
    return errorResponse(error);
  }
}
