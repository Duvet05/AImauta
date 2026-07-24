import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  BookIndexError,
  retrieveEvidence
} from "@/lib/retrieval";
import { makeBookIndex } from "./book-index-fixture";

const bookId = "fichas-matematica-1-secundaria";
const createdDirectories: string[] = [];

async function publishIndex(value: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "aimauta-index-v2-"));
  createdDirectories.push(directory);
  await writeFile(
    path.join(directory, `${bookId}.json`),
    JSON.stringify(value)
  );
  process.env.AIMAUTA_INDEX_DIR = directory;
  return directory;
}

afterEach(async () => {
  delete process.env.AIMAUTA_INDEX_DIR;
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("contrato del índice RAG v2", () => {
  it("usa el intento del estudiante para ordenar la evidencia", async () => {
    await publishIndex(
      makeBookIndex([
        {
          id: "generic",
          page: 13,
          text: "Observa la situación y describe qué se solicita."
        },
        {
          id: "attempt-match",
          page: 13,
          text: "Compara las fracciones buscando un denominador común."
        }
      ])
    );

    const evidence = await retrieveEvidence({
      bookId,
      page: 13,
      question: "Necesito una pista",
      attempt: "Busqué un denominador común"
    });

    expect(evidence[0]).toMatchObject({
      id: "attempt-match",
      sourceId: "S1"
    });
  });

  it("rechaza de forma cerrada un índice v1", async () => {
    await publishIndex({
      version: 1,
      bookId,
      sourceSha256: "legacy",
      chunks: []
    });

    await expect(
      retrieveEvidence({
        bookId,
        page: 13,
        question: "¿Qué observo?",
        attempt: ""
      })
    ).rejects.toThrow(/versión 2/u);
  });

  it("rechaza un checksum distinto al catálogo", async () => {
    await publishIndex(
      makeBookIndex([], {
        sourceSha256: "0".repeat(64)
      })
    );

    await expect(
      retrieveEvidence({
        bookId,
        page: 13,
        question: "¿Qué observo?",
        attempt: ""
      })
    ).rejects.toBeInstanceOf(BookIndexError);
  });

  it("rechaza páginas fuera del total publicado", async () => {
    const invalidPage = makeBookIndex([
      {
        id: "outside-pdf",
        page: 101,
        text: "Contenido fuera del material.",
        stage: "learn",
        unitId: "ficha-1-fracciones"
      }
    ]);
    await publishIndex(invalidPage);

    await expect(
      retrieveEvidence({
        bookId,
        page: 13,
        question: "¿Qué observo?",
        attempt: ""
      })
    ).rejects.toThrow(/página fuera del PDF/u);
  });

  it("rechaza etapas o unidades distintas al currículo publicado", async () => {
    await publishIndex(
      makeBookIndex([
        {
          id: "wrong-stage",
          page: 13,
          text: "Contenido con una etapa manipulada.",
          stage: "practice"
        }
      ])
    );

    await expect(
      retrieveEvidence({
        bookId,
        page: 13,
        question: "¿Qué observo?",
        attempt: ""
      })
    ).rejects.toThrow(/etapa o unidad/u);
  });

  it("invalida la caché cuando cambia mtime o tamaño", async () => {
    const directory = await publishIndex(
      makeBookIndex([
        {
          id: "first",
          page: 13,
          text: "Primera evidencia breve sobre fracciones."
        }
      ])
    );

    const first = await retrieveEvidence({
      bookId,
      page: 13,
      question: "primera evidencia",
      attempt: ""
    });
    expect(first[0]?.id).toBe("first");

    await writeFile(
      path.join(directory, `${bookId}.json`),
      JSON.stringify(
        makeBookIndex([
          {
            id: "second",
            page: 13,
            text: "Segunda evidencia actualizada y deliberadamente más extensa sobre fracciones."
          }
        ])
      )
    );

    const second = await retrieveEvidence({
      bookId,
      page: 13,
      question: "segunda evidencia actualizada",
      attempt: ""
    });
    expect(second[0]?.id).toBe("second");
  });
});
