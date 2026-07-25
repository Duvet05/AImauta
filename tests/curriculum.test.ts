import { describe, expect, it } from "vitest";

import { getBook } from "@/lib/catalog";
import {
  getBookCurriculum,
  getBookUnits,
  getFirstTutorablePage,
  getPageActivity,
  isCurriculumStructureSafe
} from "@/lib/curriculum";

const bookId = "fichas-matematica-1-secundaria";
const secondBookId = "fichas-matematica-2-secundaria";
const reviewCurriculumExpectations = [
  {
    bookId: "fichas-matematica-3-secundaria",
    titles: [
      "Conocemos el planeta Marte",
      "El juego de ajedrez",
      "Ordenamos la habitación",
      "Elegimos a las mejores atletas",
      "Organizamos la campaña navideña",
      "Las líneas aéreas y sus condiciones de viaje",
      "¿Hay figuras iguales o parecidas?",
      "Una visita al museo"
    ],
    ranges: [
      [13, 22, 13, 16, 17, 20, 21, 22],
      [23, 32, 23, 26, 27, 30, 31, 32],
      [33, 42, 33, 36, 37, 39, 40, 42],
      [43, 54, 43, 46, 47, 50, 51, 54],
      [55, 64, 55, 58, 59, 62, 63, 64],
      [65, 74, 65, 68, 69, 71, 72, 74],
      [75, 86, 75, 78, 79, 82, 83, 86],
      [87, 100, 87, 89, 90, 94, 95, 100]
    ]
  },
  {
    bookId: "fichas-matematica-4-secundaria",
    titles: [
      "Conozcamos más sobre la presión arterial",
      "Entradas al teatro",
      "Las áreas verdes mejoran nuestra vida",
      "Evaluamos la atención al cliente",
      "Elección de un crédito hipotecario",
      "Mi emprendimiento en la venta de chocolates",
      "Mandalas para pensar creativamente",
      "Tomamos decisiones"
    ],
    ranges: [
      [13, 22, 13, 16, 17, 19, 20, 22],
      [23, 32, 23, 26, 27, 29, 30, 32],
      [33, 42, 33, 36, 37, 39, 40, 42],
      [43, 54, 43, 46, 47, 51, 52, 54],
      [55, 64, 55, 59, 60, 62, 63, 64],
      [65, 74, 65, 67, 68, 71, 72, 74],
      [75, 84, 75, 77, 78, 80, 81, 84],
      [85, 100, 85, 89, 90, 94, 95, 100]
    ]
  },
  {
    bookId: "fichas-matematica-5-secundaria",
    titles: [
      "Evaluamos las grandes ofertas",
      "Abastecemos con gas natural a los vehículos en el Perú",
      "Fabricamos elementos de seguridad para la señalización vial",
      "Analizamos los resultados de una prueba de Matemática",
      "Analizamos la compra de un departamento",
      "Construimos canaletas de máximo volumen",
      "Evaluamos la construcción de una rampa",
      "Aplicamos la probabilidad en la investigación médica"
    ],
    ranges: [
      [13, 22, 13, 16, 17, 20, 21, 22],
      [23, 32, 23, 26, 27, 30, 31, 32],
      [33, 42, 33, 36, 37, 40, 41, 42],
      [43, 52, 43, 46, 47, 50, 51, 52],
      [53, 62, 53, 56, 57, 60, 61, 62],
      [63, 74, 63, 67, 68, 72, 73, 74],
      [75, 85, 75, 79, 80, 83, 84, 85],
      [86, 100, 86, 90, 91, 94, 95, 100]
    ]
  }
] as const;
const reviewBookIds = reviewCurriculumExpectations.map(
  ({ bookId: candidateBookId }) => candidateBookId
);
const expectedCompetencies = [
  "Resuelve problemas de cantidad",
  "Resuelve problemas de regularidad, equivalencia y cambio",
  "Resuelve problemas de forma, movimiento y localización",
  "Resuelve problemas de gestión de datos e incertidumbre",
  "Resuelve problemas de cantidad",
  "Resuelve problemas de regularidad, equivalencia y cambio",
  "Resuelve problemas de forma, movimiento y localización",
  "Resuelve problemas de gestión de datos e incertidumbre"
];

describe("currículo por página", () => {
  it("modela las ocho fichas del libro", () => {
    expect(getBookUnits(bookId)).toHaveLength(8);
    expect(getBookUnits(secondBookId)).toHaveLength(8);
  });

  it("deriva la página inicial de la primera sección learn segura", () => {
    for (const candidateBookId of [bookId, secondBookId]) {
      const firstLearnSection = getBookUnits(candidateBookId)
        .flatMap((unit) => unit.sections)
        .find((section) => section.stage === "learn");

      expect(getFirstTutorablePage(candidateBookId)).toBe(
        firstLearnSection?.startPage
      );
    }
    expect(getFirstTutorablePage("libro-inexistente")).toBeUndefined();
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

  it("mantiene orientación sin tutor aunque esté clasificada", () => {
    expect(getPageActivity(bookId, 1)).toMatchObject({
      stage: "orientation",
      tutorAvailable: false
    });
    expect(getPageActivity(secondBookId, 12)).toMatchObject({
      stage: "orientation",
      tutorAvailable: false
    });
  });

  it("clasifica todas las páginas del material published", () => {
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

  it.each(reviewCurriculumExpectations)(
    "valida la estructura y cobertura exactas de $bookId",
    ({ bookId: reviewBookId, ranges, titles }) => {
      const curriculum = getBookCurriculum(reviewBookId);

      expect(curriculum).toBeDefined();
      expect(isCurriculumStructureSafe(curriculum, 100)).toBe(true);
      expect(curriculum?.orientation).toEqual({
        title: "Preliminares y estrategias de resolución",
        startPage: 1,
        endPage: 12
      });
      expect(curriculum?.units.map((unit) => unit.title)).toEqual(titles);
      expect(curriculum?.units.map((unit) => unit.competency)).toEqual(
        expectedCompetencies
      );
      expect(
        curriculum?.units.map((unit) => [
          unit.startPage,
          unit.endPage,
          ...unit.sections.flatMap((section) => [
            section.startPage,
            section.endPage
          ])
        ])
      ).toEqual(ranges);

      const coveredPages = [
        ...Array.from({ length: 12 }, (_, index) => index + 1),
        ...(curriculum?.units.flatMap((unit) =>
          unit.sections.flatMap((section) =>
            Array.from(
              { length: section.endPage - section.startPage + 1 },
              (_, index) => section.startPage + index
            )
          )
        ) ?? [])
      ];
      expect(coveredPages).toEqual(
        Array.from({ length: 100 }, (_, index) => index + 1)
      );
    }
  );

  it.each(reviewBookIds)(
    "mantiene %s fuera del catálogo y currículo públicos durante review",
    (reviewBookId) => {
      expect(getBook(reviewBookId)).toBeUndefined();
      expect(getBookUnits(reviewBookId)).toEqual([]);
      expect(getFirstTutorablePage(reviewBookId)).toBeUndefined();
      expect(getPageActivity(reviewBookId, 13)).toMatchObject({
        stage: "assessment",
        stageLabel: "No disponible",
        tutorAvailable: false
      });
    }
  );

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
