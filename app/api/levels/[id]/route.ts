import { prisma } from "@/lib/prisma";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  optionalString,
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
    const level = await prisma.level.findUnique({
      where: { id },
      include: {
        grades: {
          orderBy: { name: "asc" },
          include: { _count: { select: { courses: true } } }
        }
      }
    });
    if (!level) {
      throw new ApiError("Nivel no encontrado.", 404);
    }
    return jsonResponse(level);
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
    if (name === undefined) {
      throw new ApiError("No hay campos para actualizar.", 400);
    }
    const level = await prisma.level.update({ where: { id }, data: { name } });
    return jsonResponse(level);
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
    await prisma.level.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
