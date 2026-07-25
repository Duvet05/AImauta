import {
  hashAssignmentToken,
  requireAssignmentResumeToken
} from "@/lib/assignment-security";
import { startAssignmentItemSession } from "@/lib/assignment-service";
import { errorResponse, jsonResponse } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const resumeToken = requireAssignmentResumeToken(request);
    consumeRateLimit({
      scope: "assignment-item-session",
      key: hashAssignmentToken(
        "assignment-resume",
        resumeToken
      ).slice(0, 32),
      limit: 30,
      windowMs: 60_000
    });
    const { itemId } = await context.params;
    return jsonResponse(
      await startAssignmentItemSession({ resumeToken, itemId })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
