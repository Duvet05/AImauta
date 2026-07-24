import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { POST } from "@/app/api/tutor/route";

let indexDir: string;

beforeAll(async () => {
  indexDir = await mkdtemp(path.join(tmpdir(), "aimauta-index-"));
  await writeFile(
    path.join(indexDir, "fichas-matematica-1-secundaria.json"),
    JSON.stringify({
      version: 1,
      bookId: "fichas-matematica-1-secundaria",
      sourceSha256: "test",
      chunks: [
        {
          id: "page-8",
          page: 8,
          kind: "exercise",
          text: "Observa las cantidades de la situación y explica cómo las compararías."
        }
      ]
    })
  );
  process.env.AIMAUTA_INDEX_DIR = indexDir;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
});

afterAll(async () => {
  delete process.env.AIMAUTA_INDEX_DIR;
  await rm(indexDir, { recursive: true, force: true });
});

describe("POST /api/tutor", () => {
  it("devuelve guía, cita validada y nunca habilita la solución", async () => {
    const response = await POST(
      new Request("http://aimauta.test/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: "fichas-matematica-1-secundaria",
          page: 8,
          message: "¿Cómo comparo las cantidades?",
          attempt: "Creo que debo ordenarlas.",
          history: []
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "guided-fallback",
      citations: [{ sourceId: "S1", page: 8 }],
      policy: { canRevealSolution: false }
    });
  });

  it("rechaza páginas que no pertenecen al libro", async () => {
    const response = await POST(
      new Request("http://aimauta.test/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: "fichas-matematica-1-secundaria",
          page: 101,
          message: "Ayúdame"
        })
      })
    );

    expect(response.status).toBe(400);
  });
});
