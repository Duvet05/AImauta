import { describe, expect, it } from "vitest";

import { getBook } from "@/lib/catalog";
import { getBookUnits, getPageActivity } from "@/lib/curriculum";

const bookId = "fichas-matematica-1-secundaria";
const secondBookId = "fichas-matematica-2-secundaria";

describe("currículo por página", () => {
  it("modela las ocho fichas del libro", () => {
    expect(getBookUnits(bookId)).toHaveLength(8);
    expect(getBookUnits(secondBookId)).toHaveLength(8);
  });

  it.each([
    [13, "learn", "ficha-1-fracciones"],
    [17, "practice", "ficha-1-fracciones"],
    [21, "assessment", "ficha-1-fracciones"],
    [65, "learn", "ficha-6-inecuaciones"],
    [95, "assessment", "ficha-8-probabilidad"]
  ])("clasifica página %i como %s", (page, stage, unitId) => {
    expect(getPageActivity(bookId, page)).toMatchObject({
      stage,
      unitId
    });
  });

  it("bloquea el tutor durante Evaluamos", () => {
    expect(getPageActivity(bookId, 52).tutorAvailable).toBe(false);
    expect(getPageActivity(bookId, 49).tutorAvailable).toBe(true);
  });

  it("clasifica todas las páginas del material ready", () => {
    for (const candidateBookId of [bookId, secondBookId]) {
      const book = getBook(candidateBookId);
      expect(book).toBeDefined();

      for (let page = 1; page <= (book?.pages ?? 0); page += 1) {
        expect(
          getPageActivity(candidateBookId, page).unitTitle,
          `${candidateBookId}, página ${page}`
        ).not.toBe("Contenido no disponible");
      }
    }
  });

  it.each([
    [secondBookId, 13, "learn", "ficha-1-comparacion-fracciones"],
    [secondBookId, 27, "practice", "ficha-2-funciones-lineales"],
    [secondBookId, 31, "assessment", "ficha-2-funciones-lineales"],
    [secondBookId, 48, "practice", "ficha-4-decision-estadistica"],
    [secondBookId, 84, "assessment", "ficha-7-mapas"]
  ])(
    "clasifica %s página %i como %s",
    (candidateBookId, page, stage, unitId) => {
      expect(getPageActivity(candidateBookId, page)).toMatchObject({
        stage,
        unitId
      });
    }
  );

  it.each([
    ["libro-inexistente", 1],
    [bookId, 0],
    [bookId, 101],
    [bookId, 1.5]
  ])(
    "falla cerrado para libro %s y página %s",
    (candidateBookId, page) => {
      expect(getPageActivity(candidateBookId, page)).toMatchObject({
        stage: "assessment",
        stageLabel: "No disponible",
        tutorAvailable: false
      });
    }
  );

  it("no expone unidades de libros desconocidos", () => {
    expect(getBookUnits("libro-inexistente")).toEqual([]);
  });
});
