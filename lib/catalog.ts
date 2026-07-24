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

export type EducationLevelId = keyof typeof educationLevels;
export type CourseId = keyof typeof courses;
export type GradeNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type CatalogStatus = "draft" | "reviewing" | "ready" | "disabled";
export type MaterialType = "student-workbook" | "student-textbook";

type CatalogEntryBase = {
  id: string;
  status: CatalogStatus;
  title: string;
  levelId: EducationLevelId;
  gradeNumber: GradeNumber;
  courseId: CourseId;
  materialType: MaterialType;
  language: "es-PE";
  description: string;
  pages: number;
  sourceLabel: string;
  sourcePageUrl: string;
  sourcePdfUrl: string;
  discoveredViaUrl: string;
  storageFile: string;
  edition: string;
  licenseName: string;
  licenseUrl: string;
  licenseBasis: "official-repository-metadata";
  licenseEvidenceUrl: string;
  licenseReviewedAt: string;
  attribution: string;
  provenance: "official-minedu";
};

export type ReadyCatalogEntry = CatalogEntryBase & {
  status: "ready";
  expectedBytes: number;
  expectedSha256: string;
};

export type PendingCatalogEntry = CatalogEntryBase & {
  status: Exclude<CatalogStatus, "ready">;
  expectedBytes?: number;
  expectedSha256?: string;
};

export type CatalogEntry = ReadyCatalogEntry | PendingCatalogEntry;

/**
 * Public material shape. The normalized taxonomy remains available through
 * `levelId`, `gradeNumber` and `courseId`; labels are derived for compatibility
 * with the existing UI and service metadata.
 */
export type Book = ReadyCatalogEntry & {
  level: (typeof educationLevels)[EducationLevelId]["label"];
  grade: string;
  subject: (typeof courses)[CourseId]["label"];
};

const catalogEntries: readonly CatalogEntry[] = [
  {
    id: "fichas-matematica-1-secundaria",
    status: "ready",
    title: "Fichas de Matemática 1",
    levelId: "secundaria",
    gradeNumber: 1,
    courseId: "matematica",
    materialType: "student-workbook",
    language: "es-PE",
    description:
      "Situaciones de la vida cotidiana para construir, comprobar y evaluar aprendizajes matemáticos.",
    pages: 100,
    sourceLabel: "Repositorio Institucional del MINEDU",
    sourcePageUrl:
      "https://repositorio.minedu.gob.pe/handle/20.500.12799/10834",
    sourcePdfUrl:
      "https://repositorio.minedu.gob.pe/bitstream/handle/20.500.12799/10834/Fichas%20de%20Matem%C3%A1tica%201.pdf?isAllowed=y&sequence=1",
    discoveredViaUrl:
      "https://librosescolaresperu.com/1-secundaria/fichas-de-matematica/",
    storageFile: "fichas-matematica-1-secundaria.pdf",
    expectedBytes: 32_895_443,
    expectedSha256:
      "c220ec82ed676a813977d61afea236e761c5253ef0beb0b0de9afccaf2eeaac0",
    edition: "Primera reimpresión, setiembre de 2024",
    licenseName: "Creative Commons Atribución 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    licenseBasis: "official-repository-metadata",
    licenseEvidenceUrl:
      "https://repositorio.minedu.gob.pe/handle/20.500.12799/10834?show=full",
    licenseReviewedAt: "2026-07-24",
    attribution:
      "Ministerio de Educación del Perú; Larisa Mansilla Fernández; Olber Muñoz Solís; Juan Carlos Chávez Espino; Hugo Luis Támara Salazar; Hubner Luque Cristóbal Jave; Enrique García Manyari; Emilia Gabriela Del Busto Sipán",
    provenance: "official-minedu"
  },
  {
    id: "fichas-matematica-2-secundaria",
    status: "ready",
    title: "Fichas de Matemática 2",
    levelId: "secundaria",
    gradeNumber: 2,
    courseId: "matematica",
    materialType: "student-workbook",
    language: "es-PE",
    description:
      "Problemas cotidianos para desarrollar fracciones, funciones, geometría, estadística, porcentajes, progresiones y probabilidad.",
    pages: 100,
    sourceLabel: "Repositorio Institucional del MINEDU",
    sourcePageUrl:
      "https://repositorio.minedu.gob.pe/handle/20.500.12799/10835",
    sourcePdfUrl:
      "https://repositorio.minedu.gob.pe/bitstream/handle/20.500.12799/10835/Fichas%20de%20Matem%C3%A1tica%202.pdf?isAllowed=y&sequence=1",
    discoveredViaUrl:
      "https://librosescolaresperu.com/2-secundaria/fichas-de-matematica/",
    storageFile: "fichas-matematica-2-secundaria.pdf",
    expectedBytes: 31_997_485,
    expectedSha256:
      "c5c116ed7c6f091630e39d1cbeb0aa6fa2095157734daa33c5eb58ae470089a0",
    edition: "Primera reimpresión, setiembre de 2024",
    licenseName: "Creative Commons Atribución 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    licenseBasis: "official-repository-metadata",
    licenseEvidenceUrl:
      "https://repositorio.minedu.gob.pe/handle/20.500.12799/10835?show=full",
    licenseReviewedAt: "2026-07-24",
    attribution:
      "Ministerio de Educación del Perú; Larisa Mansilla Fernández; Olber Muñoz Solís; Juan Carlos Chávez Espino; Hugo Luis Támara Salazar; Hubner Luque Cristóbal Jave; Enrique García Manyari; Marilú Yésica Quispe Amar",
    provenance: "official-minedu"
  }
];

const gradeLabels: Readonly<Record<GradeNumber, string>> = {
  1: "1.er grado",
  2: "2.º grado",
  3: "3.er grado",
  4: "4.º grado",
  5: "5.º grado",
  6: "6.º grado"
};

export function isReadyCatalogEntry(
  entry: CatalogEntry
): entry is ReadyCatalogEntry {
  return entry.status === "ready";
}

function toBook(entry: ReadyCatalogEntry): Book {
  return {
    ...entry,
    level: educationLevels[entry.levelId].label,
    grade: gradeLabels[entry.gradeNumber],
    subject: courses[entry.courseId].label
  };
}

const publishedBooks: readonly Book[] = catalogEntries
  .filter(isReadyCatalogEntry)
  .map(toBook);

/**
 * Administrative view used by validation tooling. Callers serving students
 * must use `getBooks`, `getPublishedBooks` or `getBook`.
 */
export function getCatalogEntries(): readonly CatalogEntry[] {
  return catalogEntries;
}

export function getPublishedBooks(): readonly Book[] {
  return publishedBooks;
}

/**
 * Backwards-compatible public catalog. It deliberately exposes only ready
 * materials.
 */
export function getBooks(): readonly Book[] {
  return getPublishedBooks();
}

/**
 * Public lookup. Draft, reviewing and disabled entries behave as unavailable.
 */
export function getBook(id: string): Book | undefined {
  return publishedBooks.find((book) => book.id === id);
}

export function isAllowedOfficialSource(source: URL): boolean {
  return (
    source.protocol === "https:" &&
    ((source.hostname === "repositorios.perueduca.pe" &&
      source.pathname.startsWith("/pe-recursos/")) ||
      (source.hostname === "repositorio.minedu.gob.pe" &&
        source.pathname.startsWith("/bitstream/handle/")))
  );
}
