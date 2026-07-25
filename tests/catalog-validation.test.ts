import { describe, expect, it } from "vitest";

import {
  getBooks,
  getCatalogEntries,
  isCatalogEntrySafe,
  isPublishedTutorableCatalogEntry,
  isTutorableMaterialType,
  MAX_INGEST_PDF_BYTES,
  parseCatalogManifest,
  type CatalogEntry,
  type MaterialType,
  type CatalogStatus
} from "@/lib/catalog";
import { validateCatalogCurriculum } from "@/lib/catalog-validation";
import {
  getCurriculumEntries,
  isCurriculumStructureSafe,
  type BookCurriculum
} from "@/lib/curriculum";

const catalogStatuses = [
  "draft",
  "review",
  "published",
  "disabled"
] as const satisfies readonly CatalogStatus[];

const requiredCatalogFields = [
  "id",
  "status",
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
] as const;

function manifestWith(...entries: readonly unknown[]) {
  return {
    schemaVersion: 3,
    entries
  };
}

describe("catálogo curricular v3", () => {
  it("expone al estudiante únicamente materiales published", () => {
    const publishedIds = getCatalogEntries()
      .filter(
        (entry) =>
          entry.status === "published" &&
          isTutorableMaterialType(entry.materialType)
      )
      .map((entry) => entry.id);

    expect(getBooks().map((book) => book.id)).toEqual(publishedIds);
    expect(getBooks()[0]).toMatchObject({
      levelId: "secundaria",
      level: "Secundaria",
      gradeNumber: 1,
      grade: "1.er grado",
      courseId: "matematica",
      subject: "Matemática",
      licenseBasis: "official-repository-metadata",
      licenseReviewedAt: "2026-07-24",
      status: "published"
    });
  });

  it("valida el catálogo y currículo vigentes sin observaciones", () => {
    expect(validateCatalogCurriculum()).toEqual([]);
  });

  it.each(requiredCatalogFields)(
    "falla cerrado si una entrada published omite %s",
    (field) => {
      const mutated: Record<string, unknown> = {
        ...getCatalogEntries()[0]
      };
      delete mutated[field];

      const parsed = parseCatalogManifest(manifestWith(mutated));

      expect(parsed.entries).toEqual([]);
      expect(parsed.issues.length).toBeGreaterThan(0);
      expect(isCatalogEntrySafe(mutated)).toBe(false);
    }
  );

  it.each([
    ["materialType", "teacher-workbook", "catalog.invalid-material-type"],
    ["language", "es", "catalog.invalid-language"],
    ["provenance", "community-upload", "catalog.invalid-provenance"]
  ] as const)(
    "rechaza en runtime una entrada published con %s=%s",
    (field, value, expectedCode) => {
      const entry = {
        ...getCatalogEntries()[0],
        [field]: value
      };
      const parsed = parseCatalogManifest(manifestWith(entry));

      expect(parsed.entries).toEqual([]);
      expect(parsed.issues.map((issue) => issue.code)).toContain(
        expectedCode
      );
      expect(
        validateCatalogCurriculum(
          [entry],
          [getCurriculumEntries()[0]]
        ).map((issue) => issue.code)
      ).toContain(expectedCode);
    }
  );

  it("rechaza el manifiesto completo si una de varias entradas es inválida", () => {
    const [first, second] = getCatalogEntries();
    const poisoned = {
      ...second,
      language: "es-ES"
    };

    const parsed = parseCatalogManifest(
      manifestWith(first, poisoned)
    );

    expect(parsed.entries).toEqual([]);
    expect(parsed.issues.map((issue) => issue.code)).toContain(
      "catalog.invalid-language"
    );
  });

  it.each([
    "teacher-guide",
    "answer-key",
    "solution-manual"
  ] as const satisfies readonly MaterialType[])(
    "clasifica %s pero nunca lo publica como libro tutorable",
    (materialType) => {
      const entry = {
        ...getCatalogEntries()[0],
        status: "published",
        materialType
      } satisfies CatalogEntry;
      const curriculum = getCurriculumEntries()[0];

      expect(isCatalogEntrySafe(entry)).toBe(true);
      expect(
        parseCatalogManifest(manifestWith(entry)).entries.filter(
          isPublishedTutorableCatalogEntry
        )
      ).toEqual([]);
      expect(
        validateCatalogCurriculum([entry], [curriculum]).map(
          (issue) => issue.code
        )
      ).toContain("curriculum.disallowed-material-type");
      expect(validateCatalogCurriculum([entry], [])).toEqual([]);
    }
  );

  it("rechaza fechas normalizables pero inexistentes", () => {
    const entry = {
      ...getCatalogEntries()[0],
      licenseReviewedAt: "2026-02-31"
    };

    expect(
      parseCatalogManifest(manifestWith(entry)).issues.map(
        (issue) => issue.code
      )
    ).toContain("catalog.invalid-license-review-date");
  });

  it.each(catalogStatuses)(
    "exige tamaño y checksum también en estado %s",
    (status) => {
      const entry = getCatalogEntries()[0];
      const withoutPins = {
        ...entry,
        status,
        expectedBytes: undefined,
        expectedSha256: undefined
      } as unknown as CatalogEntry;

      const issues = validateCatalogCurriculum(
        [withoutPins],
        [getCurriculumEntries()[0]]
      );
      const codes = issues.map((issue) => issue.code);

      expect(codes).toContain("catalog.invalid-bytes");
      expect(codes).toContain("catalog.invalid-checksum");
    }
  );

  it("acepta 50 MiB exactos y rechaza un byte adicional", () => {
    const entry = getCatalogEntries()[0];
    const atLimit = parseCatalogManifest(
      manifestWith({
        ...entry,
        expectedBytes: MAX_INGEST_PDF_BYTES
      })
    );
    const overLimit = parseCatalogManifest(
      manifestWith({
        ...entry,
        expectedBytes: MAX_INGEST_PDF_BYTES + 1
      })
    );

    expect(atLimit.issues).toEqual([]);
    expect(atLimit.entries).toHaveLength(1);
    expect(overLimit.entries).toEqual([]);
    expect(overLimit.issues.map((issue) => issue.code)).toContain(
      "catalog.invalid-bytes"
    );
  });

  it.each(["ready", "reviewing"] as const)(
    "rechaza el estado legado %s",
    (status) => {
      const entry = {
        ...getCatalogEntries()[0],
        status
      } as unknown as CatalogEntry;

      expect(
        validateCatalogCurriculum(
          [entry],
          [getCurriculumEntries()[0]]
        ).map((issue) => issue.code)
      ).toContain("catalog.invalid-status");
    }
  );

  it("rechaza un material published sin currículo", () => {
    const issues = validateCatalogCurriculum(getCatalogEntries(), []);

    expect(issues.map((issue) => issue.code)).toContain(
      "catalog.published-missing-curriculum"
    );
  });

  it("rechaza orientación 1..pages con units=[] y falla cerrado", () => {
    const entry = getCatalogEntries()[0];
    const curriculum = getCurriculumEntries()[0];
    const bypass: BookCurriculum = {
      ...curriculum,
      orientation: {
        ...curriculum.orientation,
        startPage: 1,
        endPage: entry.pages
      },
      units: []
    };

    const codes = validateCatalogCurriculum([entry], [bypass]).map(
      (issue) => issue.code
    );

    expect(codes).toContain("curriculum.empty-units");
    expect(isCurriculumStructureSafe(bypass, entry.pages)).toBe(false);
  });

  it("exige learn → practice → assessment aunque no haya huecos", () => {
    const curriculum = getCurriculumEntries()[0];
    const firstUnit = curriculum.units[0];
    const [learn, practice, assessment] = firstUnit.sections;
    const unsafe: BookCurriculum = {
      ...curriculum,
      units: [
        {
          ...firstUnit,
          sections: [
            learn,
            { ...practice, endPage: assessment.endPage }
          ]
        },
        ...curriculum.units.slice(1)
      ]
    };

    const codes = validateCatalogCurriculum(
      getCatalogEntries(),
      [unsafe, ...getCurriculumEntries().slice(1)]
    ).map((issue) => issue.code);

    expect(codes).toContain("curriculum.invalid-stage-structure");
    expect(isCurriculumStructureSafe(unsafe, 100)).toBe(false);
  });

  it("falla cerrado si dos unidades comparten identificador", () => {
    const curriculum = getCurriculumEntries()[0];
    const duplicateUnitId: BookCurriculum = {
      ...curriculum,
      units: curriculum.units.map((unit, index) =>
        index === 1 ? { ...unit, id: curriculum.units[0].id } : unit
      )
    };

    const codes = validateCatalogCurriculum(
      getCatalogEntries(),
      [duplicateUnitId, ...getCurriculumEntries().slice(1)]
    ).map((issue) => issue.code);

    expect(codes).toContain("curriculum.invalid-unit-id");
    expect(isCurriculumStructureSafe(duplicateUnitId, 100)).toBe(false);
  });

  it("detecta huecos y solapes entre etapas", () => {
    const curriculum = getCurriculumEntries()[0];
    const firstUnit = curriculum.units[0];
    const [learn, practice, ...remainingSections] = firstUnit.sections;
    const broken: BookCurriculum = {
      ...curriculum,
      units: [
        {
          ...firstUnit,
          sections: [
            { ...learn, startPage: learn.startPage + 1 },
            { ...practice, startPage: practice.startPage - 1 },
            ...remainingSections
          ]
        },
        ...curriculum.units.slice(1)
      ]
    };

    const issues = validateCatalogCurriculum(getCatalogEntries(), [broken]);
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain("curriculum.unit-page-gap");
    expect(codes).toContain("curriculum.unit-page-overlap");
    expect(codes).toContain("curriculum.page-gap");
    expect(codes).toContain("curriculum.page-overlap");
  });
});
