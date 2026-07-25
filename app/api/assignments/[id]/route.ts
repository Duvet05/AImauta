import {
  getAssignmentForAdmin,
  patchAssignment
} from "@/lib/assignment-service";
import { requireAssignmentAdmin } from "@/lib/assignment-security";
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

function teacherIdFrom(request: Request): string {
  return requiredString(
    new URL(request.url).searchParams.get("teacherId"),
    "teacherId",
    { maxLength: 100 }
  );
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    requireAssignmentAdmin(request);
    const { id } = await context.params;
    return jsonResponse(
      await getAssignmentForAdmin(id, teacherIdFrom(request))
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    requireAssignmentAdmin(request);
    const { id } = await context.params;
    return jsonResponse(
      await patchAssignment({
        id,
        teacherId: teacherIdFrom(request),
        body: await readJsonBody(request)
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
