import { prisma } from "@/lib/prisma";
import {
  ApiError,
  cascadeBlockedResponse,
  cascadeRequested,
  errorResponse,
  jsonResponse,
  optionalEmail,
  optionalString,
  optionalStringArray,
  readJsonBody
} from "@/lib/http";
import {
  presentStudentWithCourses,
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
    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: {
            course: { include: { grade: { include: { level: true } } } }
          }
        }
      }
    });
    if (!student) {
      throw new ApiError("Estudiante no encontrado.", 404);
    }
    return jsonResponse(presentStudentWithCourses(student));
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
    const firstName = optionalString(body.firstName, "firstName", {
      maxLength: 100
    });
    const lastName = optionalString(body.lastName, "lastName", {
      maxLength: 100
    });
    const email = optionalEmail(body.email, "email");
    const requestedCourseIds = optionalStringArray(
      body.courseIds,
      "courseIds"
    );
    const courseIds =
      requestedCourseIds === undefined
        ? undefined
        : uniqueRelationIds(requestedCourseIds);

    if (
      firstName === undefined &&
      lastName === undefined &&
      email === undefined &&
      courseIds === undefined
    ) {
      throw new ApiError("No hay campos para actualizar.", 400);
    }

    const student = await prisma.student.update({
      where: { id },
      data: {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(courseIds !== undefined
          ? {
              enrollments: {
                deleteMany:
                  courseIds.length > 0
                    ? { courseId: { notIn: courseIds } }
                    : {},
                connectOrCreate: courseIds.map((courseId) => ({
                  where: {
                    studentId_courseId: {
                      studentId: id,
                      courseId
                    }
                  },
                  create: {
                    course: { connect: { id: courseId } }
                  }
                }))
              }
            }
          : {})
      },
      include: {
        enrollments: { include: { course: true } }
      }
    });
    return jsonResponse(presentStudentWithCourses(student));
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
        where: { studentId: id }
      });
      if (enrollments > 0) {
        return cascadeBlockedResponse("matrículas", enrollments);
      }
    }
    await prisma.student.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
