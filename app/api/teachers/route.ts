import { prisma } from "@/lib/prisma";
import {
  errorResponse,
  jsonResponse,
  optionalStringArray,
  paginatedResponse,
  parsePagination,
  readJsonBody,
  requiredEmail,
  requiredString
} from "@/lib/http";
import type { Prisma } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePagination(searchParams);
    const q = searchParams.get("q");
    const email = searchParams.get("email");
    const courseId = searchParams.get("courseId");
    const gradeId = searchParams.get("gradeId");
    const levelId = searchParams.get("levelId");

    const where: Prisma.TeacherWhereInput = {
      ...(email ? { email: { equals: email, mode: "insensitive" } } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } }
            ]
          }
        : {}),
      ...(courseId || gradeId || levelId
        ? {
            courses: {
              some: {
                ...(courseId ? { id: courseId } : {}),
                ...(gradeId ? { gradeId } : {}),
                ...(levelId ? { grade: { levelId } } : {})
              }
            }
          }
        : {})
    };

    const [items, total] = await prisma.$transaction([
      prisma.teacher.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          courses: { include: { grade: { include: { level: true } } } }
        }
      }),
      prisma.teacher.count({ where })
    ]);

    return paginatedResponse(items, total, pagination);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const firstName = requiredString(body.firstName, "firstName", {
      maxLength: 100
    });
    const lastName = requiredString(body.lastName, "lastName", {
      maxLength: 100
    });
    const email = requiredEmail(body.email, "email");
    const courseIds = optionalStringArray(body.courseIds, "courseIds");

    const teacher = await prisma.teacher.create({
      data: {
        firstName,
        lastName,
        email,
        ...(courseIds
          ? { courses: { connect: courseIds.map((id) => ({ id })) } }
          : {})
      },
      include: { courses: true }
    });
    return jsonResponse(teacher, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
