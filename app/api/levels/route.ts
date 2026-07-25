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

    const where: Prisma.LevelWhereInput = q
      ? { name: { contains: q, mode: "insensitive" } }
      : {};

    const [items, total] = await prisma.$transaction([
      prisma.level.findMany({
        where,
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.take,
        include: { _count: { select: { grades: true } } }
      }),
      prisma.level.count({ where })
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
    const level = await prisma.level.create({ data: { name } });
    return jsonResponse(level, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
