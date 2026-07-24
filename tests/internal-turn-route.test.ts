import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { POST } from "@/app/api/internal/turn/route";
import { issueLearningSession } from "@/lib/learning-session";

let indexDir: string;
const agentSecret = "test-agent-secret-with-more-than-thirty-two-characters";

beforeAll(async () => {
  indexDir = await mkdtemp(path.join(tmpdir(), "aimauta-internal-index-"));
  await writeFile(
    path.join(indexDir, "fichas-matematica-1-secundaria.json"),
    JSON.stringify({
      version: 1,
      bookId: "fichas-matematica-1-secundaria",
      sourceSha256: "test",
      chunks: [
        {
          id: "page-13",
          page: 13,
          kind: "exercise",
          text: "Compara las fracciones y explica qué dato observas primero."
        }
      ]
    })
  );
  process.env.AIMAUTA_INDEX_DIR = indexDir;
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
  process.env.AIMAUTA_AGENT_SECRET = agentSecret;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
});

afterAll(async () => {
  delete process.env.AIMAUTA_INDEX_DIR;
  delete process.env.AIMAUTA_SESSION_SECRET;
  delete process.env.AIMAUTA_AGENT_SECRET;
  await rm(indexDir, { recursive: true, force: true });
});

describe("POST /api/internal/turn", () => {
  it("rechaza al worker sin secreto", async () => {
    const response = await POST(
      new Request("http://aimauta.test/api/internal/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      })
    );
    expect(response.status).toBe(401);
  });

  it("reutiliza el mismo tutor para el canal de voz", async () => {
    const session = issueLearningSession({
      bookId: "fichas-matematica-1-secundaria",
      page: 13
    });
    const response = await POST(
      new Request("http://aimauta.test/api/internal/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agentSecret}`
        },
        body: JSON.stringify({
          sessionToken: session.token,
          message: "Creo que debo comparar los denominadores."
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      mode: "guided-fallback",
      session: { attemptCount: 0, turnCount: 1 },
      citations: [{ sourceId: "S1", page: 13 }]
    });
  });
});
