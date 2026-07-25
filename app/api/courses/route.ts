import { prisma } from "@/lib/prisma";
import {
  errorResponse,
  jsonResponse,
  paginatedResponse,
  parsePagination,
  readJsonBody,
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
    const gradeId = searchParams.get("gradeId");
    const levelId = searchParams.get("levelId");
    const studentId = searchParams.get("studentId");
    const teacherId = searchParams.get("teacherId");

    const where: Prisma.CourseWhereInput = {
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(gradeId ? { gradeId } : {}),
      ...(levelId ? { grade: { levelId } } : {}),
      ...(studentId ? { students: { some: { id: studentId } } } : {}),
      ...(teacherId ? { teachers: { some: { id: teacherId } } } : {})
    };

    const [items, total] = await prisma.$transaction([
      prisma.course.findMany({
        where,
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          grade: { include: { level: true } },
          _count: { select: { students: true, teachers: true } }
        }
      }),
      prisma.course.count({ where })
    ]);

    return paginatedResponse(items, total, pagination);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const name = requiredString(body.name, "name", { maxLength: 100 });
    const gradeId = requiredString(body.gradeId, "gradeId", { maxLength: 100 });
    const course = await prisma.course.create({
      data: { name, gradeId },
      include: { grade: { include: { level: true } } }
    });
    return jsonResponse(course, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
