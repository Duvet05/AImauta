export type LearningStage =
  | "orientation"
  | "learn"
  | "practice"
  | "assessment";

export type UnitSection = {
  stage: Exclude<LearningStage, "orientation">;
  startPage: number;
  endPage: number;
};

export type BookUnit = {
  id: string;
  number: number;
  title: string;
  competency: string;
  startPage: number;
  endPage: number;
  sections: readonly UnitSection[];
};

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

const curriculumByBook: Readonly<Record<string, readonly BookUnit[]>> = {
  "fichas-matematica-1-secundaria": mathematicsOneUnits
};

export function getBookUnits(bookId: string): readonly BookUnit[] {
  return curriculumByBook[bookId] ?? [];
}

export function getPageActivity(
  bookId: string,
  page: number
): PageActivity {
  const unit = getBookUnits(bookId).find(
    (candidate) => page >= candidate.startPage && page <= candidate.endPage
  );
  if (!unit) {
    return {
      unitId: null,
      unitNumber: null,
      unitTitle: "Orientación y estrategias",
      competency: null,
      stage: "orientation",
      stageLabel: "Explora",
      startPage: 1,
      endPage: 12,
      tutorAvailable: true
    };
  }

  const section = unit.sections.find(
    (candidate) => page >= candidate.startPage && page <= candidate.endPage
  );
  const stage = section?.stage ?? "learn";
  const labels: Record<Exclude<LearningStage, "orientation">, string> = {
    learn: "Construimos",
    practice: "Comprobamos",
    assessment: "Evaluamos"
  };

  return {
    unitId: unit.id,
    unitNumber: unit.number,
    unitTitle: unit.title,
    competency: unit.competency,
    stage,
    stageLabel: labels[stage],
    startPage: section?.startPage ?? unit.startPage,
    endPage: section?.endPage ?? unit.endPage,
    tutorAvailable: stage !== "assessment"
  };
}
