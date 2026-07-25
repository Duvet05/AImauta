import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getCurrentRun } from "@/app/api/assignment-runs/current/route";
import { GET as listAssignments } from "@/app/api/assignments/route";
import { GET as downloadQr } from "@/app/api/assignments/[id]/qr/route";
import { GET as resolveAssignment } from "@/app/api/assignments/public/[token]/route";

const adminSecret =
  "assignment-route-admin-secret-with-at-least-32-characters";

beforeAll(() => {
  process.env.AIMAUTA_ASSIGNMENT_ADMIN_SECRET = adminSecret;
  process.env.AIMAUTA_ASSIGNMENT_TOKEN_SECRET =
    "assignment-route-token-secret-with-at-least-32-characters";
});

afterAll(() => {
  delete process.env.AIMAUTA_ASSIGNMENT_ADMIN_SECRET;
  delete process.env.AIMAUTA_ASSIGNMENT_TOKEN_SECRET;
});

describe("admisión de rutas QR", () => {
  it("cierra las rutas administrativas antes de consultar PostgreSQL", async () => {
    const unauthorized = await listAssignments(
      new Request("https://aimauta.test/api/assignments")
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Cache-Control")).toBe("no-store");

    const missingTeacher = await listAssignments(
      new Request("https://aimauta.test/api/assignments", {
        headers: { Authorization: `Bearer ${adminSecret}` }
      })
    );
    expect(missingTeacher.status).toBe(400);
  });

  it("protege también la descarga QR y el token de reanudación", async () => {
    const qrResponse = await downloadQr(
      new Request("https://aimauta.test/api/assignments/id/qr"),
      { params: Promise.resolve({ id: "assignment-id" }) }
    );
    expect(qrResponse.status).toBe(401);

    const resumeResponse = await getCurrentRun(
      new Request("https://aimauta.test/api/assignment-runs/current")
    );
    expect(resumeResponse.status).toBe(401);
  });

  it("rechaza tokens públicos mal formados sin tocar la base", async () => {
    const response = await resolveAssignment(
      new Request(
        "https://aimauta.test/api/assignments/public/not-a-token"
      ),
      { params: Promise.resolve({ token: "not-a-token" }) }
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Enlace no encontrado."
    });
  });
});
