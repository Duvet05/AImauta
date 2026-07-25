import { beforeEach, describe, expect, it, vi } from "vitest";

const teacherGuard = vi.hoisted(() => ({
  hasTeacherSession: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/app/docente/guard", () => teacherGuard);

import { GET } from "@/app/docente/api/assignments/[id]/qr/route";

describe("QR del panel docente", () => {
  beforeEach(() => {
    teacherGuard.hasTeacherSession.mockReset();
  });

  it("rechaza sin consultar la tarea cuando falta la sesión docente", async () => {
    teacherGuard.hasTeacherSession.mockResolvedValue(false);

    const response = await GET(
      new Request(
        "https://aimauta.test/docente/api/assignments/assignment-id/qr",
      ),
      { params: Promise.resolve({ id: "assignment-id" }) },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "No autorizado.",
    });
  });

  it("exige identificar al docente incluso con una sesión válida", async () => {
    teacherGuard.hasTeacherSession.mockResolvedValue(true);

    const response = await GET(
      new Request(
        "https://aimauta.test/docente/api/assignments/assignment-id/qr",
      ),
      { params: Promise.resolve({ id: "assignment-id" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'El campo "teacherId" es obligatorio.',
    });
  });
});
