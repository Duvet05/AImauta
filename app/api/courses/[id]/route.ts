import { prisma } from "@/lib/prisma";
import {
  ApiError,
  cascadeBlockedResponse,
  cascadeRequested,
  errorResponse,
  jsonResponse,
  optionalString,
  optionalStringArray,
  readJsonBody
} from "@/lib/http";
import {
  presentCourseWithStudents,
  uniqueRelationIds
} from "@/lib/school-directory";

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
        enrollments: {
          orderBy: { student: { lastName: "asc" } },
          include: { student: true }
        },
        teachers: { orderBy: { lastName: "asc" } }
      }
    });
    if (!course) {
      throw new ApiError("Curso no encontrado.", 404);
    }
    return jsonResponse(presentCourseWithStudents(course));
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
    const requestedStudentIds = optionalStringArray(
      body.studentIds,
      "studentIds"
    );
    const studentIds =
      requestedStudentIds === undefined
        ? undefined
        : uniqueRelationIds(requestedStudentIds);
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
          ? {
              enrollments: {
                deleteMany:
                  studentIds.length > 0
                    ? { studentId: { notIn: studentIds } }
                    : {},
                connectOrCreate: studentIds.map((studentId) => ({
                  where: {
                    studentId_courseId: {
                      studentId,
                      courseId: id
                    }
                  },
                  create: {
                    student: { connect: { id: studentId } }
                  }
                }))
              }
            }
          : {}),
        ...(teacherIds !== undefined
          ? { teachers: { set: teacherIds.map((teacherId) => ({ id: teacherId })) } }
          : {})
      },
      include: {
        grade: { include: { level: true } },
        enrollments: { include: { student: true } },
        teachers: true
      }
    });
    return jsonResponse(presentCourseWithStudents(course));
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
      const enrollments = await prisma.enrollment.count({
        where: { courseId: id }
      });
      if (enrollments > 0) {
        return cascadeBlockedResponse("matrículas", enrollments);
      }
    }
    await prisma.course.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
