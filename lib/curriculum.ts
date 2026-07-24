import { getBook } from "@/lib/catalog";

export type LearningStage =
  | "orientation"
  | "learn"
  | "practice"
  | "assessment";

export type PageRange = {
  startPage: number;
  endPage: number;
};

export type OrientationSection = PageRange & {
  title: string;
};

export type UnitSection = PageRange & {
  stage: Exclude<LearningStage, "orientation">;
};

export type BookUnit = PageRange & {
  id: string;
  number: number;
  title: string;
  competency: string;
  sections: readonly UnitSection[];
};

export type BookCurriculum = {
  bookId: string;
  version: string;
  orientation: OrientationSection;
  units: readonly BookUnit[];
};

const orderedUnitStages: readonly UnitSection["stage"][] = [
  "learn",
  "practice",
  "assessment"
];

export type PageActivity = {
  unitId: string | null;
  unitNumber: number | null;
  unitTitle: string;
  competency: string | null;
  stage: LearningStage;
  stageLabel: string;
  startPage: number;
  endPage: number;
  tutorAvailable: boolean;
};

const mathematicsOneUnits: readonly BookUnit[] = [
  {
    id: "ficha-1-fracciones",
    number: 1,
    title: "Operaciones con fracciones",
    competency: "Resuelve problemas de cantidad",
    startPage: 13,
    endPage: 22,
    sections: [
      { stage: "learn", startPage: 13, endPage: 16 },
      { stage: "practice", startPage: 17, endPage: 20 },
      { stage: "assessment", startPage: 21, endPage: 22 }
    ]
  },
  {
    id: "ficha-2-proporcionalidad",
    number: 2,
    title: "Proporcionalidad en situaciones cotidianas",
    competency: "Resuelve problemas de regularidad, equivalencia y cambio",
    startPage: 23,
    endPage: 32,
    sections: [
      { stage: "learn", startPage: 23, endPage: 26 },
      { stage: "practice", startPage: 27, endPage: 29 },
      { stage: "assessment", startPage: 30, endPage: 32 }
    ]
  },
  {
    id: "ficha-3-escalas",
    number: 3,
    title: "Mapas, escalas y desplazamientos",
    competency: "Resuelve problemas de forma, movimiento y localización",
    startPage: 33,
    endPage: 44,
    sections: [
      { stage: "learn", startPage: 33, endPage: 36 },
      { stage: "practice", startPage: 37, endPage: 40 },
      { stage: "assessment", startPage: 41, endPage: 44 }
    ]
  },
  {
    id: "ficha-4-estadistica",
    number: 4,
    title: "Medidas de tendencia central",
    competency: "Resuelve problemas de gestión de datos e incertidumbre",
    startPage: 45,
    endPage: 54,
    sections: [
      { stage: "learn", startPage: 45, endPage: 48 },
      { stage: "practice", startPage: 49, endPage: 51 },
      { stage: "assessment", startPage: 52, endPage: 54 }
    ]
  },
  {
    id: "ficha-5-enteros",
    number: 5,
    title: "Números enteros en situaciones reales",
    competency: "Resuelve problemas de cantidad",
    startPage: 55,
    endPage: 64,
    sections: [
      { stage: "learn", startPage: 55, endPage: 58 },
      { stage: "practice", startPage: 59, endPage: 62 },
      { stage: "assessment", startPage: 63, endPage: 64 }
    ]
  },
  {
    id: "ficha-6-inecuaciones",
    number: 6,
    title: "Inecuaciones y límites de velocidad",
    competency: "Resuelve problemas de regularidad, equivalencia y cambio",
    startPage: 65,
    endPage: 74,
    sections: [
      { stage: "learn", startPage: 65, endPage: 68 },
      { stage: "practice", startPage: 69, endPage: 72 },
      { stage: "assessment", startPage: 73, endPage: 74 }
    ]
  },
  {
    id: "ficha-7-cuadrilateros",
    number: 7,
    title: "Cuadriláteros con el mecano",
    competency: "Resuelve problemas de forma, movimiento y localización",
    startPage: 75,
    endPage: 86,
    sections: [
      { stage: "learn", startPage: 75, endPage: 78 },
      { stage: "practice", startPage: 79, endPage: 81 },
      { stage: "assessment", startPage: 82, endPage: 86 }
    ]
  },
  {
    id: "ficha-8-probabilidad",
    number: 8,
    title: "Probabilidad en promociones comerciales",
    competency: "Resuelve problemas de gestión de datos e incertidumbre",
    startPage: 87,
    endPage: 100,
    sections: [
      { stage: "learn", startPage: 87, endPage: 90 },
      { stage: "practice", startPage: 91, endPage: 94 },
      { stage: "assessment", startPage: 95, endPage: 100 }
    ]
  }
];

