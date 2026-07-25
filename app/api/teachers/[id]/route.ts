import { prisma } from "@/lib/prisma";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  optionalEmail,
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
    const teacher = await prisma.teacher.findUnique({
      where: { id },
      include: { courses: { include: { grade: { include: { level: true } } } } }
    });
    if (!teacher) {
      throw new ApiError("Docente no encontrado.", 404);
    }
    return jsonResponse(teacher);
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
    const courseIds = optionalStringArray(body.courseIds, "courseIds");

    if (
      firstName === undefined &&
      lastName === undefined &&
      email === undefined &&
      courseIds === undefined
    ) {
      throw new ApiError("No hay campos para actualizar.", 400);
    }

    const teacher = await prisma.teacher.update({
      where: { id },
      data: {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(courseIds !== undefined
          ? { courses: { set: courseIds.map((courseId) => ({ id: courseId })) } }
          : {})
      },
      include: { courses: true }
    });
    return jsonResponse(teacher);
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
    await prisma.teacher.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
