import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getBook,
  getCatalogEntries,
  type Book,
} from "@/lib/catalog";
import { getBookCurriculum } from "@/lib/curriculum";
import {
  EXERCISE_COORDINATE_SPACE,
  type PrivateExerciseSolutionsManifest,
  type PublicExerciseManifest,
} from "@/lib/exercise-manifest";
import { EXERCISE_INGEST_CONTRACT_VERSION } from "@/lib/gemma-ingest";
import {
  BOOK_INDEX_VERSION,
  INDEX_EXTRACTOR_VERSION,
} from "@/lib/retrieval";
import {
  promoteExerciseRelease,
  validateExerciseIngestionReport,
  validateReviewedExerciseRelease,
  verifyRuntimeBookArtifacts,
  type RuntimeBookArtifactVerification,
} from "@/scripts/exercise-release-promotion";
import { directChildPath } from "@/scripts/private-runtime-paths";

const catalogEntry = getCatalogEntries()[0];
const operatorUid = process.getuid?.() ?? -1;
const temporaryRoots: string[] = [];
const fixtureRuntimeArtifacts: RuntimeBookArtifactVerification = {
  pdfSha256: catalogEntry.expectedSha256,
  pdfBytes: catalogEntry.expectedBytes,
  pdfPages: catalogEntry.pages,
  indexSha256: "1".repeat(64),
  indexBytes: 1_024,
  indexChunks: 10,
};

function verifiedFixtureRuntime(): RuntimeBookArtifactVerification {
  return fixtureRuntimeArtifacts;
}

function publicManifest(
  revision = 1,
  status: "draft" | "review" | "published" | "disabled" = "published",
): PublicExerciseManifest {
  return {
    schemaVersion: 1,
    bookId: catalogEntry.id,
    sourceSha256: catalogEntry.expectedSha256,
    pageCount: catalogEntry.pages,
    coordinateSpace: EXERCISE_COORDINATE_SPACE,
    renderVersion: "pdfjs-6.1.200@2x",
    model: "gemma-release-test",
    generatedAt: "2026-07-25T00:00:00.000Z",
    exercises: [
      {
        id: "ejercicio-release",
        status,
        unitId: "ficha-1-fracciones",
        stage: "learn",
        revision,
        label: "Problema 1",
        title: `Fracciones, revisión ${revision}`,
        prompt: `¿Qué fracción corresponde? Revisión ${revision}.`,
        regions: [
          {
            id: "ejercicio-release-pregunta",
            page: 13,
            role: "prompt",
            order: 1,
            rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.25 },
          },
        ],
      },
    ],
  };
}

function privateManifest(
  revision = 1,
): PrivateExerciseSolutionsManifest {
  return {
    schemaVersion: 1,
    bookId: catalogEntry.id,
    sourceSha256: catalogEntry.expectedSha256,
    model: "gemma-release-test",
    generatedAt: "2026-07-25T00:01:00.000Z",
    solutions: [
      {
        exerciseId: "ejercicio-release",
        revision,
        reviewed: true,
        finalAnswer: `Respuesta revisada ${revision}.`,
        pedagogicalSteps: ["Identifica el total.", "Compara las partes."],
        hints: [
          { level: 1, text: "Observa el total." },
          { level: 2, text: "Cuenta las partes iguales." },
          { level: 3, text: "Relaciona parte y total." },
        ],
        rubric: [
          {
            criterion: "Identifica el total",
            expectedEvidence: "Explica cuántas partes forman la unidad.",
          },
        ],
        confidence: 0.96,
      },
    ],
  };
}

function ingestionReport(): Record<string, unknown> {
  return {
    schemaVersion: 3,
    bookId: catalogEntry.id,
    sourceSha256: catalogEntry.expectedSha256,
    provider: "ollama",
    endpointScope: "loopback",
    contractVersion: EXERCISE_INGEST_CONTRACT_VERSION,
    model: "gemma-release-test",
    generatedAt: "2026-07-25T00:00:00.000Z",
    exerciseCount: 1,
    reviewRequired: true,
    coverage: {
      pageCount: catalogEntry.pages,
      pagesReviewed: Array.from(
        { length: catalogEntry.pages },
        (_, index) => {
          const page = index + 1;
          return {
            page,
            status:
              page === 13 ? "exercise_found" : "no_exercise",
            candidateCount: page === 13 ? 1 : 0,
          };
        },
      ),
      blockers: [],
    },
    issues: [],
  };
}