const mathematicsTwoUnits: readonly BookUnit[] = [
  {
    id: "ficha-1-comparacion-fracciones",
    number: 1,
    title: "Orden y comparación de fracciones",
    competency: "Resuelve problemas de cantidad",
    startPage: 13,
    endPage: 22,
    sections: [
      { stage: "learn", startPage: 13, endPage: 16 },
      { stage: "practice", startPage: 17, endPage: 20 },
      { stage: "assessment", startPage: 21, endPage: 22 }
    ]
  },
  {
    id: "ficha-2-funciones-lineales",
    number: 2,
    title: "Funciones lineales en la vida cotidiana",
    competency: "Resuelve problemas de regularidad, equivalencia y cambio",
    startPage: 23,
    endPage: 32,
    sections: [
      { stage: "learn", startPage: 23, endPage: 26 },
      { stage: "practice", startPage: 27, endPage: 30 },
      { stage: "assessment", startPage: 31, endPage: 32 }
    ]
  },
  {
    id: "ficha-3-transformaciones",
    number: 3,
    title: "Transformaciones en el plano cartesiano",
    competency: "Resuelve problemas de forma, movimiento y localización",
    startPage: 33,
    endPage: 44,
    sections: [
      { stage: "learn", startPage: 33, endPage: 35 },
      { stage: "practice", startPage: 36, endPage: 40 },
      { stage: "assessment", startPage: 41, endPage: 44 }
    ]
  },
  {
    id: "ficha-4-decision-estadistica",
    number: 4,
    title: "Información estadística para tomar decisiones",
    competency: "Resuelve problemas de gestión de datos e incertidumbre",
    startPage: 45,
    endPage: 56,
    sections: [
      { stage: "learn", startPage: 45, endPage: 47 },
      { stage: "practice", startPage: 48, endPage: 52 },
      { stage: "assessment", startPage: 53, endPage: 56 }
    ]
  },
  {
    id: "ficha-5-porcentajes",
    number: 5,
    title: "Porcentajes en la vida cotidiana",
    competency: "Resuelve problemas de cantidad",
    startPage: 57,
    endPage: 66,
    sections: [
      { stage: "learn", startPage: 57, endPage: 59 },
      { stage: "practice", startPage: 60, endPage: 64 },
      { stage: "assessment", startPage: 65, endPage: 66 }
    ]
  },
  {
    id: "ficha-6-progresiones",
    number: 6,
    title: "Progresiones aritméticas",
    competency: "Resuelve problemas de regularidad, equivalencia y cambio",
    startPage: 67,
    endPage: 76,
    sections: [
      { stage: "learn", startPage: 67, endPage: 70 },
      { stage: "practice", startPage: 71, endPage: 74 },
      { stage: "assessment", startPage: 75, endPage: 76 }
    ]
  },
  {
    id: "ficha-7-mapas",
    number: 7,
    title: "Ubicación y escalas en mapas",
    competency: "Resuelve problemas de forma, movimiento y localización",
    startPage: 77,
    endPage: 86,
    sections: [
      { stage: "learn", startPage: 77, endPage: 79 },
      { stage: "practice", startPage: 80, endPage: 83 },
      { stage: "assessment", startPage: 84, endPage: 86 }
    ]
  },
  {
    id: "ficha-8-probabilidad",
    number: 8,
    title: "Probabilidad para tomar decisiones",
    competency: "Resuelve problemas de gestión de datos e incertidumbre",
    startPage: 87,
    endPage: 100,
    sections: [
      { stage: "learn", startPage: 87, endPage: 90 },
      { stage: "practice", startPage: 91, endPage: 94 },
      { stage: "assessment", startPage: 95, endPage: 100 }
    ]
  }
];

const curriculumEntries: readonly BookCurriculum[] = [
  {
    bookId: "fichas-matematica-1-secundaria",
    version: "2024.1",
    orientation: {
      title: "Orientación y estrategias",
      startPage: 1,
      endPage: 12
    },
    units: mathematicsOneUnits
  },
  {
    bookId: "fichas-matematica-2-secundaria",
    version: "2024.1",
    orientation: {
      title: "Orientación y estrategias",
      startPage: 1,
      endPage: 12
    },
    units: mathematicsTwoUnits
  }
];

const curriculaByBook: ReadonlyMap<string, readonly BookCurriculum[]> =
  curriculumEntries.reduce<Map<string, BookCurriculum[]>>(
    (entries, curriculum) => {
      const matching = entries.get(curriculum.bookId) ?? [];
      matching.push(curriculum);
      entries.set(curriculum.bookId, matching);
      return entries;
    },
    new Map()
  );

const stageLabels: Readonly<Record<LearningStage, string>> = {
  orientation: "Explora",
  learn: "Construimos",
  practice: "Comprobamos",
  assessment: "Evaluamos"
};

