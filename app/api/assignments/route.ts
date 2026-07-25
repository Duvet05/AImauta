import { parseCreateAssignmentInput } from "@/lib/assignment-content";
import { requireAssignmentAdmin } from "@/lib/assignment-security";
import {
  createAssignment,
  listAssignments
} from "@/lib/assignment-service";
import {
  errorResponse,
  jsonResponse,
  paginatedResponse,
  parsePagination,
  readJsonBody,
  requiredString
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    requireAssignmentAdmin(request);
    const { searchParams } = new URL(request.url);
    const teacherId = requiredString(
      searchParams.get("teacherId"),
      "teacherId",
      { maxLength: 100 }
    );
    const pagination = parsePagination(searchParams);
    const result = await listAssignments({
      teacherId,
      skip: pagination.skip,
      take: pagination.take
    });
    return paginatedResponse(
      result.assignments,
      result.total,
      pagination
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireAssignmentAdmin(request);
    const body = await readJsonBody(request);
    const input = await parseCreateAssignmentInput(body);
    return jsonResponse(await createAssignment(input), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
