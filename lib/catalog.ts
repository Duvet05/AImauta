import catalogManifest from "@/config/catalog.v3.json";

export const educationLevels = {
  primaria: {
    label: "Primaria",
    grades: [1, 2, 3, 4, 5, 6]
  },
  secundaria: {
    label: "Secundaria",
    grades: [1, 2, 3, 4, 5]
  }
} as const;

export const courses = {
  matematica: {
    label: "Matemática"
  }
} as const;

export const catalogStatuses = [
  "draft",
  "review",
  "published",
  "disabled"
] as const;

/**
 * Only learner-facing material types may become a Book. The other values are
 * valid administrative catalog classifications, but they must never acquire
 * curriculum, tutor or RAG access.
 */
export const materialTypes = [
  "student-workbook",
  "student-textbook",
  "teacher-guide",
  "answer-key",
  "solution-manual"
] as const;

export const tutorableMaterialTypes = [
  "student-workbook",
  "student-textbook"
] as const;

export const catalogLanguages = ["es-PE"] as const;
export const catalogProvenances = ["official-minedu"] as const;
export const publicationBlockers = [
  "publication-review-pending"
] as const;
export const MAX_INGEST_PDF_BYTES = 50 * 1024 * 1024;

export type EducationLevelId = keyof typeof educationLevels;
export type CourseId = keyof typeof courses;
export type GradeNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type CatalogStatus = (typeof catalogStatuses)[number];
export type MaterialType = (typeof materialTypes)[number];
export type TutorableMaterialType =
  (typeof tutorableMaterialTypes)[number];
export type CatalogLanguage = (typeof catalogLanguages)[number];
export type CatalogProvenance = (typeof catalogProvenances)[number];
export type PublicationBlocker = (typeof publicationBlockers)[number];

export type CatalogEntryBase = {
  id: string;
  status: CatalogStatus;
  publicationBlockers: readonly PublicationBlocker[];
  title: string;
  levelId: EducationLevelId;
  gradeNumber: GradeNumber;
  courseId: CourseId;
  materialType: MaterialType;
  language: CatalogLanguage;
  description: string;
  pages: number;
  sourceLabel: string;
  sourcePageUrl: string;
  sourcePdfUrl: string;
  discoveredViaUrl: string;
  storageFile: string;
  expectedBytes: number;
  expectedSha256: string;
  edition: string;
  licenseName: string;
  licenseUrl: string;
  licenseBasis: "official-repository-metadata";
  licenseEvidenceUrl: string;
  licenseReviewedAt: string;
  attribution: string;
  provenance: CatalogProvenance;
};

export type PublishedCatalogEntry = CatalogEntryBase & {
  status: "published";
  publicationBlockers: readonly [];
};

export type UnpublishedCatalogEntry = CatalogEntryBase & {
  status: Exclude<CatalogStatus, "published">;
};

export type CatalogEntry = PublishedCatalogEntry | UnpublishedCatalogEntry;

export type TutorablePublishedCatalogEntry = PublishedCatalogEntry & {
  materialType: TutorableMaterialType;
};

export type AuthoringCatalogEntry = CatalogEntry & {
  materialType: TutorableMaterialType;
  status: Exclude<CatalogStatus, "disabled">;
};

/**
 * Public material shape. The normalized taxonomy remains available through
 * `levelId`, `gradeNumber` and `courseId`; labels are derived for compatibility
 * with the existing UI and service metadata.
 */
export type Book = TutorablePublishedCatalogEntry & {
  level: (typeof educationLevels)[EducationLevelId]["label"];
  grade: string;
  subject: (typeof courses)[CourseId]["label"];
};

export type CatalogSchemaIssue = {
  code: string;
  id: string;
  message: string;
};

export type CatalogManifestParseResult = {
  entries: readonly CatalogEntry[];
  issues: readonly CatalogSchemaIssue[];
};

const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safePdfNamePattern = /^[a-z0-9][a-z0-9._-]*\.pdf$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const catalogEntryFields = new Set([
  "id",
  "status",
  "publicationBlockers",
  "title",
  "levelId",
  "gradeNumber",
  "courseId",
  "materialType",
  "language",
  "description",
  "pages",
  "sourceLabel",
  "sourcePageUrl",
  "sourcePdfUrl",
  "discoveredViaUrl",
  "storageFile",
  "expectedBytes",
  "expectedSha256",
  "edition",
  "licenseName",
  "licenseUrl",
  "licenseBasis",
  "licenseEvidenceUrl",
  "licenseReviewedAt",
  "attribution",
  "provenance"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isOneOf<const T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isEducationLevelId(
  value: unknown
): value is EducationLevelId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(educationLevels, value)
  );
}