async function secureDirectory(
  directory: string,
  mode: number,
): Promise<void> {
  await mkdir(directory, { recursive: false, mode });
  await chmod(directory, mode);
}

async function testLayout(jobId = "job-test"): Promise<{
  root: string;
  ingestRoot: string;
  runtimeRoot: string;
  jobDirectory: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "aimauta-release-promotion-"),
  );
  temporaryRoots.push(root);
  const ingestRoot = path.join(root, "ingest");
  const jobs = path.join(ingestRoot, "jobs");
  const jobDirectory = path.join(jobs, jobId);
  const runtimeRoot = path.join(root, "runtime");
  const manifests = path.join(runtimeRoot, "manifests");

  await secureDirectory(ingestRoot, 0o700);
  await secureDirectory(jobs, 0o700);
  await secureDirectory(jobDirectory, 0o700);
  await secureDirectory(runtimeRoot, 0o750);
  await secureDirectory(path.join(runtimeRoot, "content"), 0o750);
  await secureDirectory(path.join(runtimeRoot, "indexes"), 0o750);
  await secureDirectory(manifests, 0o750);
  await secureDirectory(path.join(manifests, "exercises"), 0o750);
  await secureDirectory(
    path.join(runtimeRoot, "exercise-solutions"),
    0o750,
  );
  await secureDirectory(path.join(runtimeRoot, "releases"), 0o750);

  return { root, ingestRoot, runtimeRoot, jobDirectory };
}

async function writeReviewedPair(
  jobDirectory: string,
  revision: number,
): Promise<void> {
  const publicPath = path.join(
    jobDirectory,
    `${catalogEntry.id}.public.reviewed.json`,
  );
  const privatePath = path.join(
    jobDirectory,
    `${catalogEntry.id}.private.reviewed.json`,
  );
  const reportPath = path.join(
    jobDirectory,
    `${catalogEntry.id}.ingestion-report.json`,
  );
  await writeFile(publicPath, JSON.stringify(publicManifest(revision)), {
    mode: 0o600,
  });
  await writeFile(privatePath, JSON.stringify(privateManifest(revision)), {
    mode: 0o600,
  });
  await writeFile(reportPath, JSON.stringify(ingestionReport()), {
    mode: 0o600,
  });
  await chmod(publicPath, 0o600);
  await chmod(privatePath, 0o600);
  await chmod(reportPath, 0o600);
}

