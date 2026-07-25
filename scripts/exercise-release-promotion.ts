import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { getBook, type Book } from "@/lib/catalog";
import {
  getBookCurriculum,
  getPageActivity,
  type LearningStage,
} from "@/lib/curriculum";
import {
  parsePrivateExerciseSolutionsManifest,
  parsePublicExerciseManifest,
  validateExerciseManifests,
  type PrivateExerciseSolutionsManifest,
  type PublicExerciseManifest,
} from "@/lib/exercise-manifest";
import {
  BOOK_INDEX_VERSION,
  INDEX_EXTRACTOR_VERSION,
} from "@/lib/retrieval";
import {
  absoluteConfiguredRoot,
  assertOwnedDirectory,
  currentNonRootUid,
  directChildPath,
  readStableOwnedFile,
} from "@/scripts/private-runtime-paths";

const DEFAULT_INGEST_ROOT = "/home/hii1sc/aimauta-ingest";
const DEFAULT_RUNTIME_ROOT = "/home/hii1sc/aimauta-runtime";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS_PER_PAGE = 50;
const MAX_CHUNK_TEXT_LENGTH = 50_000;
const MAX_CHUNK_ID_LENGTH = 240;
const safeIdPattern = /^[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/u;
const allowedIndexKinds = new Set([
  "content",
  "exercise",
  "instruction",
]);
const allowedIndexStages = new Set<LearningStage>([
  "orientation",
  "learn",
  "practice",
  "assessment",
]);

export class ExerciseReleasePromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExerciseReleasePromotionError";
  }
}

export type ValidatedExerciseRelease = {
  publicManifest: PublicExerciseManifest;
  privateManifest: PrivateExerciseSolutionsManifest;
  publicBytes: Buffer;
  privateBytes: Buffer;
};

export type ExerciseReleasePromotionInput = {
  jobId: string;
  bookId: string;
  ingestRoot?: string;
  runtimeRoot?: string;
  releaseId?: string;
  currentUid?: number;
  now?: () => Date;
  hooks?: {
    afterPrivateActivation?: () => void | Promise<void>;
    /**
     * Transaction tests replace only this expensive read. The CLI never
     * exposes the hook and production always uses the real verifier.
     */
    verifyRuntimeArtifacts?: (
      input: RuntimeBookArtifactVerificationInput,
    ) =>
      | RuntimeBookArtifactVerification
      | Promise<RuntimeBookArtifactVerification>;
  };
};

export type ExerciseReleasePromotionResult = {
  releaseId: string;
  bookId: string;
  publishedExercises: number;
  previousReleaseSnapshot: boolean;
};

export type RuntimeBookArtifactVerificationInput = {
  runtimeRoot: string;
  book: Book;
  expectedUid: number;
};

export type RuntimeBookArtifactVerification = {
  pdfSha256: string;
  pdfBytes: number;
  pdfPages: number;
  indexSha256: string;
  indexBytes: number;
  indexChunks: number;
};

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function artifactFailure(reason: string): never {
  throw new ExerciseReleasePromotionError(
    `Los artefactos runtime no pueden publicarse: ${reason}.`,
  );
}

function sameStringRecord(
  value: unknown,
  expected: Record<string, string | number>,
): boolean {
  return (
    isRecord(value) &&
    Object.entries(expected).every(
      ([key, expectedValue]) => value[key] === expectedValue,
    )
  );
}

