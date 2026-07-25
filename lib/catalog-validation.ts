import {
  getAdministrativeCatalogEntries,
  getCatalogManifestIssues,
  isCatalogEntrySafe,
  isTutorableMaterialType,
  validateCatalogEntrySchema,
  type CatalogEntry
} from "@/lib/catalog";
import {
  getCurriculumEntries,
  type BookCurriculum,
  type PageRange
} from "@/lib/curriculum";

export type CatalogValidationIssue = {
  code: string;
  id: string;
  message: string;
};

const orderedUnitStages = ["learn", "practice", "assessment"] as const;
const unitStages = new Set(["learn", "practice", "assessment"]);
const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function summarizePages(pages: readonly number[]): string {
  const preview = pages.slice(0, 12).join(", ");
  return pages.length > 12 ? `${preview}… (${pages.length} en total)` : preview;
}

function validateCatalogEntry(
  entry: unknown,
  issues: CatalogValidationIssue[]
): entry is CatalogEntry {
  issues.push(...validateCatalogEntrySchema(entry));
  return isCatalogEntrySafe(entry);
}

function validRange(range: PageRange, pages: number): boolean {
  return (
    isPositiveInteger(range.startPage) &&
    isPositiveInteger(range.endPage) &&
    range.startPage <= range.endPage &&
    range.endPage <= pages
  );
}

function validateCurriculum(
  curriculum: BookCurriculum,
  pages: number,
  issues: CatalogValidationIssue[]
): void {
  const id = curriculum.bookId;
  if (!hasText(curriculum.version)) {
    issues.push({
      code: "curriculum.missing-version",
      id,
      message: "El currículo debe declarar una versión."
    });
  }

  const coverage = Array.from({ length: pages + 1 }, () => 0);
  const mark = (range: PageRange) => {
    if (!validRange(range, pages)) {
      return;
    }
    for (let page = range.startPage; page <= range.endPage; page += 1) {
      coverage[page] += 1;
    }
  };

  if (!validRange(curriculum.orientation, pages)) {
    issues.push({
      code: "curriculum.invalid-orientation-range",
      id,
      message: "El rango de orientación está fuera del PDF."
    });
  } else {
    mark(curriculum.orientation);
  }
  if (!hasText(curriculum.orientation.title)) {
    issues.push({
      code: "curriculum.missing-orientation-title",
      id,
      message: "La sección de orientación debe tener un título."
    });
  }

  if (curriculum.units.length === 0) {
    issues.push({
      code: "curriculum.empty-units",
      id,
      message:
        "El currículo debe incluir al menos una unidad; orientación no puede clasificar por sí sola todo el libro."
    });
  }

  const unitIds = new Set<string>();
  const unitNumbers = new Set<number>();
  let expectedUnitStartPage = curriculum.orientation.endPage + 1;
  for (const [unitIndex, unit] of curriculum.units.entries()) {
    if (!safeIdPattern.test(unit.id) || unitIds.has(unit.id)) {
      issues.push({
        code: "curriculum.invalid-unit-id",
        id,
        message: `Id de unidad inválido o duplicado: ${unit.id}.`
      });
    }
    unitIds.add(unit.id);

    if (!isPositiveInteger(unit.number) || unitNumbers.has(unit.number)) {
      issues.push({
        code: "curriculum.invalid-unit-number",
        id,
        message: `Número de unidad inválido o duplicado: ${unit.number}.`
      });
    }
    unitNumbers.add(unit.number);

    const unitRangeValid = validRange(unit, pages);
    if (!unitRangeValid) {
      issues.push({
        code: "curriculum.invalid-unit-range",
        id,
        message: `La unidad ${unit.id} tiene un rango inválido.`
      });
    }
    if (!hasText(unit.title) || !hasText(unit.competency)) {
      issues.push({
        code: "curriculum.missing-unit-metadata",
        id,
        message: `La unidad ${unit.id} requiere título y competencia.`
      });
    }
    if (
      unit.number !== unitIndex + 1 ||
      unit.startPage !== expectedUnitStartPage
    ) {
      issues.push({
        code: "curriculum.invalid-unit-sequence",
        id,
        message:
          `${unit.id} debe seguir el orden numérico y comenzar inmediatamente ` +
          "después de la clasificación anterior."
      });
    }
    expectedUnitStartPage = unit.endPage + 1;

    const hasOrderedStages =
      unit.sections.length === orderedUnitStages.length &&
      orderedUnitStages.every(
        (stage, index) => unit.sections[index]?.stage === stage
      );
    const hasContinuousStages =
      unit.sections.length === orderedUnitStages.length &&
      unit.sections[0]?.startPage === unit.startPage &&
      unit.sections.at(-1)?.endPage === unit.endPage &&
      unit.sections.every(
        (section, index) =>
          index === 0 ||
          section.startPage === unit.sections[index - 1].endPage + 1
      );
    if (!hasOrderedStages || !hasContinuousStages) {
      issues.push({
        code: "curriculum.invalid-stage-structure",
        id,
        message:
          `${unit.id} debe contener exactamente learn → practice → assessment ` +
          "en ese orden y cubrir continuamente el rango de la unidad."
      });
    }

    const unitCoverage = unitRangeValid
      ? Array.from({ length: unit.endPage - unit.startPage + 1 }, () => 0)
      : [];

    for (const section of unit.sections) {
      if (!unitStages.has(section.stage)) {
        issues.push({
          code: "curriculum.invalid-stage",
          id,
          message: `La unidad ${unit.id} usa una etapa no reconocida.`
        });
      }
      if (!validRange(section, pages)) {
        issues.push({
          code: "curriculum.invalid-section-range",
          id,
          message: `La unidad ${unit.id} contiene una sección inválida.`
        });
        continue;
      }
      if (
        !unitRangeValid ||
        section.startPage < unit.startPage ||
        section.endPage > unit.endPage
      ) {
        issues.push({
          code: "curriculum.section-outside-unit",
          id,
          message: `Una sección de ${unit.id} está fuera de su unidad.`
        });
      } else {
        for (
          let page = section.startPage;
          page <= section.endPage;
          page += 1
        ) {
          unitCoverage[page - unit.startPage] += 1;
        }
      }
      mark(section);
    }

    const unitGaps: number[] = [];
    const unitOverlaps: number[] = [];
    unitCoverage.forEach((count, index) => {
      const page = unit.startPage + index;
      if (count === 0) unitGaps.push(page);
      if (count > 1) unitOverlaps.push(page);
    });
    if (unitGaps.length > 0) {
      issues.push({
        code: "curriculum.unit-page-gap",
        id,
        message: `${unit.id} deja páginas sin etapa: ${summarizePages(unitGaps)}.`
      });
    }
    if (unitOverlaps.length > 0) {
      issues.push({
        code: "curriculum.unit-page-overlap",
        id,
        message: `${unit.id} superpone etapas: ${summarizePages(unitOverlaps)}.`
      });
    }
  }

  if (
    validRange(curriculum.orientation, pages) &&
    curriculum.orientation.startPage !== 1
  ) {
    issues.push({
      code: "curriculum.invalid-orientation-sequence",
      id,
      message: "La orientación debe comenzar en la primera página."
    });
  }
  if (
    curriculum.units.length > 0 &&
    expectedUnitStartPage !== pages + 1
  ) {
    issues.push({
      code: "curriculum.invalid-unit-sequence",
      id,
      message: "La última unidad debe terminar en la última página del libro."
    });
  }

  const gaps: number[] = [];
  const overlaps: number[] = [];
  for (let page = 1; page <= pages; page += 1) {
    if (coverage[page] === 0) gaps.push(page);
    if (coverage[page] > 1) overlaps.push(page);
  }
  if (gaps.length > 0) {
    issues.push({
      code: "curriculum.page-gap",
      id,
      message: `Páginas sin clasificación: ${summarizePages(gaps)}.`
    });
  }
  if (overlaps.length > 0) {
    issues.push({
      code: "curriculum.page-overlap",
      id,
      message: `Páginas con clasificación superpuesta: ${summarizePages(overlaps)}.`
    });
  }
}

