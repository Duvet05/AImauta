import { requireAssignmentAdmin } from "@/lib/assignment-security";
import { assignmentProgressForAdmin } from "@/lib/assignment-service";
import {
  errorResponse,
  jsonResponse,
  requiredString
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    requireAssignmentAdmin(request);
    const { id } = await context.params;
    const teacherId = requiredString(
      new URL(request.url).searchParams.get("teacherId"),
      "teacherId",
      { maxLength: 100 }
    );
    return jsonResponse(
      await assignmentProgressForAdmin({ id, teacherId })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
