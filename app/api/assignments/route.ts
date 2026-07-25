import {
  AssignmentValidationError,
  createToken,
  validateAssignmentDraft,
} from "@/lib/assignments";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  paginatedResponse,
  parsePagination,
  readJsonBody,
  requiredString,
} from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { presentAssignment } from "@/lib/school-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Teacher-side task management. Guarded by the shared admin bearer in
// middleware.ts, same as the rest of the school directory: these routes expose
// class rosters and can revoke work students already started.

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePagination(searchParams);
    const courseId = searchParams.get("courseId");
    const teacherId = searchParams.get("teacherId");
    const bookId = searchParams.get("bookId");

    const where: Prisma.AssignmentWhereInput = {
      ...(courseId ? { courseId } : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(bookId ? { bookId } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.assignment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          course: { include: { grade: { include: { level: true } } } },
          _count: { select: { completions: true } },
        },
      }),
      prisma.assignment.count({ where }),
    ]);

    return paginatedResponse(items.map(presentAssignment), total, pagination);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const teacherId = requiredString(body.teacherId, "teacherId", {
      maxLength: 100,
    });
    const courseId = requiredString(body.courseId, "courseId", {
      maxLength: 100,
    });

    const draft = validateAssignmentDraft({
      bookId: body.bookId,
      title: body.title,
      instructions: body.instructions,
      firstPage: body.firstPage,
      lastPage: body.lastPage,
      unitId: body.unitId,
    });

    // The teacher must already be assigned to the course. Without this a valid
    // bearer could hand out work to any classroom in the school.
    const course = await prisma.course.findFirst({
      where: { id: courseId, teachers: { some: { id: teacherId } } },
      select: { id: true },
    });
    if (!course) {
      throw new ApiError(
        "El curso no existe o el docente no está asignado a él.",
        422,
      );
    }

    const assignment = await prisma.assignment.create({
      data: {
        ...draft,
        teacherId,
        courseId,
        token: createToken(),
      },
      include: {
        course: { include: { grade: { include: { level: true } } } },
        _count: { select: { completions: true } },
      },
    });

    return jsonResponse(presentAssignment(assignment), 201);
  } catch (error) {
    if (error instanceof AssignmentValidationError) {
      return errorResponse(new ApiError(error.message, 422));
    }
    return errorResponse(error);
  }
}