export function validateCatalogCurriculum(
  entries?: readonly unknown[],
  curricula: readonly BookCurriculum[] = getCurriculumEntries()
): CatalogValidationIssue[] {
  const usesRuntimeManifest = entries === undefined;
  const candidateEntries =
    entries ?? getAdministrativeCatalogEntries();
  const issues: CatalogValidationIssue[] = usesRuntimeManifest
    ? [...getCatalogManifestIssues()]
    : [];
  const entriesById = new Map<string, CatalogEntry>();
  const storageFiles = new Set<string>();

  for (const entry of candidateEntries) {
    if (!validateCatalogEntry(entry, issues)) {
      continue;
    }
    if (entriesById.has(entry.id)) {
      issues.push({
        code: "catalog.duplicate-id",
        id: entry.id,
        message: "El id de catálogo está duplicado."
      });
    }
    entriesById.set(entry.id, entry);
    if (storageFiles.has(entry.storageFile)) {
      issues.push({
        code: "catalog.duplicate-storage-file",
        id: entry.id,
        message: `storageFile duplicado: ${entry.storageFile}.`
      });
    }
    storageFiles.add(entry.storageFile);
  }

  const curriculaByBook = new Map<string, BookCurriculum[]>();
  for (const curriculum of curricula) {
    const matching = curriculaByBook.get(curriculum.bookId) ?? [];
    matching.push(curriculum);
    curriculaByBook.set(curriculum.bookId, matching);

    const entry = entriesById.get(curriculum.bookId);
    if (!entry) {
      issues.push({
        code: "curriculum.orphan",
        id: curriculum.bookId,
        message: "Existe un currículo sin entrada de catálogo."
      });
      continue;
    }
    if (!isTutorableMaterialType(entry.materialType)) {
      issues.push({
        code: "curriculum.disallowed-material-type",
        id: curriculum.bookId,
        message:
          `El tipo ${entry.materialType} no puede recibir currículo, tutor ni RAG.`
      });
      continue;
    }
    if (isPositiveInteger(entry.pages)) {
      validateCurriculum(curriculum, entry.pages, issues);
    }
  }

  for (const entry of entriesById.values()) {
    const matching = curriculaByBook.get(entry.id) ?? [];
    if (matching.length > 1) {
      issues.push({
        code: "curriculum.duplicate-book",
        id: entry.id,
        message: "El material tiene más de un currículo activo."
      });
    }
    if (
      entry.status === "published" &&
      isTutorableMaterialType(entry.materialType) &&
      matching.length !== 1
    ) {
      issues.push({
        code: "catalog.published-missing-curriculum",
        id: entry.id,
        message: "Un material published debe tener exactamente un currículo."
      });
    }
  }

  return issues;
}

export function assertCatalogCurriculumIsValid(
  entries?: readonly unknown[],
  curricula: readonly BookCurriculum[] = getCurriculumEntries()
): void {
  const issues = validateCatalogCurriculum(entries, curricula);
  if (issues.length === 0) {
    return;
  }
  const details = issues
    .map((issue) => `[${issue.code}] ${issue.id}: ${issue.message}`)
    .join("\n");
  throw new Error(`Catálogo curricular inválido:\n${details}`);
}