function validateRuntimeBookIndex(
  value: unknown,
  book: Book,
): number {
  if (!isRecord(value)) {
    artifactFailure("el índice RAG no es un objeto JSON");
  }
  if (
    value.version !== BOOK_INDEX_VERSION ||
    value.extractorVersion !== INDEX_EXTRACTOR_VERSION ||
    value.bookId !== book.id ||
    value.sourceSha256 !== book.expectedSha256 ||
    value.pageCount !== book.pages
  ) {
    artifactFailure(
      "la versión, el libro, las páginas o el checksum fuente del índice RAG no coinciden",
    );
  }
  if (
    typeof value.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.generatedAt))
  ) {
    artifactFailure("generatedAt del índice RAG no es válido");
  }
  if (
    !sameStringRecord(value.taxonomy, {
      levelId: book.levelId,
      gradeNumber: book.gradeNumber,
      courseId: book.courseId,
      materialType: book.materialType,
      language: book.language,
    })
  ) {
    artifactFailure("la taxonomía del índice RAG no coincide");
  }

  const curriculum = getBookCurriculum(book.id);
  if (
    !curriculum ||
    !sameStringRecord(value.curriculum, {
      version: curriculum.version,
    })
  ) {
    artifactFailure("el currículo del índice RAG no coincide");
  }
  if (
    !sameStringRecord(value.license, {
      name: book.licenseName,
      url: book.licenseUrl,
      attribution: book.attribution,
    })
  ) {
    artifactFailure("la licencia del índice RAG no coincide");
  }
  if (
    !Array.isArray(value.chunks) ||
    value.chunks.length === 0 ||
    value.chunks.length > book.pages * MAX_CHUNKS_PER_PAGE
  ) {
    artifactFailure("la colección de fragmentos RAG es vacía o excesiva");
  }

  const chunkIds = new Set<string>();
  const coveredPages = new Set<number>();
  const teacherOnlyPages = new Set<number>();
  let teacherOnlyChunks = 0;
  const chunksPerPage = new Map<number, number>();

  for (const chunk of value.chunks) {
    if (
      !isRecord(chunk) ||
      typeof chunk.id !== "string" ||
      chunk.id.length < 1 ||
      chunk.id.length > MAX_CHUNK_ID_LENGTH ||
      chunkIds.has(chunk.id)
    ) {
      artifactFailure(
        "el índice RAG contiene fragmentos o identificadores inválidos",
      );
    }
    chunkIds.add(chunk.id);
    if (
      !isPositiveInteger(chunk.page) ||
      chunk.page > book.pages ||
      typeof chunk.text !== "string" ||
      chunk.text.length < 1 ||
      chunk.text.length > MAX_CHUNK_TEXT_LENGTH ||
      chunk.text !== chunk.text.trim() ||
      typeof chunk.kind !== "string" ||
      !allowedIndexKinds.has(chunk.kind) ||
      typeof chunk.teacherOnly !== "boolean" ||
      typeof chunk.stage !== "string" ||
      !allowedIndexStages.has(chunk.stage as LearningStage) ||
      (chunk.unitId !== null &&
        (typeof chunk.unitId !== "string" ||
          chunk.unitId.length === 0))
    ) {
      artifactFailure("un fragmento del índice RAG es inválido");
    }

    const activity = getPageActivity(book.id, chunk.page);
    if (
      (activity.stage === "assessment" &&
        activity.unitId === null) ||
      chunk.stage !== activity.stage ||
      chunk.unitId !== activity.unitId
    ) {
      artifactFailure(
        "un fragmento RAG no coincide con la clasificación curricular fail-closed",
      );
    }

    const pageChunkCount = (chunksPerPage.get(chunk.page) ?? 0) + 1;
    if (pageChunkCount > MAX_CHUNKS_PER_PAGE) {
      artifactFailure(
        "una página contiene demasiados fragmentos RAG",
      );
    }
    chunksPerPage.set(chunk.page, pageChunkCount);
    coveredPages.add(chunk.page);
    if (chunk.teacherOnly) {
      teacherOnlyChunks += 1;
      teacherOnlyPages.add(chunk.page);
    }
  }

  const expectedMissing = Array.from(
    { length: book.pages },
    (_, index) => index + 1,
  ).filter((page) => !coveredPages.has(page));
  const expectedTeacherOnlyPages = [...teacherOnlyPages].sort(
    (left, right) => left - right,
  );
  if (
    !isRecord(value.quality) ||
    !Array.isArray(value.quality.missing) ||
    value.quality.missing.some(
      (page, index) => page !== expectedMissing[index],
    ) ||
    value.quality.missing.length !== expectedMissing.length ||
    !Array.isArray(value.quality.outliers) ||
    !isRecord(value.quality.teacherOnly) ||
    value.quality.teacherOnly.chunkCount !== teacherOnlyChunks ||
    !Array.isArray(value.quality.teacherOnly.pages) ||
    value.quality.teacherOnly.pages.some(
      (page, index) => page !== expectedTeacherOnlyPages[index],
    ) ||
    value.quality.teacherOnly.pages.length !==
      expectedTeacherOnlyPages.length
  ) {
    artifactFailure("el reporte de calidad del índice RAG no coincide");
  }

  const outlierPages = new Set<number>();
  for (const outlier of value.quality.outliers) {
    if (
      !isRecord(outlier) ||
      !isPositiveInteger(outlier.page) ||
      outlier.page > book.pages ||
      !isPositiveInteger(outlier.wordCount) ||
      (outlier.direction !== "low" &&
        outlier.direction !== "high") ||
      outlierPages.has(outlier.page) ||
      expectedMissing.includes(outlier.page)
    ) {
      artifactFailure("quality.outliers del índice RAG es inválido");
    }
    outlierPages.add(outlier.page);
  }

  return value.chunks.length;
}

