import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/session/route";

const bookId = "fichas-matematica-1-secundaria";

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
});

describe("POST /api/session", () => {
  it("inicia y mueve una sesión sin aceptar estado pedagógico del cliente", async () => {
    const createdResponse = await POST(
      new Request("http://aimauta.test/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, page: 13, hintLevel: 3 })
      })
    );
    expect(createdResponse.status).toBe(200);
    expect(createdResponse.headers.get("Cache-Control")).toBe("no-store");
    const created = (await createdResponse.json()) as {
      token: string;
      state: { hintLevel: number; stage: string };
    };
    expect(created.state).toMatchObject({ hintLevel: 0, stage: "learn" });

    const movedResponse = await POST(
      new Request("http://aimauta.test/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          page: 21,
          sessionToken: created.token
        })
      })
    );
    expect(movedResponse.status).toBe(200);
    await expect(movedResponse.json()).resolves.toMatchObject({
      state: { page: 21, stage: "assessment", hintLevel: 0 },
      activity: { tutorAvailable: false }
    });

    const replayResponse = await POST(
      new Request("http://aimauta.test/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          page: 14,
          sessionToken: created.token
        })
      })
    );
    expect(replayResponse.status).toBe(409);
    expect(replayResponse.headers.get("Cache-Control")).toBe("no-store");
  });
});
