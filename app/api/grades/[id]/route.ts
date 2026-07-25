import { prisma } from "@/lib/prisma";
import {
  ApiError,
  cascadeBlockedResponse,
  cascadeRequested,
  errorResponse,
  jsonResponse,
  optionalString,
  readJsonBody
} from "@/lib/http";
import { presentCourseWithStudentCount } from "@/lib/school-directory";

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
    const grade = await prisma.grade.findUnique({
      where: { id },
      include: {
        level: true,
        courses: {
          orderBy: { name: "asc" },
          include: {
            _count: { select: { enrollments: true, teachers: true } }
          }
        }
      }
    });
    if (!grade) {
      throw new ApiError("Grado no encontrado.", 404);
    }
    return jsonResponse({
      ...grade,
      courses: grade.courses.map(presentCourseWithStudentCount)
    });
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
    const levelId = optionalString(body.levelId, "levelId", { maxLength: 100 });
    if (name === undefined && levelId === undefined) {
      throw new ApiError("No hay campos para actualizar.", 400);
    }
    const grade = await prisma.grade.update({
      where: { id },
      data: { ...(name !== undefined ? { name } : {}), ...(levelId !== undefined ? { levelId } : {}) },
      include: { level: true }
    });
    return jsonResponse(grade);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!cascadeRequested(request)) {
      const courses = await prisma.course.count({ where: { gradeId: id } });
      if (courses > 0) {
        return cascadeBlockedResponse("cursos", courses);
      }
    }
    await prisma.grade.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
