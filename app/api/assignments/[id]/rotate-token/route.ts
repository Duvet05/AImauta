import { requireAssignmentAdmin } from "@/lib/assignment-security";
import { rotateAssignmentPublicToken } from "@/lib/assignment-service";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requiredString
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    requireAssignmentAdmin(request);
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const teacherId = requiredString(body.teacherId, "teacherId", {
      maxLength: 100
    });
    return jsonResponse(
      await rotateAssignmentPublicToken({ id, teacherId })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