function unavailableActivity(page: number): PageActivity {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  return {
    unitId: null,
    unitNumber: null,
    unitTitle: "Contenido no disponible",
    competency: null,
    // Assessment is the existing fail-closed stage: all downstream tutor and
    // retrieval checks already deny assistance for it.
    stage: "assessment",
    stageLabel: "No disponible",
    startPage: safePage,
    endPage: safePage,
    tutorAvailable: false
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validPageRange<T extends PageRange>(
  range: T | null | undefined,
  pages: number
): range is T {
  return (
    range !== null &&
    range !== undefined &&
    Number.isInteger(range.startPage) &&
    Number.isInteger(range.endPage) &&
    range.startPage >= 1 &&
    range.startPage <= range.endPage &&
    range.endPage <= pages
  );
}

/**
 * Runtime safety boundary for curricular classification.
 *
 * The build validator reports detailed authoring errors, but requests must
 * still fail closed if a malformed curriculum reaches a running process. A
 * safe curriculum has an initial orientation followed by one or more ordered
 * units, and every unit has exactly learn → practice → assessment with
 * continuous, non-overlapping page ranges.
 */
export function isCurriculumStructureSafe(
  curriculum: BookCurriculum,
  pages: number
): boolean {
  if (
    !Number.isInteger(pages) ||
    pages < 1 ||
    !hasText(curriculum.version) ||
    !curriculum.orientation ||
    !hasText(curriculum.orientation.title) ||
    !validPageRange(curriculum.orientation, pages) ||
    curriculum.orientation.startPage !== 1 ||
    !Array.isArray(curriculum.units) ||
    curriculum.units.length === 0
  ) {
    return false;
  }

  let expectedUnitStartPage = curriculum.orientation.endPage + 1;
  const unitIds = new Set<string>();
  for (const [unitIndex, unit] of curriculum.units.entries()) {
    if (
      !unit ||
      !safeIdPattern.test(unit.id) ||
      unitIds.has(unit.id) ||
      !hasText(unit.title) ||
      !hasText(unit.competency) ||
      unit.number !== unitIndex + 1 ||
      !validPageRange(unit, pages) ||
      unit.startPage !== expectedUnitStartPage ||
      !Array.isArray(unit.sections) ||
      unit.sections.length !== orderedUnitStages.length
    ) {
      return false;
    }
    unitIds.add(unit.id);

    let expectedSectionStartPage = unit.startPage;
    for (const [sectionIndex, section] of unit.sections.entries()) {
      if (
        !section ||
        section.stage !== orderedUnitStages[sectionIndex] ||
        !validPageRange(section, pages) ||
        section.startPage !== expectedSectionStartPage ||
        section.endPage > unit.endPage
      ) {
        return false;
      }
      expectedSectionStartPage = section.endPage + 1;
    }
    if (expectedSectionStartPage !== unit.endPage + 1) {
      return false;
    }
    expectedUnitStartPage = unit.endPage + 1;
  }

  return expectedUnitStartPage === pages + 1;
}

export function getCurriculumEntries(): readonly BookCurriculum[] {
  return curriculumEntries;
}

export function getBookCurriculum(
  bookId: string
): BookCurriculum | undefined {
  const matching = curriculaByBook.get(bookId);
  return matching?.length === 1 ? matching[0] : undefined;
}

export function getBookUnits(bookId: string): readonly BookUnit[] {
  const book = getBook(bookId);
  if (!book) {
    return [];
  }
  const curriculum = getBookCurriculum(bookId);
  return curriculum && isCurriculumStructureSafe(curriculum, book.pages)
    ? curriculum.units
    : [];
}

export function getPageActivity(
  bookId: string,
  page: number
): PageActivity {
  const book = getBook(bookId);
  if (
    !book ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > book.pages
  ) {
    return unavailableActivity(page);
  }

  const curriculum = getBookCurriculum(bookId);
  if (
    !curriculum ||
    !isCurriculumStructureSafe(curriculum, book.pages)
  ) {
    return unavailableActivity(page);
  }

  const orientation = curriculum.orientation;
  const orientationMatches =
    page >= orientation.startPage && page <= orientation.endPage;
  const unitMatches = curriculum.units.flatMap((unit) =>
    unit.sections
      .filter(
        (section) =>
          page >= unit.startPage &&
          page <= unit.endPage &&
          page >= section.startPage &&
          page <= section.endPage
      )
      .map((section) => ({ unit, section }))
  );
  const classificationCount =
    Number(orientationMatches) + unitMatches.length;

  // A missing or overlapping classification is never guessed at runtime,
  // even if a deployment skipped the catalog validator.
  if (classificationCount !== 1) {
    return unavailableActivity(page);
  }

  if (orientationMatches) {
    return {
      unitId: null,
      unitNumber: null,
      unitTitle: orientation.title,
      competency: null,
      stage: "orientation",
      stageLabel: stageLabels.orientation,
      startPage: orientation.startPage,
      endPage: orientation.endPage,
      // Front matter can contain answer keys, diagnostics or other material
      // that is not safe to infer from a generic "orientation" label.
      // Assistance is enabled only by an explicit learn/practice section.
      tutorAvailable: false
    };
  }

  const { unit, section } = unitMatches[0];

  return {
    unitId: unit.id,
    unitNumber: unit.number,
    unitTitle: unit.title,
    competency: unit.competency,
    stage: section.stage,
    stageLabel: stageLabels[section.stage],
    startPage: section.startPage,
    endPage: section.endPage,
    tutorAvailable: section.stage !== "assessment"
  };
}
