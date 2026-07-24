import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/livekit/token/route";
import {
  issueLearningSession,
  moveLearningSession
} from "@/lib/learning-session";

const bookId = "fichas-matematica-1-secundaria";

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
});

function request(sessionToken: string): Request {
  return new Request("http://aimauta.test/api/livekit/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken })
  });
}

describe("POST /api/livekit/token", () => {
  it("indica claramente cuando LiveKit aún no está configurado", async () => {
    const session = issueLearningSession({ bookId, page: 13 });
    const response = await POST(request(session.token));
    expect(response.status).toBe(503);
  });

  it("trata una URL LiveKit inválida como configuración, no como upstream", async () => {
    process.env.LIVEKIT_URL = "no-es-una-url";
    process.env.LIVEKIT_API_URL = "tampoco";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret";
    try {
      const session = issueLearningSession({ bookId, page: 13 });
      const response = await POST(request(session.token));
      expect(response.status).toBe(503);
    } finally {
      delete process.env.LIVEKIT_URL;
      delete process.env.LIVEKIT_API_URL;
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
    }
  });

  it("no emite voz durante Evaluamos aunque LiveKit falte", async () => {
    const session = issueLearningSession({ bookId, page: 13 });
    const evaluation = moveLearningSession(session.token, 21);
    const response = await POST(request(evaluation.token));
    expect(response.status).toBe(423);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
