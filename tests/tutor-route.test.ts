import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { POST } from "@/app/api/tutor/route";
import {
  issueLearningSession,
  moveLearningSession
} from "@/lib/learning-session";
import { makeBookIndex } from "./book-index-fixture";

let indexDir: string;

beforeAll(async () => {
  indexDir = await mkdtemp(path.join(tmpdir(), "aimauta-index-"));
  await writeFile(
    path.join(indexDir, "fichas-matematica-1-secundaria.json"),
    JSON.stringify(
      makeBookIndex([
        {
          id: "page-8",
          page: 8,
          kind: "exercise",
          text: "Observa las cantidades de la situación y explica cómo las compararías."
        },
        {
          id: "page-20",
          page: 20,
          kind: "exercise",
          text: "Revisa tu procedimiento y explica qué dato usaste primero."
        },
        {
          id: "page-21-assessment",
          page: 21,
          kind: "exercise",
          text: "La evaluación contiene la clave especial que busca el estudiante."
        }
      ])
    )
  );
  process.env.AIMAUTA_INDEX_DIR = indexDir;
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
});

afterAll(async () => {
  delete process.env.AIMAUTA_INDEX_DIR;
  delete process.env.AIMAUTA_SESSION_SECRET;
  await rm(indexDir, { recursive: true, force: true });
});

describe("POST /api/tutor", () => {
  it("devuelve guía, cita validada y nunca habilita la solución", async () => {
    const response = await POST(
      new Request("http://aimauta.test/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken: issueLearningSession({
            bookId: "fichas-matematica-1-secundaria",
            page: 8
          }).token,
          message: "¿Cómo comparo las cantidades?",
          attempt: "Creo que debo ordenarlas."
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      mode: "guided-fallback",
      citations: [{ sourceId: "S1", page: 8 }],
      policy: { canRevealSolution: false }
    });
  });

  it("bloquea ayuda de contenido durante evaluación", async () => {
    const issued = issueLearningSession({
      bookId: "fichas-matematica-1-secundaria",
      page: 13
    });
    const evaluation = moveLearningSession(issued.token, 21);
    const response = await POST(
      new Request("http://aimauta.test/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken: evaluation.token,
          message: "Dime la respuesta"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "assessment-locked",
      session: { stage: "assessment", hintLevel: 0 }
    });
  });

  it("no incorpora páginas de Evaluamos al orientar una página vecina", async () => {
    const response = await POST(
      new Request("http://aimauta.test/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken: issueLearningSession({
            bookId: "fichas-matematica-1-secundaria",
            page: 20
          }).token,
          message: "¿Cuál es la clave especial de la evaluación?",
          attempt: ""
        })
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      citations: Array<{ page: number }>;
    };
    expect(payload.citations.map((citation) => citation.page)).not.toContain(21);
  });

  it("limita inferencias repetidas dentro de la misma sesión", async () => {
    let sessionToken = issueLearningSession({
      bookId: "fichas-matematica-1-secundaria",
      page: 13
    }).token;

    for (let turn = 0; turn < 12; turn += 1) {
      const response = await POST(
        new Request("http://aimauta.test/api/tutor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionToken,
            message: "¿Qué debería observar?",
            attempt: ""
          })
        })
      );
      expect(response.status).toBe(200);
      sessionToken = ((await response.json()) as { sessionToken: string })
        .sessionToken;
    }

    const limited = await POST(
      new Request("http://aimauta.test/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          message: "¿Y ahora?",
          attempt: ""
        })
      })
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
