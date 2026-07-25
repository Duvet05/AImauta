import {
  hashAssignmentToken,
  requireAssignmentResumeToken
} from "@/lib/assignment-security";
import { resumeAssignmentRun } from "@/lib/assignment-service";
import { errorResponse, jsonResponse } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const resumeToken = requireAssignmentResumeToken(request);
    consumeRateLimit({
      scope: "assignment-run-resume",
      key: hashAssignmentToken(
        "assignment-resume",
        resumeToken
      ).slice(0, 32),
      limit: 120,
      windowMs: 60_000
    });
    return jsonResponse(await resumeAssignmentRun(resumeToken));
  } catch (error) {
    return errorResponse(error);
  }
}
