import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("directorio escolar opcional", () => {
  it("no exige DATABASE_URL al importar el cliente", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const prismaModule = await import("@/lib/prisma");

    expect(prismaModule.prisma).toBeDefined();
  });

  it("falla de forma explícita sólo al intentar usar la base", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { DatabaseUnavailableError, prisma } = await import(
      "@/lib/prisma"
    );

    expect(() => prisma.level).toThrow(DatabaseUnavailableError);
  });

  it("convierte la base no configurada en una respuesta 503 saneada", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const [{ DatabaseUnavailableError }, { errorResponse }] =
      await Promise.all([
        import("@/lib/prisma"),
        import("@/lib/http")
      ]);

    const response = errorResponse(new DatabaseUnavailableError());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "El directorio escolar todavía no está configurado."
    });
  });

  it("mantiene las rutas escolares cerradas sin tumbar la aplicación", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { GET } = await import("@/app/api/levels/route");

    const response = await GET(
      new Request("http://aimauta.test/api/levels")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "El directorio escolar todavía no está configurado."
    });
  });
});
