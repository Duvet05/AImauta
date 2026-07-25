import curriculaManifest from "@/config/curricula.v3.json";
import { getBook, getCatalogEntries } from "@/lib/catalog";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validPageRange(
  range: unknown,
  pages: number
): range is PageRange {
  return (
    isRecord(range) &&
    Number.isInteger(range.startPage) &&
    Number.isInteger(range.endPage) &&
    Number(range.startPage) >= 1 &&
    Number(range.startPage) <= Number(range.endPage) &&
    Number(range.endPage) <= pages
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
  curriculum: unknown,
  pages: number
): curriculum is BookCurriculum {
  if (
    !Number.isInteger(pages) ||
    pages < 1 ||
    !isRecord(curriculum) ||
    !safeIdPattern.test(String(curriculum.bookId ?? "")) ||
    !hasText(curriculum.version) ||
    !isRecord(curriculum.orientation) ||
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
    if (!isRecord(unit)) {
      return false;
    }
    const {
      id,
      title,
      competency,
      number,
      sections
    } = unit;
    if (
      !safeIdPattern.test(String(id ?? "")) ||
      unitIds.has(String(id)) ||
      !hasText(title) ||
      !hasText(competency) ||
      number !== unitIndex + 1 ||
      !validPageRange(unit, pages) ||
      unit.startPage !== expectedUnitStartPage ||
      !Array.isArray(sections) ||
      sections.length !== orderedUnitStages.length
    ) {
      return false;
    }
    unitIds.add(String(id));

    let expectedSectionStartPage = unit.startPage;
    for (const [sectionIndex, section] of sections.entries()) {
      if (
        !isRecord(section) ||
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

function loadCurriculumEntries(manifest: unknown): readonly BookCurriculum[] {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 3 ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0
  ) {
    return [];
  }

  const catalogEntries = getCatalogEntries();
  const bookIds = new Set<string>();
  const validated: BookCurriculum[] = [];

  for (const candidate of manifest.entries) {
    if (
      !isRecord(candidate) ||
      !safeIdPattern.test(String(candidate.bookId ?? "")) ||
      bookIds.has(String(candidate.bookId))
    ) {
      return [];
    }

    const catalogMatches = catalogEntries.filter(
      (entry) => entry.id === candidate.bookId
    );
    if (
      catalogMatches.length !== 1 ||
      !isCurriculumStructureSafe(candidate, catalogMatches[0].pages)
    ) {
      return [];
    }

    bookIds.add(candidate.bookId);
    validated.push(candidate);
  }

  return validated;
}

const curriculumEntries = loadCurriculumEntries(curriculaManifest);

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

export function getFirstTutorablePage(
  bookId: string
): number | undefined {
  const book = getBook(bookId);
  const curriculum = getBookCurriculum(bookId);
  if (
    !book ||
    !curriculum ||
    !isCurriculumStructureSafe(curriculum, book.pages)
  ) {
    return undefined;
  }

  for (const unit of curriculum.units) {
    const learnSection = unit.sections.find(
      (section) => section.stage === "learn"
    );
    if (learnSection) {
      return learnSection.startPage;
    }
  }

  return undefined;
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
