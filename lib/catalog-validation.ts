import {
  courses,
  educationLevels,
  getCatalogEntries,
  isAllowedOfficialSource,
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

const catalogStatuses = new Set([
  "draft",
  "reviewing",
  "ready",
  "disabled"
]);
const unitStages = new Set(["learn", "practice", "assessment"]);
const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safePdfNamePattern = /^[a-z0-9][a-z0-9._-]*\.pdf$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): boolean {
  if (!hasText(value)) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function summarizePages(pages: readonly number[]): string {
  const preview = pages.slice(0, 12).join(", ");
  return pages.length > 12 ? `${preview}… (${pages.length} en total)` : preview;
}

function validateCatalogEntry(
  entry: CatalogEntry,
  issues: CatalogValidationIssue[]
): void {
  const id = hasText(entry.id) ? entry.id : "(sin id)";

  if (!safeIdPattern.test(entry.id)) {
    issues.push({
      code: "catalog.invalid-id",
      id,
      message: "El id debe ser un slug estable en minúsculas."
    });
  }
  if (!catalogStatuses.has(entry.status)) {
    issues.push({
      code: "catalog.invalid-status",
      id,
      message: `Estado de catálogo no reconocido: ${String(entry.status)}.`
    });
  }

  const level = educationLevels[entry.levelId];
  if (!level) {
    issues.push({
      code: "catalog.invalid-level",
      id,
      message: `Nivel educativo no reconocido: ${String(entry.levelId)}.`
    });
  } else if (
    !(level.grades as readonly number[]).includes(entry.gradeNumber)
  ) {
    issues.push({
      code: "catalog.invalid-grade",
      id,
      message: `El grado ${entry.gradeNumber} no pertenece a ${level.label}.`
    });
  }

  if (!Object.prototype.hasOwnProperty.call(courses, entry.courseId)) {
    issues.push({
      code: "catalog.invalid-course",
      id,
      message: `Curso no reconocido: ${String(entry.courseId)}.`
    });
  }
  if (!isPositiveInteger(entry.pages)) {
    issues.push({
      code: "catalog.invalid-pages",
      id,
      message: "El número de páginas debe ser un entero positivo."
    });
  }
  if (!safePdfNamePattern.test(entry.storageFile)) {
    issues.push({
      code: "catalog.invalid-storage-file",
      id,
      message: "storageFile debe ser un nombre PDF simple y seguro."
    });
  }

  for (const [field, value] of [
    ["title", entry.title],
    ["description", entry.description],
    ["sourceLabel", entry.sourceLabel],
    ["edition", entry.edition],
    ["licenseName", entry.licenseName],
    ["attribution", entry.attribution]
  ] as const) {
    if (!hasText(value)) {
      issues.push({
        code: "catalog.missing-metadata",
        id,
        message: `Falta el metadato obligatorio ${field}.`
      });
    }
  }

  for (const [field, value] of [
    ["sourcePageUrl", entry.sourcePageUrl],
    ["discoveredViaUrl", entry.discoveredViaUrl],
    ["licenseUrl", entry.licenseUrl],
    ["licenseEvidenceUrl", entry.licenseEvidenceUrl]
  ] as const) {
    if (!isHttpsUrl(value)) {
      issues.push({
        code: "catalog.invalid-url",
        id,
        message: `${field} debe ser una URL HTTPS válida.`
      });
    }
  }
  if (entry.licenseBasis !== "official-repository-metadata") {
    issues.push({
      code: "catalog.invalid-license-basis",
      id,
      message: "La licencia debe apoyarse en metadata oficial verificable."
    });
  }
  if (
    !isoDatePattern.test(entry.licenseReviewedAt) ||
    Number.isNaN(Date.parse(`${entry.licenseReviewedAt}T00:00:00Z`))
  ) {
    issues.push({
      code: "catalog.invalid-license-review-date",
      id,
      message: "licenseReviewedAt debe ser una fecha ISO válida."
    });
  }

  try {
    if (!isAllowedOfficialSource(new URL(entry.sourcePdfUrl))) {
      issues.push({
        code: "catalog.unapproved-pdf-source",
        id,
        message: "sourcePdfUrl no pertenece a una fuente oficial permitida."
      });
    }
  } catch {
    issues.push({
      code: "catalog.unapproved-pdf-source",
      id,
      message: "sourcePdfUrl no es una URL válida."
    });
  }

  if (entry.status === "ready") {
    if (!isPositiveInteger(entry.expectedBytes)) {
      issues.push({
        code: "catalog.ready-missing-bytes",
        id,
        message: "Un material ready debe fijar expectedBytes."
      });
    }
    if (
      typeof entry.expectedSha256 !== "string" ||
      !sha256Pattern.test(entry.expectedSha256)
    ) {
      issues.push({
        code: "catalog.ready-invalid-checksum",
        id,
        message:
          "Un material ready debe fijar un SHA-256 hexadecimal en minúsculas."
      });
    }
  }
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

  const unitIds = new Set<string>();
  const unitNumbers = new Set<number>();
  for (const unit of curriculum.units) {
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
    if (unit.sections.length === 0) {
      issues.push({
        code: "curriculum.empty-unit",
        id,
        message: `La unidad ${unit.id} no tiene secciones.`
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
  entries: readonly CatalogEntry[] = getCatalogEntries(),
  curricula: readonly BookCurriculum[] = getCurriculumEntries()
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const entriesById = new Map<string, CatalogEntry>();
  const storageFiles = new Set<string>();

  for (const entry of entries) {
    validateCatalogEntry(entry, issues);
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
    if (isPositiveInteger(entry.pages)) {
      validateCurriculum(curriculum, entry.pages, issues);
    }
  }

  for (const entry of entries) {
    const matching = curriculaByBook.get(entry.id) ?? [];
    if (matching.length > 1) {
      issues.push({
        code: "curriculum.duplicate-book",
        id: entry.id,
        message: "El material tiene más de un currículo activo."
      });
    }
    if (entry.status === "ready" && matching.length !== 1) {
      issues.push({
        code: "catalog.ready-missing-curriculum",
        id: entry.id,
        message: "Un material ready debe tener exactamente un currículo."
      });
    }
  }

  return issues;
}

export function assertCatalogCurriculumIsValid(
  entries: readonly CatalogEntry[] = getCatalogEntries(),
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
