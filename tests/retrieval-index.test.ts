import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  BookIndexError,
  retrieveEvidence,
  retrieveExerciseEvidence
} from "@/lib/retrieval";
import type { PublicExercise } from "@/lib/exercise-manifest";
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
  it("no abre el índice RAG en páginas de orientación", async () => {
    await publishIndex({
      version: 1,
      bookId,
      sourceSha256: "legacy",
      chunks: []
    });

    await expect(
      retrieveEvidence({
        bookId,
        page: 1,
        question: "¿Qué hago aquí?",
        attempt: ""
      })
    ).resolves.toEqual([]);
  });

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

  it("vincula el ejercicio multipágina sólo a fragmentos reales y anclados", async () => {
    await publishIndex(
      makeBookIndex([
        {
          id: "real-page-13",
          page: 13,
          text: "Compara ambas fracciones y explica tu estrategia con los datos de la situación."
        },
        {
          id: "unrelated-page-13",
          page: 13,
          text: "Calcula el perímetro de un cuadrado diferente."
        },
        {
          id: "teacher-page-13",
          page: 13,
          text: "Compara ambas fracciones. La respuesta final es tres cuartos.",
          teacherOnly: true
        },
        {
          id: "real-page-14",
          page: 14,
          text: "Explica tu estrategia para comparar las fracciones representadas."
        },
        {
          id: "outside-exercise",
          page: 15,
          text: "Compara ambas fracciones y explica tu estrategia."
        }
      ])
    );
    const exercise: PublicExercise = {
      id: "ejercicio-fracciones",
      status: "published",
      unitId: "ficha-1-fracciones",
      stage: "learn",
      revision: 4,
      label: "Problema 1",
      title: "Compara fracciones",
      prompt: "Compara ambas fracciones y explica tu estrategia.",
      regions: [
        {
          id: "ejercicio-fracciones-contexto",
          page: 13,
          role: "context",
          order: 1,
          rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }
        },
        {
          id: "ejercicio-fracciones-pregunta",
          page: 14,
          role: "prompt",
          order: 2,
          rect: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 }
        }
      ]
    };

    const evidence = await retrieveExerciseEvidence({
      bookId,
      exercise,
      page: 13,
      question: "¿Cómo empiezo?",
      attempt: ""
    });

    expect(evidence.map((item) => item.id)).toEqual([
      "real-page-13",
      "real-page-14"
    ]);
    expect(
      evidence.map(({ exerciseId, page, sourceId }) => ({
        exerciseId,
        page,
        sourceId
      }))
    ).toEqual([
      { exerciseId: exercise.id, page: 13, sourceId: "S1" },
      { exerciseId: exercise.id, page: 14, sourceId: "S2" }
    ]);
    expect(evidence.map((item) => item.id)).not.toContain(
      "teacher-page-13"
    );
    expect(evidence.map((item) => item.id)).not.toContain(
      "unrelated-page-13"
    );
    expect(evidence.map((item) => item.id)).not.toContain(
      "outside-exercise"
    );
  });

  it("falla cerrado cuando el índice no contiene un ancla del ejercicio", async () => {
    await publishIndex(
      makeBookIndex([
        {
          id: "otro-ejercicio",
          page: 13,
          text: "Calcula el perímetro de un cuadrado diferente."
        }
      ])
    );
    const exercise: PublicExercise = {
      id: "ejercicio-fracciones",
      status: "published",
      unitId: "ficha-1-fracciones",
      stage: "learn",
      revision: 4,
      label: "Problema 1",
      title: "Compara fracciones",
      prompt: "Compara ambas fracciones y explica tu estrategia.",
      regions: [
        {
          id: "ejercicio-fracciones-pregunta",
          page: 13,
          role: "prompt",
          order: 1,
          rect: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 }
        }
      ]
    };

    await expect(
      retrieveExerciseEvidence({
        bookId,
        exercise,
        page: 13,
        question: "¿Cómo empiezo?",
        attempt: ""
      })
    ).resolves.toEqual([]);
  });

  it("no liga un ejercicio vecino por sólo dos palabras coincidentes", async () => {
    await publishIndex(
      makeBookIndex([
        {
          id: "ejercicio-vecino",
          page: 13,
          text: "Compara los lados y explica el perímetro del cuadrado."
        }
      ])
    );
    const exercise: PublicExercise = {
      id: "ejercicio-fracciones",
      status: "published",
      unitId: "ficha-1-fracciones",
      stage: "learn",
      revision: 4,
      label: "Problema 1",
      title: "Compara fracciones",
      prompt: "Compara ambas fracciones y explica tu estrategia.",
      regions: [
        {
          id: "ejercicio-fracciones-pregunta",
          page: 13,
          role: "prompt",
          order: 1,
          rect: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 }
        }
      ]
    };

    await expect(
      retrieveExerciseEvidence({
        bookId,
        exercise,
        page: 13,
        question: "¿Cómo empiezo?",
        attempt: ""
      })
    ).resolves.toEqual([]);
  });

  it("no abre el índice para un ejercicio ligado a una página de evaluación", async () => {
    await publishIndex({
      version: 1,
      bookId,
      sourceSha256: "legacy",
      chunks: []
    });
    const invalidAssessmentExercise: PublicExercise = {
      id: "evaluacion-invalida",
      status: "published",
      unitId: "ficha-1-fracciones",
      stage: "learn",
      revision: 1,
      label: "Evaluamos",
      title: "Evaluación",
      prompt: "Resuelve la evaluación.",
      regions: [
        {
          id: "evaluacion-invalida-pregunta",
          page: 21,
          role: "prompt",
          order: 1,
          rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }
        }
      ]
    };

    await expect(
      retrieveExerciseEvidence({
        bookId,
        exercise: invalidAssessmentExercise,
        page: 21,
        question: "¿Cuál es la respuesta?",
        attempt: ""
      })
    ).resolves.toEqual([]);
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
