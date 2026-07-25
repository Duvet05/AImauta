import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/livekit/token/route";
import {
  issueLearningSession,
  moveLearningSession
} from "@/lib/learning-session";

const bookId = "fichas-matematica-1-secundaria";
const exercise = {
  id: "ejercicio-voz",
  revision: 1,
  unitId: "ficha-1-fracciones",
  stage: "learn" as const,
  pages: [13]
};

function issueExerciseSession() {
  return issueLearningSession({
    bookId,
    page: 13,
    exercise
  });
}

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
  process.env.AIMAUTA_VOICE_TUTOR_ENABLED = "true";
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
  delete process.env.AIMAUTA_VOICE_TUTOR_ENABLED;
});

function request(sessionToken: string): Request {
  return new Request("http://aimauta.test/api/livekit/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken })
  });
}

describe("POST /api/livekit/token", () => {
  it("no emite acceso cuando el tutor por voz está oculto", async () => {
    delete process.env.AIMAUTA_VOICE_TUTOR_ENABLED;
    try {
      const session = issueLearningSession({ bookId, page: 13 });
      const response = await POST(request(session.token));
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      process.env.AIMAUTA_VOICE_TUTOR_ENABLED = "true";
    }
  });

  it("indica claramente cuando LiveKit aún no está configurado", async () => {
    const session = issueExerciseSession();
    const response = await POST(request(session.token));
    expect(response.status).toBe(503);
  });

  it("trata una URL LiveKit inválida como configuración, no como upstream", async () => {
    process.env.LIVEKIT_URL = "no-es-una-url";
    process.env.LIVEKIT_API_URL = "tampoco";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret";
    try {
      const session = issueExerciseSession();
      const response = await POST(request(session.token));
      expect(response.status).toBe(503);
    } finally {
      delete process.env.LIVEKIT_URL;
      delete process.env.LIVEKIT_API_URL;
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
    }
  });

  it("rechaza LiveKit remoto sin TLS o con hosts Cloud distintos", async () => {
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret";
    const session = issueExerciseSession();
    try {
      process.env.LIVEKIT_URL = "ws://livekit.example.test";
      process.env.LIVEKIT_API_URL = "http://livekit.example.test";
      expect((await POST(request(session.token))).status).toBe(503);

      process.env.LIVEKIT_URL = "wss://livekit.example.test";
      process.env.LIVEKIT_API_URL = "https://other.example.test";
      expect((await POST(request(session.token))).status).toBe(503);
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