function onePagePdf(): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += object;
  }
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n`;
  document += "0000000000 65535 f \n";
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

function runtimeIndex(book: Book): Record<string, unknown> {
  const curriculum = getBookCurriculum(book.id);
  if (!curriculum) {
    throw new Error("fixture sin currículo");
  }
  return {
    version: BOOK_INDEX_VERSION,
    extractorVersion: INDEX_EXTRACTOR_VERSION,
    generatedAt: "2026-07-25T00:05:00.000Z",
    bookId: book.id,
    sourceSha256: book.expectedSha256,
    pageCount: book.pages,
    taxonomy: {
      levelId: book.levelId,
      gradeNumber: book.gradeNumber,
      courseId: book.courseId,
      materialType: book.materialType,
      language: book.language,
    },
    curriculum: { version: curriculum.version },
    quality: {
      missing: Array.from(
        { length: book.pages },
        (_, index) => index + 1,
      ).filter((page) => page !== 1),
      outliers: [],
      teacherOnly: { chunkCount: 0, pages: [] },
    },
    license: {
      name: book.licenseName,
      url: book.licenseUrl,
      attribution: book.attribution,
    },
    chunks: [
      {
        id: `${book.id}:p1:c1`,
        page: 1,
        text: "Material de orientación verificado.",
        kind: "instruction",
        teacherOnly: false,
        stage: "orientation",
        unitId: null,
      },
    ],
  };
}

async function writeRuntimeArtifacts(
  runtimeRoot: string,
  book: Book,
  pdf: Buffer,
  index: unknown = runtimeIndex(book),
): Promise<void> {
  const pdfPath = path.join(runtimeRoot, "content", book.storageFile);
  const indexPath = path.join(
    runtimeRoot,
    "indexes",
    `${book.id}.json`,
  );
  await writeFile(pdfPath, pdf, { mode: 0o640 });
  await writeFile(indexPath, JSON.stringify(index), { mode: 0o640 });
  await chmod(pdfPath, 0o640);
  await chmod(indexPath, 0o640);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("validación y rutas de promoción", () => {
  it("rechaza escapes y rutas anidadas fuera del job directo", () => {
    const jobs = path.join(tmpdir(), "ingest", "jobs");
    expect(
      directChildPath(jobs, path.join(jobs, "job-seguro")),
    ).toBe(path.join(jobs, "job-seguro"));
    expect(() =>
      directChildPath(jobs, path.join(jobs, "..", "escape")),
    ).toThrow();
    expect(() =>
      directChildPath(jobs, path.join(jobs, "grupo", "job")),
    ).toThrow();
  });

  it("exige revisión completa y al menos un ejercicio publicado", () => {
    expect(() =>
      validateReviewedExerciseRelease(
        publicManifest(1, "review"),
        privateManifest(1),
        catalogEntry.id,
      ),
    ).toThrow(/exercise\.pending/u);

    expect(() =>
      validateReviewedExerciseRelease(
        publicManifest(1, "disabled"),
        privateManifest(1),
        catalogEntry.id,
      ),
    ).toThrow(/exercise\.none-published/u);
  });

  it("exige cobertura completa, única y coherente antes de promover", () => {
    const manifest = publicManifest();
    expect(
      validateExerciseIngestionReport(ingestionReport(), manifest),
    ).toMatchObject({
      pageCount: catalogEntry.pages,
      reviewedPages: catalogEntry.pages,
    });

    const duplicate = ingestionReport();
    const duplicateCoverage = duplicate.coverage as {
      pagesReviewed: Array<Record<string, unknown>>;
    };
    duplicateCoverage.pagesReviewed[1] = {
      ...duplicateCoverage.pagesReviewed[1],
      page: 1,
    };
    expect(() =>
      validateExerciseIngestionReport(duplicate, manifest),
    ).toThrow(/coverage\.(?:duplicate-page|missing-page)/u);

    const contradictory = ingestionReport();
    const contradictoryCoverage = contradictory.coverage as {
      pagesReviewed: Array<Record<string, unknown>>;
    };
    contradictoryCoverage.pagesReviewed[12] = {
      page: 13,
      status: "no_exercise",
      candidateCount: 1,
    };
    expect(() =>
      validateExerciseIngestionReport(contradictory, manifest),
    ).toThrow(/coverage\.no-exercise-has-candidates/u);

    const emptyFound = ingestionReport();
    const emptyFoundCoverage = emptyFound.coverage as {
      pagesReviewed: Array<Record<string, unknown>>;
    };
    emptyFoundCoverage.pagesReviewed[12] = {
      page: 13,
      status: "exercise_found",
      candidateCount: 0,
    };
    expect(() =>
      validateExerciseIngestionReport(emptyFound, manifest),
    ).toThrow(/coverage\.exercise-found-empty/u);

    const uncertain = ingestionReport();
    const uncertainCoverage = uncertain.coverage as {
      pagesReviewed: Array<Record<string, unknown>>;
      blockers: Array<Record<string, unknown>>;
    };
    uncertainCoverage.pagesReviewed[12] = {
      page: 13,
      status: "uncertain",
      candidateCount: 1,
    };
    uncertainCoverage.blockers = [
      { code: "page-uncertain", page: 13 },
    ];
    expect(() =>
      validateExerciseIngestionReport(uncertain, manifest),
    ).toThrow(/coverage\.(?:uncertain-page|blocker)/u);

    const unresolved = ingestionReport();
    unresolved.issues = [
      {
        code: "candidate-low-confidence",
        candidateId: "candidate-1",
      },
    ];
    expect(() =>
      validateExerciseIngestionReport(unresolved, manifest),
    ).toThrow(/coverage\.unresolved-issue/u);

    const resolved = ingestionReport();
    resolved.issues = [
      {
        code: "candidate-low-confidence",
        candidateId: "candidate-1",
        resolution: "accepted-after-review",
        resolutionNote: "La región fue cotejada con el PDF.",
        reviewedAt: "2026-07-25T12:00:00.000Z",
      },
    ];
    expect(
      validateExerciseIngestionReport(resolved, manifest),
    ).toMatchObject({
      pageCount: catalogEntry.pages,
      reviewedPages: catalogEntry.pages,
    });
  });
});

describe.skipIf(operatorUid <= 0)(
  "integridad del PDF e índice runtime",
  () => {
    it("verifica archivo real, checksum, páginas e índice curricular", async () => {
      const layout = await testLayout("job-artifacts");
      const pdf = onePagePdf();
      const sourceBook = getBook(catalogEntry.id);
      if (!sourceBook) {
        throw new Error("fixture sin libro");
      }
      const book: Book = {
        ...sourceBook,
        pages: 1,
        expectedBytes: pdf.byteLength,
        expectedSha256: createHash("sha256")
          .update(pdf)
          .digest("hex"),
      };
      await writeRuntimeArtifacts(layout.runtimeRoot, book, pdf);

      await expect(
        verifyRuntimeBookArtifacts({
          runtimeRoot: layout.runtimeRoot,
          book,
          expectedUid: operatorUid,
        }),
      ).resolves.toMatchObject({
        pdfSha256: book.expectedSha256,
        pdfBytes: pdf.byteLength,
        pdfPages: 1,
        indexChunks: 1,
      });
    });

    it("rechaza un número físico de páginas distinto del catálogo", async () => {
      const layout = await testLayout("job-page-mismatch");
      const pdf = onePagePdf();
      const sourceBook = getBook(catalogEntry.id);
      if (!sourceBook) {
        throw new Error("fixture sin libro");
      }
      const book: Book = {
        ...sourceBook,
        pages: 2,
        expectedBytes: pdf.byteLength,
        expectedSha256: createHash("sha256")
          .update(pdf)
          .digest("hex"),
      };
      await writeRuntimeArtifacts(layout.runtimeRoot, book, pdf);

      await expect(
        verifyRuntimeBookArtifacts({
          runtimeRoot: layout.runtimeRoot,
          book,
          expectedUid: operatorUid,
        }),
      ).rejects.toThrow(/cantidad física de páginas/u);
    });

    it("rechaza checksum e identidad de índice que no coinciden", async () => {
      const layout = await testLayout("job-integrity-mismatch");
      const pdf = onePagePdf();
      const sourceBook = getBook(catalogEntry.id);
      if (!sourceBook) {
        throw new Error("fixture sin libro");
      }
      const digest = createHash("sha256").update(pdf).digest("hex");
      const book: Book = {
        ...sourceBook,
        pages: 1,
        expectedBytes: pdf.byteLength,
        expectedSha256: digest,
      };
      const mismatchedIndex = {
        ...runtimeIndex(book),
        sourceSha256: "0".repeat(64),
      };
      await writeRuntimeArtifacts(
        layout.runtimeRoot,
        book,
        pdf,
        mismatchedIndex,
      );

      await expect(
        verifyRuntimeBookArtifacts({
          runtimeRoot: layout.runtimeRoot,
          book,
          expectedUid: operatorUid,
        }),
      ).rejects.toThrow(/checksum fuente del índice RAG/u);

      const wrongChecksumBook: Book = {
        ...book,
        expectedSha256: "f".repeat(64),
      };
      await expect(
        verifyRuntimeBookArtifacts({
          runtimeRoot: layout.runtimeRoot,
          book: wrongChecksumBook,
          expectedUid: operatorUid,
        }),
      ).rejects.toThrow(/checksum SHA-256 del PDF real/u);
    });
  },
);

describe.skipIf(operatorUid <= 0)("promoción atómica de ejercicios", () => {
  it("activa público y privado en un solo bundle y conserva snapshots", async () => {
    const layout = await testLayout();
    await writeReviewedPair(layout.jobDirectory, 1);

    const first = await promoteExerciseRelease({
      jobId: "job-test",
      bookId: catalogEntry.id,
      ingestRoot: layout.ingestRoot,
      runtimeRoot: layout.runtimeRoot,
      releaseId: "release-test-1",
      currentUid: operatorUid,
      now: () => new Date("2026-07-25T00:10:00.000Z"),
      hooks: {
        verifyRuntimeArtifacts: async () => {
          await expect(
            lstat(
              path.join(
                layout.runtimeRoot,
                ".exercise-release.lock",
              ),
            ),
          ).rejects.toMatchObject({ code: "ENOENT" });
          return verifiedFixtureRuntime();
        },
      },
    });
    expect(first.previousReleaseSnapshot).toBe(false);

    await writeReviewedPair(layout.jobDirectory, 2);
    let observedAtomicBundle = false;
    const publicDestination = path.join(
      layout.runtimeRoot,
      "manifests",
      "exercises",
      `${catalogEntry.id}.public.json`,
    );
    const privateDestination = path.join(
      layout.runtimeRoot,
      "exercise-solutions",
      `${catalogEntry.id}.private.json`,
    );
    const bundleDestination = path.join(
      layout.runtimeRoot,
      "exercise-solutions",
      `${catalogEntry.id}.release.json`,
    );
    const second = await promoteExerciseRelease({
      jobId: "job-test",
      bookId: catalogEntry.id,
      ingestRoot: layout.ingestRoot,
      runtimeRoot: layout.runtimeRoot,
      releaseId: "release-test-2",
      currentUid: operatorUid,
      now: () => new Date("2026-07-25T00:20:00.000Z"),
      hooks: {
        verifyRuntimeArtifacts: verifiedFixtureRuntime,
        afterBundleActivation: async () => {
          const activeBundle = JSON.parse(
            await readFile(bundleDestination, "utf8"),
          );
          expect(
            activeBundle.privateManifest.solutions[0].revision,
          ).toBe(2);
          expect(
            activeBundle.publicManifest.exercises[0].revision,
          ).toBe(2);
          // Compatibility mirrors have not moved yet, but no reader can mix
          // them with the authoritative bundle.
          expect(
            JSON.parse(
              await readFile(privateDestination, "utf8"),
            ).solutions[0].revision,
          ).toBe(1);
          expect(
            JSON.parse(
              await readFile(publicDestination, "utf8"),
            ).exercises[0].revision,
          ).toBe(1);
          observedAtomicBundle = true;
        },
      },
    });

    expect(second).toMatchObject({
      releaseId: "release-test-2",
      publishedExercises: 1,
      previousReleaseSnapshot: true,
    });
    expect(observedAtomicBundle).toBe(true);
    expect(
      JSON.parse(await readFile(publicDestination, "utf8")).exercises[0]
        .revision,
    ).toBe(2);
    expect(
      JSON.parse(await readFile(privateDestination, "utf8")).solutions[0]
        .revision,
    ).toBe(2);
    expect((await lstat(publicDestination)).mode & 0o777).toBe(0o640);
    expect((await lstat(privateDestination)).mode & 0o777).toBe(0o640);
    expect((await lstat(bundleDestination)).mode & 0o777).toBe(0o640);

    const snapshotRoot = path.join(
      layout.runtimeRoot,
      "releases",
      "release-test-2",
    );
    await expect(
      readFile(
        path.join(
          snapshotRoot,
          "new",
          `${catalogEntry.id}.public.json`,
        ),
      ),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(
        path.join(
          snapshotRoot,
          "new",
          `${catalogEntry.id}.release.json`,
        ),
      ),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(
        path.join(
          snapshotRoot,
          "new",
          `${catalogEntry.id}.ingestion-report.json`,
        ),
      ),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(
        path.join(
          snapshotRoot,
          "previous",
          `${catalogEntry.id}.private.json`,
        ),
      ),
    ).resolves.toBeInstanceOf(Buffer);
    const releaseMetadata = JSON.parse(
      await readFile(
        path.join(snapshotRoot, "release.json"),
        "utf8",
      ),
    );
    expect(releaseMetadata).toMatchObject({
      status: "published",
      runtimeArtifacts: fixtureRuntimeArtifacts,
      coverageReport: {
        pageCount: catalogEntry.pages,
        reviewedPages: catalogEntry.pages,
      },
    });
  });

  it("rechaza la promoción si falta el reporte de cobertura", async () => {
    const layout = await testLayout("job-without-coverage");
    await writeReviewedPair(layout.jobDirectory, 1);
    await rm(
      path.join(
        layout.jobDirectory,
        `${catalogEntry.id}.ingestion-report.json`,
      ),
    );

    await expect(
      promoteExerciseRelease({
        jobId: "job-without-coverage",
        bookId: catalogEntry.id,
        ingestRoot: layout.ingestRoot,
        runtimeRoot: layout.runtimeRoot,
        releaseId: "release-without-coverage",
        currentUid: operatorUid,
        hooks: {
          verifyRuntimeArtifacts: verifiedFixtureRuntime,
        },
      }),
    ).rejects.toThrow(/reporte de cobertura/u);

    await expect(
      lstat(
        path.join(
          layout.runtimeRoot,
          "manifests",
          "exercises",
          `${catalogEntry.id}.public.json`,
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recupera un lock antiguo sólo cuando su proceso ya no existe", async () => {
    const layout = await testLayout("job-stale-lock");
    await writeReviewedPair(layout.jobDirectory, 1);
    const lockPath = path.join(
      layout.runtimeRoot,
      ".exercise-release.lock",
    );
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: 2_147_483_647,
        uid: operatorUid,
        createdAt: "2020-01-01T00:00:00.000Z",
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(lockPath, 0o600);

    await expect(
      promoteExerciseRelease({
        jobId: "job-stale-lock",
        bookId: catalogEntry.id,
        ingestRoot: layout.ingestRoot,
        runtimeRoot: layout.runtimeRoot,
        releaseId: "release-after-stale-lock",
        currentUid: operatorUid,
        hooks: {
          verifyRuntimeArtifacts: verifiedFixtureRuntime,
        },
      }),
    ).resolves.toMatchObject({
      releaseId: "release-after-stale-lock",
    });
    await expect(lstat(lockPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restaura el bundle anterior si falla después de activarlo", async () => {
    const layout = await testLayout();
    await writeReviewedPair(layout.jobDirectory, 1);
    await promoteExerciseRelease({
      jobId: "job-test",
      bookId: catalogEntry.id,
      ingestRoot: layout.ingestRoot,
      runtimeRoot: layout.runtimeRoot,
      releaseId: "release-rollback-1",
      currentUid: operatorUid,
      hooks: {
        verifyRuntimeArtifacts: verifiedFixtureRuntime,
      },
    });

    const publicDestination = path.join(
      layout.runtimeRoot,
      "manifests",
      "exercises",
      `${catalogEntry.id}.public.json`,
    );
    const privateDestination = path.join(
      layout.runtimeRoot,
      "exercise-solutions",
      `${catalogEntry.id}.private.json`,
    );
    const bundleDestination = path.join(
      layout.runtimeRoot,
      "exercise-solutions",
      `${catalogEntry.id}.release.json`,
    );
    const previousPublic = await readFile(publicDestination);
    const previousPrivate = await readFile(privateDestination);
    const previousBundle = await readFile(bundleDestination);

    await writeReviewedPair(layout.jobDirectory, 2);
    await expect(
      promoteExerciseRelease({
        jobId: "job-test",
        bookId: catalogEntry.id,
        ingestRoot: layout.ingestRoot,
        runtimeRoot: layout.runtimeRoot,
        releaseId: "release-rollback-2",
        currentUid: operatorUid,
        hooks: {
          verifyRuntimeArtifacts: verifiedFixtureRuntime,
          afterBundleActivation: () => {
            throw new Error("fallo simulado tras activar el bundle");
          },
        },
      }),
    ).rejects.toThrow(/restaurado/u);

    await expect(readFile(publicDestination)).resolves.toEqual(
      previousPublic,
    );
    await expect(readFile(privateDestination)).resolves.toEqual(
      previousPrivate,
    );
    await expect(readFile(bundleDestination)).resolves.toEqual(
      previousBundle,
    );
    await expect(
      lstat(path.join(layout.runtimeRoot, ".exercise-release.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rechaza un job enlazado aunque apunte dentro del árbol privado", async () => {
    const layout = await testLayout("job-real");
    const jobs = path.join(layout.ingestRoot, "jobs");
    await symlink(
      layout.jobDirectory,
      path.join(jobs, "job-enlazado"),
      "dir",
    );

    await expect(
      promoteExerciseRelease({
        jobId: "job-enlazado",
        bookId: catalogEntry.id,
        ingestRoot: layout.ingestRoot,
        runtimeRoot: layout.runtimeRoot,
        releaseId: "release-symlink",
        currentUid: operatorUid,
      }),
    ).rejects.toThrow();
  });
});
