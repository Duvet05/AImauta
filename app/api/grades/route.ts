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
    const levelId = searchParams.get("levelId");

    const where: Prisma.GradeWhereInput = {
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(levelId ? { levelId } : {})
    };

    const [items, total] = await prisma.$transaction([
      prisma.grade.findMany({
        where,
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          level: true,
          _count: { select: { courses: true } }
        }
      }),
      prisma.grade.count({ where })
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
    const levelId = requiredString(body.levelId, "levelId", { maxLength: 100 });
    const grade = await prisma.grade.create({
      data: { name, levelId },
      include: { level: true }
    });
    return jsonResponse(grade, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
