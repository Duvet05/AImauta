import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  issueLearningSession,
  recordLearningTurn
} from "@/lib/learning-session";
import { guideLearningTurn } from "@/lib/tutor-service";

let indexDir: string;

beforeAll(async () => {
  indexDir = await mkdtemp(path.join(tmpdir(), "aimauta-broken-index-"));
  await writeFile(
    path.join(indexDir, "fichas-matematica-1-secundaria.json"),
    "{índice roto"
  );
  process.env.AIMAUTA_INDEX_DIR = indexDir;
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
});

afterAll(async () => {
  delete process.env.AIMAUTA_INDEX_DIR;
  delete process.env.AIMAUTA_SESSION_SECRET;
  await rm(indexDir, { recursive: true, force: true });
});

describe("fallos previos a inferencia", () => {
  it("no consume la revisión si el índice RAG no puede leerse", async () => {
    const issued = issueLearningSession({
      bookId: "fichas-matematica-1-secundaria",
      page: 13
    });

    await expect(
      guideLearningTurn({
        sessionToken: issued.token,
        message: "¿Qué observo?",
        attempt: ""
      })
    ).rejects.toThrow();

    expect(
      recordLearningTurn({ token: issued.token, attempt: "" }).state
    ).toMatchObject({ revision: 1, totalTurnCount: 1 });
  });
});