async function readPdfPageCount(contents: Buffer): Promise<number> {
  let loadingTask:
    | ReturnType<
        typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]
      >
    | undefined;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const documentOptions = {
      data: Uint8Array.from(contents),
      isEvalSupported: false,
      useSystemFonts: false,
    };
    loadingTask = pdfjs.getDocument(documentOptions);
    const document = await loadingTask.promise;
    return document.numPages;
  } catch {
    return artifactFailure(
      "el PDF real no puede analizarse de forma segura",
    );
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

/**
 * Verifies the exact deployed PDF and RAG index while holding stable,
 * no-follow file descriptors. A reviewed exercise release is never enough on
 * its own to make an unverified book public.
 */
export async function verifyRuntimeBookArtifacts(
  input: RuntimeBookArtifactVerificationInput,
): Promise<RuntimeBookArtifactVerification> {
  const contentDirectory = path.join(input.runtimeRoot, "content");
  const indexesDirectory = path.join(input.runtimeRoot, "indexes");
  await assertOwnedDirectory(input.runtimeRoot, input.expectedUid, 0o750);
  await assertOwnedDirectory(contentDirectory, input.expectedUid, 0o750);
  await assertOwnedDirectory(indexesDirectory, input.expectedUid, 0o750);

  const pdfPath = directChildPath(
    contentDirectory,
    path.join(contentDirectory, input.book.storageFile),
  );
  const indexPath = directChildPath(
    indexesDirectory,
    path.join(indexesDirectory, `${input.book.id}.json`),
  );
  const [pdfBytes, indexBytes] = await Promise.all([
    readStableOwnedFile(pdfPath, {
      expectedUid: input.expectedUid,
      maximumBytes: input.book.expectedBytes,
      expectedMode: 0o640,
    }),
    readStableOwnedFile(indexPath, {
      expectedUid: input.expectedUid,
      maximumBytes: MAX_INDEX_BYTES,
      expectedMode: 0o640,
    }),
  ]);

  if (
    pdfBytes.byteLength !== input.book.expectedBytes ||
    pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    artifactFailure(
      "el PDF real no coincide en tamaño o firma con el catálogo",
    );
  }
  const pdfSha256 = sha256(pdfBytes);
  if (pdfSha256 !== input.book.expectedSha256) {
    artifactFailure("el checksum SHA-256 del PDF real no coincide");
  }
  const pdfPages = await readPdfPageCount(pdfBytes);
  if (pdfPages !== input.book.pages) {
    artifactFailure(
      "la cantidad física de páginas del PDF no coincide con el catálogo",
    );
  }

  let parsedIndex: unknown;
  try {
    parsedIndex = JSON.parse(indexBytes.toString("utf8"));
  } catch {
    artifactFailure("el índice RAG real no contiene JSON válido");
  }
  const indexChunks = validateRuntimeBookIndex(
    parsedIndex,
    input.book,
  );

  return {
    pdfSha256,
    pdfBytes: pdfBytes.byteLength,
    pdfPages,
    indexSha256: sha256(indexBytes),
    indexBytes: indexBytes.byteLength,
    indexChunks,
  };
}

function validationFailure(details: readonly string[]): never {
  throw new ExerciseReleasePromotionError(
    `El release revisado no puede publicarse:\n${details
      .map((entry) => `- ${entry}`)
      .join("\n")}`,
  );
}

export function validateReviewedExerciseRelease(
  publicInput: unknown,
  privateInput: unknown,
  expectedBookId?: string,
): ValidatedExerciseRelease {
  const publicResult = parsePublicExerciseManifest(publicInput);
  const privateResult =
    parsePrivateExerciseSolutionsManifest(privateInput);
  if (!publicResult.ok || !privateResult.ok) {
    validationFailure([
      ...(publicResult.ok
        ? []
        : publicResult.issues.map(
            (entry) => `${entry.code} ${entry.path}`,
          )),
      ...(privateResult.ok
        ? []
        : privateResult.issues.map(
            (entry) => `${entry.code} $private${entry.path.slice(1)}`,
          )),
    ]);
  }

  const publicManifest = publicResult.value;
  const privateManifest = privateResult.value;
  const pending = publicManifest.exercises.filter(
    (exercise) =>
      exercise.status === "draft" || exercise.status === "review",
  );
  const published = publicManifest.exercises.filter(
    (exercise) => exercise.status === "published",
  );
  const issues = validateExerciseManifests(
    publicManifest,
    privateManifest,
  );
  const details = [
    ...(expectedBookId && publicManifest.bookId !== expectedBookId
      ? ["release.book-mismatch $.bookId"]
      : []),
    ...pending.map(
      (exercise) => `exercise.pending $.exercises.${exercise.id}`,
    ),
    ...(published.length === 0
      ? ["exercise.none-published $.exercises"]
      : []),
    ...issues.map((entry) => `${entry.code} ${entry.path}`),
  ];
  if (details.length > 0) {
    validationFailure(details);
  }

  return {
    publicManifest,
    privateManifest,
    publicBytes: canonicalBytes(publicManifest),
    privateBytes: canonicalBytes(privateManifest),
  };
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSyncedExclusive(
  filePath: string,
  contents: Uint8Array,
  mode: number,
): Promise<void> {
  const handle = await open(
    filePath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.chmod(mode);
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSnapshotFile(
  directory: string,
  name: string,
  contents: Uint8Array,
): Promise<void> {
  const target = directChildPath(directory, path.join(directory, name));
  await writeSyncedExclusive(target, contents, 0o640);
}

async function stageReplacement(
  directory: string,
  finalName: string,
  contents: Uint8Array,
  releaseId: string,
): Promise<string> {
  const temporary = directChildPath(
    directory,
    path.join(
      directory,
      `.${finalName}.${releaseId}.${randomBytes(6).toString("hex")}.part`,
    ),
  );
  await writeSyncedExclusive(temporary, contents, 0o640);
  return temporary;
}

async function removeIfPresent(filePath: string | null): Promise<void> {
  if (!filePath) return;
  await unlink(filePath).catch((error: unknown) => {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  });
}

async function restoreDestination(input: {
  directory: string;
  finalPath: string;
  previous: Buffer | null;
  releaseId: string;
}): Promise<void> {
  if (!input.previous) {
    await removeIfPresent(input.finalPath);
    await syncDirectory(input.directory);
    return;
  }

  const temporary = await stageReplacement(
    input.directory,
    path.basename(input.finalPath),
    input.previous,
    `${input.releaseId}-rollback`,
  );
  await rename(temporary, input.finalPath);
  await syncDirectory(input.directory);
}

async function optionalPublishedFile(
  filePath: string,
  expectedUid: number,
): Promise<Buffer | null> {
  const metadata = await lstat(filePath).catch((error: unknown) => {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (!metadata) {
    return null;
  }
  return readStableOwnedFile(filePath, {
    expectedUid,
    maximumBytes: MAX_MANIFEST_BYTES,
    expectedMode: 0o640,
  });
}

async function createReleaseDirectory(
  releasesDirectory: string,
  releaseId: string,
  expectedUid: number,
): Promise<{
  root: string;
  next: string;
  previous: string;
}> {
  const root = directChildPath(
    releasesDirectory,
    path.join(releasesDirectory, releaseId),
  );
  try {
    await mkdir(root, { mode: 0o750, recursive: false });
    await chmod(root, 0o750);
    await assertOwnedDirectory(root, expectedUid, 0o750);

    const next = path.join(root, "new");
    const previous = path.join(root, "previous");
    await mkdir(next, { mode: 0o750, recursive: false });
    await mkdir(previous, { mode: 0o750, recursive: false });
    await chmod(next, 0o750);
    await chmod(previous, 0o750);
    await assertOwnedDirectory(next, expectedUid, 0o750);
    await assertOwnedDirectory(previous, expectedUid, 0o750);
    return { root, next, previous };
  } catch {
    throw new ExerciseReleasePromotionError(
      "No se pudo crear un snapshot de release nuevo y exclusivo.",
    );
  }
}

async function writeReleaseMetadata(
  releaseDirectory: string,
  metadata: Record<string, unknown>,
  releaseId: string,
): Promise<void> {
  const finalPath = path.join(releaseDirectory, "release.json");
  const temporary = await stageReplacement(
    releaseDirectory,
    "release.json",
    canonicalBytes(metadata),
    releaseId,
  );
  await rename(temporary, finalPath);
  await syncDirectory(releaseDirectory);
}

function generatedReleaseId(now: Date): string {
  const timestamp = now
    .toISOString()
    .replaceAll(/[-:.]/gu, "")
    .replace("Z", "z")
    .toLowerCase();
  return `${timestamp}-${randomBytes(8).toString("hex")}`;
}

async function acquirePromotionLock(
  runtimeRoot: string,
  expectedUid: number,
): Promise<{
  handle: FileHandle;
  path: string;
}> {
  const lockPath = directChildPath(
    runtimeRoot,
    path.join(runtimeRoot, ".exercise-release.lock"),
  );
  let handle: FileHandle | null = null;
  try {
    handle = await open(
      lockPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.chmod(0o600);
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        uid: expectedUid,
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    await handle.sync();
    await syncDirectory(runtimeRoot);
  } catch {
    if (handle) {
      await handle.close().catch(() => undefined);
      await removeIfPresent(lockPath).catch(() => undefined);
    }
    throw new ExerciseReleasePromotionError(
      "Ya existe una promoción en curso o un lock pendiente de revisión.",
    );
  }
  return { handle, path: lockPath };
}

async function releasePromotionLock(lock: {
  handle: FileHandle;
  path: string;
}): Promise<void> {
  await lock.handle.close().catch(() => undefined);
  await removeIfPresent(lock.path);
  await syncDirectory(path.dirname(lock.path));
}

function effectiveUid(input: ExerciseReleasePromotionInput): number {
  const actualUid = currentNonRootUid();
  if (input.currentUid !== undefined) {
    if (
      !Number.isSafeInteger(input.currentUid) ||
      input.currentUid <= 0 ||
      input.currentUid !== actualUid
    ) {
      throw new ExerciseReleasePromotionError(
        "La promoción debe usar el UID no-root del proceso actual.",
      );
    }
  }
  return actualUid;
}

export async function promoteExerciseRelease(
  input: ExerciseReleasePromotionInput,
): Promise<ExerciseReleasePromotionResult> {
  if (
    !safeIdPattern.test(input.jobId) ||
    !safeIdPattern.test(input.bookId)
  ) {
    throw new ExerciseReleasePromotionError(
      "bookId y jobId deben ser identificadores seguros.",
    );
  }

  const expectedUid = effectiveUid(input);
  const ingestRoot = absoluteConfiguredRoot(
    input.ingestRoot ?? process.env.AIMAUTA_INGEST_ROOT,
    DEFAULT_INGEST_ROOT,
  );
  const runtimeRoot = absoluteConfiguredRoot(
    input.runtimeRoot ?? process.env.AIMAUTA_RUNTIME_DIR,
    DEFAULT_RUNTIME_ROOT,
  );
  const jobsDirectory = path.join(ingestRoot, "jobs");
  const jobDirectory = directChildPath(
    jobsDirectory,
    path.join(jobsDirectory, input.jobId),
  );
  const manifestsDirectory = path.join(runtimeRoot, "manifests");
  const publicDirectory = path.join(manifestsDirectory, "exercises");
  const privateDirectory = path.join(
    runtimeRoot,
    "exercise-solutions",
  );
  const releasesDirectory = path.join(runtimeRoot, "releases");
  const contentDirectory = path.join(runtimeRoot, "content");
  const indexesDirectory = path.join(runtimeRoot, "indexes");

  await assertOwnedDirectory(ingestRoot, expectedUid, 0o700);
  await assertOwnedDirectory(jobsDirectory, expectedUid, 0o700);
  await assertOwnedDirectory(jobDirectory, expectedUid, 0o700);
  await assertOwnedDirectory(runtimeRoot, expectedUid, 0o750);
  await assertOwnedDirectory(manifestsDirectory, expectedUid, 0o750);
  await assertOwnedDirectory(publicDirectory, expectedUid, 0o750);
  await assertOwnedDirectory(privateDirectory, expectedUid, 0o750);
  await assertOwnedDirectory(releasesDirectory, expectedUid, 0o750);
  await assertOwnedDirectory(contentDirectory, expectedUid, 0o750);
  await assertOwnedDirectory(indexesDirectory, expectedUid, 0o750);

  const book = getBook(input.bookId);
  if (!book) {
    throw new ExerciseReleasePromotionError(
      "El libro no está publicado o no admite tutor/RAG.",
    );
  }

  const reviewedPublicPath = directChildPath(
    jobDirectory,
    path.join(jobDirectory, `${input.bookId}.public.reviewed.json`),
  );
  const reviewedPrivatePath = directChildPath(
    jobDirectory,
    path.join(jobDirectory, `${input.bookId}.private.reviewed.json`),
  );
  const [reviewedPublic, reviewedPrivate] = await Promise.all([
    readStableOwnedFile(reviewedPublicPath, {
      expectedUid,
      maximumBytes: MAX_MANIFEST_BYTES,
      expectedMode: 0o600,
    }),
    readStableOwnedFile(reviewedPrivatePath, {
      expectedUid,
      maximumBytes: MAX_MANIFEST_BYTES,
      expectedMode: 0o600,
    }),
  ]);
  const validated = validateReviewedExerciseRelease(
    reviewedPublic.toString("utf8"),
    reviewedPrivate.toString("utf8"),
    input.bookId,
  );

  const releaseId =
    input.releaseId ?? generatedReleaseId((input.now ?? (() => new Date()))());
  if (!safeIdPattern.test(releaseId)) {
    throw new ExerciseReleasePromotionError(
      "El identificador de release no es seguro.",
    );
  }

  const publicName = `${input.bookId}.public.json`;
  const privateName = `${input.bookId}.private.json`;
  const publicDestination = directChildPath(
    publicDirectory,
    path.join(publicDirectory, publicName),
  );
  const privateDestination = directChildPath(
    privateDirectory,
    path.join(privateDirectory, privateName),
  );

  if (
    input.hooks?.verifyRuntimeArtifacts &&
    process.env.NODE_ENV !== "test"
  ) {
    throw new ExerciseReleasePromotionError(
      "El verificador de artefactos no puede sustituirse fuera de pruebas.",
    );
  }
  const runtimeArtifactVerifier =
    input.hooks?.verifyRuntimeArtifacts ??
    verifyRuntimeBookArtifacts;
  const runtimeArtifacts = await runtimeArtifactVerifier({
    runtimeRoot,
    book,
    expectedUid,
  });
  const lock = await acquirePromotionLock(runtimeRoot, expectedUid);
  let privateTemporary: string | null = null;
  let publicTemporary: string | null = null;
  let privateActivated = false;
  let publicActivated = false;

  try {
    const [previousPublic, previousPrivate] = await Promise.all([
      optionalPublishedFile(publicDestination, expectedUid),
      optionalPublishedFile(privateDestination, expectedUid),
    ]);
    if (Boolean(previousPublic) !== Boolean(previousPrivate)) {
      throw new ExerciseReleasePromotionError(
        "El release activo está incompleto; se requiere reparación manual.",
      );
    }
    if (previousPublic && previousPrivate) {
      validateReviewedExerciseRelease(
        previousPublic.toString("utf8"),
        previousPrivate.toString("utf8"),
        input.bookId,
      );
    }

    const snapshot = await createReleaseDirectory(
      releasesDirectory,
      releaseId,
      expectedUid,
    );
    await writeSnapshotFile(
      snapshot.next,
      publicName,
      validated.publicBytes,
    );
    await writeSnapshotFile(
      snapshot.next,
      privateName,
      validated.privateBytes,
    );
    if (previousPublic && previousPrivate) {
      await writeSnapshotFile(
        snapshot.previous,
        publicName,
        previousPublic,
      );
      await writeSnapshotFile(
        snapshot.previous,
        privateName,
        previousPrivate,
      );
    }
    await syncDirectory(snapshot.next);
    await syncDirectory(snapshot.previous);
    await writeReleaseMetadata(
      snapshot.root,
      {
        schemaVersion: 1,
        releaseId,
        bookId: input.bookId,
        jobId: input.jobId,
        createdAt: (input.now ?? (() => new Date()))().toISOString(),
        status: "prepared",
        hadPrevious: Boolean(previousPublic),
        runtimeArtifacts,
      },
      releaseId,
    );
    await syncDirectory(releasesDirectory);

    privateTemporary = await stageReplacement(
      privateDirectory,
      privateName,
      validated.privateBytes,
      releaseId,
    );
    publicTemporary = await stageReplacement(
      publicDirectory,
      publicName,
      validated.publicBytes,
      releaseId,
    );

    await rename(privateTemporary, privateDestination);
    privateTemporary = null;
    privateActivated = true;
    await syncDirectory(privateDirectory);

    await input.hooks?.afterPrivateActivation?.();

    await rename(publicTemporary, publicDestination);
    publicTemporary = null;
    publicActivated = true;
    await syncDirectory(publicDirectory);

    await writeReleaseMetadata(
      snapshot.root,
      {
        schemaVersion: 1,
        releaseId,
        bookId: input.bookId,
        jobId: input.jobId,
        createdAt: (input.now ?? (() => new Date()))().toISOString(),
        status: "published",
        hadPrevious: Boolean(previousPublic),
        runtimeArtifacts,
      },
      `${releaseId}-published`,
    );

    return {
      releaseId,
      bookId: input.bookId,
      publishedExercises: validated.publicManifest.exercises.filter(
        (exercise) => exercise.status === "published",
      ).length,
      previousReleaseSnapshot: Boolean(previousPublic),
    };
  } catch (error) {
    await Promise.allSettled([
      removeIfPresent(privateTemporary),
      removeIfPresent(publicTemporary),
    ]);

    const rollbackFailures: unknown[] = [];
    if (publicActivated) {
      try {
        const previousPublic = await optionalPublishedFile(
          path.join(
            releasesDirectory,
            releaseId,
            "previous",
            publicName,
          ),
          expectedUid,
        );
        await restoreDestination({
          directory: publicDirectory,
          finalPath: publicDestination,
          previous: previousPublic,
          releaseId,
        });
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (privateActivated) {
      try {
        const previousPrivate = await optionalPublishedFile(
          path.join(
            releasesDirectory,
            releaseId,
            "previous",
            privateName,
          ),
          expectedUid,
        );
        await restoreDestination({
          directory: privateDirectory,
          finalPath: privateDestination,
          previous: previousPrivate,
          releaseId,
        });
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }

    if (rollbackFailures.length > 0) {
      throw new ExerciseReleasePromotionError(
        "La promoción falló y el rollback no pudo completarse; el runtime debe repararse manualmente.",
      );
    }
    if (error instanceof ExerciseReleasePromotionError) {
      throw error;
    }
    throw new ExerciseReleasePromotionError(
      "La promoción falló; el release activo anterior fue restaurado.",
    );
  } finally {
    await releasePromotionLock(lock);
  }
}
