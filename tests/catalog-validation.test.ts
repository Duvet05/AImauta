import { describe, expect, it } from "vitest";

import {
  getBooks,
  getCatalogEntries,
  type CatalogEntry
} from "@/lib/catalog";
import {
  validateCatalogCurriculum
} from "@/lib/catalog-validation";
import {
  getCurriculumEntries,
  type BookCurriculum
} from "@/lib/curriculum";

describe("catálogo curricular v2", () => {
  it("expone al estudiante únicamente materiales ready", () => {
    const readyIds = getCatalogEntries()
      .filter((entry) => entry.status === "ready")
      .map((entry) => entry.id);

    expect(getBooks().map((book) => book.id)).toEqual(readyIds);
    expect(getBooks()[0]).toMatchObject({
      levelId: "secundaria",
      level: "Secundaria",
      gradeNumber: 1,
      grade: "1.er grado",
      courseId: "matematica",
      subject: "Matemática",
      licenseBasis: "official-repository-metadata",
      licenseReviewedAt: "2026-07-24",
      status: "ready"
    });
  });

  it("valida el catálogo y currículo vigentes sin observaciones", () => {
    expect(validateCatalogCurriculum()).toEqual([]);
  });

  it("rechaza un material ready sin checksum fijado", () => {
    const entry = getCatalogEntries()[0];
    const withoutChecksum = {
      ...entry,
      expectedSha256: undefined
    } as unknown as CatalogEntry;

    const issues = validateCatalogCurriculum(
      [withoutChecksum],
      getCurriculumEntries()
    );

    expect(issues.map((issue) => issue.code)).toContain(
      "catalog.ready-invalid-checksum"
    );
  });

  it("permite que un borrador todavía no tenga checksum", () => {
    const entry = getCatalogEntries()[0];
    const draft = {
      ...entry,
      status: "draft",
      expectedBytes: undefined,
      expectedSha256: undefined
    } as unknown as CatalogEntry;

    const issues = validateCatalogCurriculum(
      [draft],
      getCurriculumEntries()
    );

    expect(issues.map((issue) => issue.code)).not.toContain(
      "catalog.ready-invalid-checksum"
    );
    expect(issues.map((issue) => issue.code)).not.toContain(
      "catalog.ready-missing-bytes"
    );
  });

  it("rechaza un material ready sin currículo", () => {
    const issues = validateCatalogCurriculum(getCatalogEntries(), []);

    expect(issues.map((issue) => issue.code)).toContain(
      "catalog.ready-missing-curriculum"
    );
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
