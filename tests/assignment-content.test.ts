import { describe, expect, it } from "vitest";

import { parseCreateAssignmentInput } from "@/lib/assignment-content";

const now = new Date("2026-07-25T18:00:00.000Z");
const expiresAt = "2026-07-27T18:00:00.000Z";
const bookId = "fichas-matematica-1-secundaria";

describe("contrato de creación de tareas", () => {
  it("deriva del catálogo el snapshot de una página y no confía en metadatos enviados", async () => {
    const parsed = await parseCreateAssignmentInput(
      {
        kind: "PAGE",
        title: "Página de refuerzo",
        teacherId: "teacher-1",
        expiresAt,
        items: [
          {
            kind: "PAGE",
            bookId,
            page: 13,
            bookSha256: "falso",
            curriculumVersion: "falsa",
            title: "Título inyectado"
          }
        ]
      },
      now
    );

    expect(parsed).toMatchObject({
      kind: "PAGE",
      requiredItemCount: 1,
      minimumTurnsPerItem: 0,
      maxHintLevel: 3
    });
    expect(parsed.items[0]).toMatchObject({
      position: 0,
      kind: "PAGE",
      bookId,
      pages: [13],
      unitId: "ficha-1-fracciones"
    });
    expect(parsed.items[0].bookSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.items[0].curriculumVersion).not.toBe("falsa");
    expect(parsed.items[0].title).not.toBe("Título inyectado");
  });

  it("rechaza formas incompatibles, duplicados y vencimientos inseguros", async () => {
    await expect(
      parseCreateAssignmentInput(
        {
          kind: "EXERCISE",
          title: "Forma incorrecta",
          teacherId: "teacher-1",
          expiresAt,
          items: [{ kind: "PAGE", bookId, page: 13 }]
        },
        now
      )
    ).rejects.toThrow(/no coincide/);

    await expect(
      parseCreateAssignmentInput(
        {
          kind: "TASK",
          title: "Repetida",
          teacherId: "teacher-1",
          expiresAt,
          items: [
            { kind: "PAGE", bookId, page: 13 },
            { kind: "PAGE", bookId, page: 13 }
          ]
        },
        now
      )
    ).rejects.toThrow(/repetidos/);

    await expect(
      parseCreateAssignmentInput(
        {
          kind: "PAGE",
          title: "Vencida",
          teacherId: "teacher-1",
          expiresAt: now.toISOString(),
          items: [{ kind: "PAGE", bookId, page: 13 }]
        },
        now
      )
    ).rejects.toThrow(/futuro/);
  });
});
