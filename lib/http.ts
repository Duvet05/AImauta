import { Prisma } from "@/lib/generated/prisma/client";
import { DatabaseUnavailableError } from "@/lib/prisma";
import { RateLimitError } from "@/lib/rate-limit";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.message }, error.status);
  }
  if (error instanceof DatabaseUnavailableError) {
    return jsonResponse({ error: error.message }, 503);
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      { error: error.message },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(error.retryAfterSeconds)
        }
      }
    );
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return jsonResponse(
      { error: "La base de datos no está disponible." },
      503
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P1001", "P1002", "P1008", "P1017"].includes(error.code)) {
      return jsonResponse(
        { error: "La base de datos no está disponible." },
        503
      );
    }
    if (error.code === "P2002") {
      return jsonResponse(
        { error: "Ya existe un registro con esos valores únicos." },
        409
      );
    }
    if (error.code === "P2025") {
      return jsonResponse({ error: "Registro no encontrado." }, 404);
    }
    if (error.code === "P2003") {
      return jsonResponse(
        { error: "Referencia inválida a otro registro." },
        400
      );
    }
  }
  console.error("Unhandled API failure", error);
  return jsonResponse({ error: "Error interno del servidor." }, 500);
}

export async function readJsonBody(request: Request): Promise<
  Record<string, unknown>
> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiError("El cuerpo debe ser un objeto JSON.", 400);
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("Solicitud JSON inválida.", 400);
  }
}

export function requiredString(
  value: unknown,
  field: string,
  { maxLength = 200 }: { maxLength?: number } = {}
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(`El campo "${field}" es obligatorio.`, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiError(
      `El campo "${field}" supera el máximo de ${maxLength} caracteres.`,
      400
    );
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  options?: { maxLength?: number }
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, field, options);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requiredEmail(value: unknown, field: string): string {
  const email = requiredString(value, field, { maxLength: 320 });
  if (!EMAIL_PATTERN.test(email)) {
    throw new ApiError(`El campo "${field}" debe ser un correo válido.`, 400);
  }
  return email.toLowerCase();
}

export function optionalEmail(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredEmail(value, field);
}

export function optionalStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ApiError(`El campo "${field}" debe ser un arreglo de IDs.`, 400);
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

export type Pagination = {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
};

export function parsePagination(
  searchParams: URLSearchParams,
  { defaultPageSize = 20, maxPageSize = 100 } = {}
): Pagination {
  const rawPage = Number(searchParams.get("page") ?? "1");
  const rawPageSize = Number(
    searchParams.get("pageSize") ?? String(defaultPageSize)
  );
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize > 0
      ? Math.min(rawPageSize, maxPageSize)
      : defaultPageSize;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  pagination: Pagination
): Response {
  return jsonResponse({
    data: items,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize))
    }
  });
}