function isCourseId(value: unknown): value is CourseId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(courses, value)
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (!hasText(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isOfficialMineduUrl(value: unknown): value is string {
  if (!isHttpsUrl(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    url.hostname === "repositorio.minedu.gob.pe" ||
    url.hostname === "repositorios.perueduca.pe"
  );
}

function isExactIsoDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = isoDatePattern.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function entryId(value: unknown, index?: number): string {
  if (isRecord(value) && hasText(value.id)) {
    return value.id;
  }
  return index === undefined ? "(sin id)" : `(entrada ${index + 1})`;
}

/**
 * Complete runtime schema check for a single catalog entry.
 *
 * This is intentionally independent from TypeScript's compile-time types:
 * imported JSON and test/admin inputs are untrusted until this function
 * accepts every required field and taxonomy value.
 */
export function validateCatalogEntrySchema(
  value: unknown,
  index?: number
): CatalogSchemaIssue[] {
  const issues: CatalogSchemaIssue[] = [];
  const id = entryId(value, index);
  const report = (code: string, message: string) => {
    issues.push({ code, id, message });
  };

  if (!isRecord(value)) {
    report(
      "catalog.invalid-entry",
      "Cada entrada del catálogo debe ser un objeto."
    );
    return issues;
  }

  const unexpectedFields = Object.keys(value).filter(
    (field) => !catalogEntryFields.has(field)
  );
  if (unexpectedFields.length > 0) {
    report(
      "catalog.unexpected-field",
      `Campos de catálogo no reconocidos: ${unexpectedFields.join(", ")}.`
    );
  }

  if (
    typeof value.id !== "string" ||
    !safeIdPattern.test(value.id)
  ) {
    report(
      "catalog.invalid-id",
      "El id debe ser un slug estable en minúsculas."
    );
  }
  if (!isOneOf(catalogStatuses, value.status)) {
    report(
      "catalog.invalid-status",
      `Estado de catálogo no reconocido: ${String(value.status)}.`
    );
  }
  if (!Array.isArray(value.publicationBlockers)) {
    report(
      "catalog.invalid-publication-blockers",
      "publicationBlockers debe ser un arreglo obligatorio."
    );
  } else {
    const candidateBlockers = Array.from(value.publicationBlockers);
    const invalidBlockers = candidateBlockers.filter(
      (blocker) => !isOneOf(publicationBlockers, blocker)
    );
    if (invalidBlockers.length > 0) {
      report(
        "catalog.invalid-publication-blocker",
        "publicationBlockers contiene valores fuera de la lista permitida."
      );
    }
    if (
      new Set(candidateBlockers).size !== candidateBlockers.length
    ) {
      report(
        "catalog.duplicate-publication-blocker",
        "publicationBlockers no puede contener valores duplicados."
      );
    }
    if (
      value.status === "published" &&
      value.publicationBlockers.length > 0
    ) {
      report(
        "catalog.published-has-blockers",
        "Un material published debe tener publicationBlockers vacío."
      );
    }
  }

  if (!isEducationLevelId(value.levelId)) {
    report(
      "catalog.invalid-level",
      `Nivel educativo no reconocido: ${String(value.levelId)}.`
    );
  } else {
    if (
      !isPositiveInteger(value.gradeNumber) ||
      !educationLevels[value.levelId].grades.some(
        (grade) => grade === value.gradeNumber
      )
    ) {
      report(
        "catalog.invalid-grade",
        `El grado ${String(value.gradeNumber)} no pertenece a ` +
          `${educationLevels[value.levelId].label}.`
      );
    }
  }
  if (!isCourseId(value.courseId)) {
    report(
      "catalog.invalid-course",
      `Curso no reconocido: ${String(value.courseId)}.`
    );
  }
  if (!isOneOf(materialTypes, value.materialType)) {
    report(
      "catalog.invalid-material-type",
      `Tipo de material no reconocido: ${String(value.materialType)}.`
    );
  }
  if (!isOneOf(catalogLanguages, value.language)) {
    report(
      "catalog.invalid-language",
      `Idioma de catálogo no permitido: ${String(value.language)}.`
    );
  }
  if (!isOneOf(catalogProvenances, value.provenance)) {
    report(
      "catalog.invalid-provenance",
      `Procedencia de catálogo no permitida: ${String(value.provenance)}.`
    );
  }

  if (!isPositiveInteger(value.pages)) {
    report(
      "catalog.invalid-pages",
      "El número de páginas debe ser un entero positivo."
    );
  }
  if (
    typeof value.storageFile !== "string" ||
    !safePdfNamePattern.test(value.storageFile)
  ) {
    report(
      "catalog.invalid-storage-file",
      "storageFile debe ser un nombre PDF simple y seguro."
    );
  }

  for (const field of [
    "title",
    "description",
    "sourceLabel",
    "edition",
    "licenseName",
    "attribution"
  ] as const) {
    if (!hasText(value[field])) {
      report(
        "catalog.missing-metadata",
        `Falta el metadato obligatorio ${field}.`
      );
    }
  }

  for (const field of [
    "sourcePageUrl",
    "sourcePdfUrl",
    "discoveredViaUrl",
    "licenseUrl",
    "licenseEvidenceUrl"
  ] as const) {
    if (!isHttpsUrl(value[field])) {
      report(
        "catalog.invalid-url",
        `${field} debe ser una URL HTTPS válida sin credenciales.`
      );
    }
  }

  if (
    !isOfficialMineduUrl(value.sourcePageUrl) ||
    !isOfficialMineduUrl(value.licenseEvidenceUrl)
  ) {
    report(
      "catalog.invalid-provenance-source",
      "La página fuente y la evidencia de licencia deben pertenecer a MINEDU."
    );
  }
  if (value.licenseBasis !== "official-repository-metadata") {
    report(
      "catalog.invalid-license-basis",
      "La licencia debe apoyarse en metadata oficial verificable."
    );
  }
  if (!isExactIsoDate(value.licenseReviewedAt)) {
    report(
      "catalog.invalid-license-review-date",
      "licenseReviewedAt debe ser una fecha ISO real y válida."
    );
  }

  if (
    !isHttpsUrl(value.sourcePdfUrl) ||
    !isAllowedOfficialSource(new URL(value.sourcePdfUrl))
  ) {
    report(
      "catalog.unapproved-pdf-source",
      "sourcePdfUrl no pertenece a una fuente oficial permitida."
    );
  }
  if (
    !Number.isSafeInteger(value.expectedBytes) ||
    Number(value.expectedBytes) <= 0 ||
    Number(value.expectedBytes) > MAX_INGEST_PDF_BYTES
  ) {
    report(
      "catalog.invalid-bytes",
      "expectedBytes debe ser un entero positivo de hasta 50 MiB."
    );
  }
  if (
    typeof value.expectedSha256 !== "string" ||
    !sha256Pattern.test(value.expectedSha256)
  ) {
    report(
      "catalog.invalid-checksum",
      "Toda entrada debe fijar un SHA-256 hexadecimal en minúsculas."
    );
  }

  return issues;
}

export function isCatalogEntrySafe(value: unknown): value is CatalogEntry {
  return validateCatalogEntrySchema(value).length === 0;
}

function freezeCatalogEntry(entry: CatalogEntry): CatalogEntry {
  if (entry.status === "published") {
    return Object.freeze({
      ...entry,
      publicationBlockers: Object.freeze([] as const)
    });
  }
  return Object.freeze({
    ...entry,
    publicationBlockers: Object.freeze([
      ...entry.publicationBlockers
    ])
  });
}

/**
 * Parse a versioned manifest as one security boundary. If any entry, field,
 * taxonomy value or uniqueness constraint is invalid, no entry is published.
 */
export function parseCatalogManifest(
  value: unknown
): CatalogManifestParseResult {
  const issues: CatalogSchemaIssue[] = [];
  if (!isRecord(value)) {
    return {
      entries: [],
      issues: [
        {
          code: "catalog.invalid-manifest",
          id: "(manifiesto)",
          message: "El manifiesto de catálogo debe ser un objeto."
        }
      ]
    };
  }

  const unexpectedFields = Object.keys(value).filter(
    (field) => field !== "schemaVersion" && field !== "entries"
  );
  if (unexpectedFields.length > 0) {
    issues.push({
      code: "catalog.unexpected-manifest-field",
      id: "(manifiesto)",
      message:
        `Campos de manifiesto no reconocidos: ${unexpectedFields.join(", ")}.`
    });
  }
  if (value.schemaVersion !== 3) {
    issues.push({
      code: "catalog.invalid-schema-version",
      id: "(manifiesto)",
      message: "El catálogo debe declarar schemaVersion 3."
    });
  }
  if (!Array.isArray(value.entries)) {
    issues.push({
      code: "catalog.invalid-entries",
      id: "(manifiesto)",
      message: "El catálogo debe contener un arreglo entries."
    });
    return { entries: [], issues };
  }

  value.entries.forEach((entry, index) => {
    issues.push(...validateCatalogEntrySchema(entry, index));
  });

  const ids = new Set<string>();
  const storageFiles = new Set<string>();
  for (const [index, entry] of value.entries.entries()) {
    if (!isCatalogEntrySafe(entry)) {
      continue;
    }
    if (ids.has(entry.id)) {
      issues.push({
        code: "catalog.duplicate-id",
        id: entry.id,
        message: "El id de catálogo está duplicado."
      });
    }
    ids.add(entry.id);
    if (storageFiles.has(entry.storageFile)) {
      issues.push({
        code: "catalog.duplicate-storage-file",
        id: entry.id || `(entrada ${index + 1})`,
        message: `storageFile duplicado: ${entry.storageFile}.`
      });
    }
    storageFiles.add(entry.storageFile);
  }

  if (issues.length > 0) {
    return { entries: [], issues: Object.freeze(issues) };
  }

  const entries = value.entries
    .filter(isCatalogEntrySafe)
    .map(freezeCatalogEntry);
  return {
    entries: Object.freeze(entries),
    issues: Object.freeze([])
  };
}

const parsedCatalogManifest = parseCatalogManifest(catalogManifest);
const catalogEntries = parsedCatalogManifest.entries;

const gradeLabels: Readonly<Record<GradeNumber, string>> = {
  1: "1.er grado",
  2: "2.º grado",
  3: "3.er grado",
  4: "4.º grado",
  5: "5.º grado",
  6: "6.º grado"
};

export function isPublishedCatalogEntry(
  entry: CatalogEntry
): entry is PublishedCatalogEntry {
  return (
    entry.status === "published" &&
    entry.publicationBlockers.length === 0
  );
}

export function isTutorableMaterialType(
  value: unknown
): value is TutorableMaterialType {
  return isOneOf(tutorableMaterialTypes, value);
}

export function isTutorableCatalogEntry(
  entry: CatalogEntry
): entry is CatalogEntry & { materialType: TutorableMaterialType } {
  return isTutorableMaterialType(entry.materialType);
}

export function isPublishedTutorableCatalogEntry(
  entry: CatalogEntry
): entry is TutorablePublishedCatalogEntry {
  return (
    isPublishedCatalogEntry(entry) &&
    isTutorableCatalogEntry(entry)
  );
}

function toBook(entry: TutorablePublishedCatalogEntry): Book {
  return {
    ...entry,
    level: educationLevels[entry.levelId].label,
    grade: gradeLabels[entry.gradeNumber],
    subject: courses[entry.courseId].label
  };
}

const publishedBooks: readonly Book[] = catalogEntries
  .filter(isPublishedTutorableCatalogEntry)
  .map(toBook);
const curriculumEligibleEntries = catalogEntries.filter(
  isTutorableCatalogEntry
);

/**
 * Security-scoped catalog used by curriculum, ingestion and manifest code.
 * Non-learner materials are deliberately absent so those downstream callers
 * cannot bind a curriculum, exercise manifest, tutor or RAG index to them.
 */
export function getCatalogEntries(): readonly CatalogEntry[] {
  return curriculumEligibleEntries;
}

/**
 * Editorial lookup for deterministic, offline preparation only.
 *
 * Draft and review materials need curriculum classification while their PDF,
 * index and exercise manifests are being prepared. They remain absent from
 * every public lookup, and disabled materials stay unavailable here as well.
 */
export function getAuthoringCatalogEntry(
  id: string
): AuthoringCatalogEntry | undefined {
  const matching = curriculumEligibleEntries.filter(
    (entry) => entry.id === id && entry.status !== "disabled"
  );
  return matching.length === 1
    ? (matching[0] as AuthoringCatalogEntry)
    : undefined;
}

/**
 * Complete administrative catalog, including material types which are never
 * learner-facing. Only validation and catalog-management tooling should use it.
 */
export function getAdministrativeCatalogEntries(): readonly CatalogEntry[] {
  return catalogEntries;
}

export function getCatalogManifestIssues(): readonly CatalogSchemaIssue[] {
  return parsedCatalogManifest.issues;
}

export function getPublishedBooks(): readonly Book[] {
  return publishedBooks;
}

/**
 * Backwards-compatible public catalog. It deliberately exposes only published,
 * learner-facing materials.
 */
export function getBooks(): readonly Book[] {
  return getPublishedBooks();
}

/**
 * Public lookup. Draft, review, disabled and non-learner materials behave as
 * unavailable, which also closes all downstream curriculum/tutor/RAG lookups.
 */
export function getBook(id: string): Book | undefined {
  return publishedBooks.find((book) => book.id === id);
}

export function isAllowedOfficialSource(source: URL): boolean {
  return (
    source.protocol === "https:" &&
    source.username === "" &&
    source.password === "" &&
    ((source.hostname === "repositorios.perueduca.pe" &&
      source.pathname.startsWith("/pe-recursos/")) ||
      (source.hostname === "repositorio.minedu.gob.pe" &&
        source.pathname.startsWith("/bitstream/handle/")))
  );
}
