import { prisma } from "@/lib/prisma";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  optionalString,
  optionalStringArray,
  readJsonBody
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        grade: { include: { level: true } },
        students: { orderBy: { lastName: "asc" } },
        teachers: { orderBy: { lastName: "asc" } }
      }
    });
    if (!course) {
      throw new ApiError("Curso no encontrado.", 404);
    }
    return jsonResponse(course);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const name = optionalString(body.name, "name", { maxLength: 100 });
    const gradeId = optionalString(body.gradeId, "gradeId", { maxLength: 100 });
    const studentIds = optionalStringArray(body.studentIds, "studentIds");
    const teacherIds = optionalStringArray(body.teacherIds, "teacherIds");

    if (
      name === undefined &&
      gradeId === undefined &&
      studentIds === undefined &&
      teacherIds === undefined
    ) {
      throw new ApiError("No hay campos para actualizar.", 400);
    }

    const course = await prisma.course.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(gradeId !== undefined ? { gradeId } : {}),
        ...(studentIds !== undefined
          ? { students: { set: studentIds.map((studentId) => ({ id: studentId })) } }
          : {}),
        ...(teacherIds !== undefined
          ? { teachers: { set: teacherIds.map((teacherId) => ({ id: teacherId })) } }
          : {})
      },
      include: {
        grade: { include: { level: true } },
        students: true,
        teachers: true
      }
    });
    return jsonResponse(course);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    await prisma.course.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
