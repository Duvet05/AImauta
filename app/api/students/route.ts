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
import {
  presentStudentWithCourses,
  uniqueRelationIds
} from "@/lib/school-directory";

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

    const where: Prisma.StudentWhereInput = {
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
            enrollments: {
              some: {
                course: {
                  ...(courseId ? { id: courseId } : {}),
                  ...(gradeId ? { gradeId } : {}),
                  ...(levelId ? { grade: { levelId } } : {})
                }
              }
            }
          }
        : {})
    };

    const [items, total] = await prisma.$transaction([
      prisma.student.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          enrollments: {
            include: {
              course: { include: { grade: { include: { level: true } } } }
            }
          }
        }
      }),
      prisma.student.count({ where })
    ]);

    return paginatedResponse(
      items.map(presentStudentWithCourses),
      total,
      pagination
    );
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
    const courseIds = uniqueRelationIds(
      optionalStringArray(body.courseIds, "courseIds") ?? []
    );

    const student = await prisma.student.create({
      data: {
        firstName,
        lastName,
        email,
        ...(courseIds.length > 0
          ? {
              enrollments: {
                create: courseIds.map((courseId) => ({
                  course: { connect: { id: courseId } }
                }))
              }
            }
          : {})
      },
      include: {
        enrollments: { include: { course: true } }
      }
    });
    return jsonResponse(presentStudentWithCourses(student), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
