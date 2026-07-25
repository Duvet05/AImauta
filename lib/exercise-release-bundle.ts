import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  parsePrivateExerciseSolutionsManifest,
  parsePublicExerciseManifest,
  projectPublicExerciseManifest,
  validateExerciseManifests,
  type PrivateExerciseSolutionsManifest,
  type PublicExerciseManifest
} from "@/lib/exercise-manifest";

const DEFAULT_SOLUTION_DIR = "/srv/aimauta/exercise-solutions";
const MAX_RELEASE_BUNDLE_BYTES = 32 * 1024 * 1024;
const safeIdPattern = /^[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/u;
const CACHE_KEY = Symbol.for("org.aimauta.exercise-release-bundles.v1");

type FileIdentity = {
  device: bigint;
  inode: bigint;
  size: bigint;
  modifiedAt: bigint;
  changedAt: bigint;
};

type CachedBundle = {
  identity: FileIdentity;
  bundle: ExerciseReleaseBundle;
};

export type ExerciseReleaseBundle = {
  schemaVersion: 1;
  releaseId: string;
  bookId: string;
  publicManifest: PublicExerciseManifest;
  privateManifest: PrivateExerciseSolutionsManifest;
  evidence: ReleasedExerciseEvidence[];
};

export type ReleasedExerciseEvidence = {
  id: string;
  exerciseId: string;
  revision: number;
  sourceSha256: string;
  provenance: "human-reviewed-region-transcription";
  text: string;
  unitId: string;
  stage: "learn" | "practice";
  regions: Array<{
    id: string;
    page: number;
  }>;
};

export class ExerciseReleaseBundleUnavailableError extends Error {
  constructor() {
    super("El release atómico de ejercicios no está disponible.");
    this.name = "ExerciseReleaseBundleUnavailableError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function solutionDirectory(): string {
  const configured =
    process.env.AIMAUTA_EXERCISE_SOLUTION_DIR?.trim() ||
    DEFAULT_SOLUTION_DIR;
  if (!path.isAbsolute(configured)) {
    throw new ExerciseReleaseBundleUnavailableError();
  }
  return configured;
}

export function exerciseReleaseBundlePath(bookId: string): string {
  if (
    !safeIdPattern.test(bookId) ||
    path.basename(bookId) !== bookId
  ) {
    throw new ExerciseReleaseBundleUnavailableError();
  }
  return path.join(
    /* turbopackIgnore: true */ solutionDirectory(),
    `${bookId}.release.json`
  );
}

function copyPrivateManifest(
  manifest: PrivateExerciseSolutionsManifest
): PrivateExerciseSolutionsManifest {
  return {
    schemaVersion: manifest.schemaVersion,
    bookId: manifest.bookId,
    sourceSha256: manifest.sourceSha256,
    model: manifest.model,
    generatedAt: manifest.generatedAt,
    solutions: manifest.solutions.map((solution) => ({
      exerciseId: solution.exerciseId,
      revision: solution.revision,
      reviewed: solution.reviewed,
      finalAnswer: solution.finalAnswer,
      pedagogicalSteps: [...solution.pedagogicalSteps],
      hints: solution.hints.map((hint) => ({
        level: hint.level,
        text: hint.text
      })),
      rubric: solution.rubric.map((item) => ({
        criterion: item.criterion,
        expectedEvidence: item.expectedEvidence
      })),
      confidence: solution.confidence
    }))
  };
}

function copyBundle(bundle: ExerciseReleaseBundle): ExerciseReleaseBundle {
  return {
    schemaVersion: 1,
    releaseId: bundle.releaseId,
    bookId: bundle.bookId,
    publicManifest: projectPublicExerciseManifest(bundle.publicManifest),
    privateManifest: copyPrivateManifest(bundle.privateManifest),
    evidence: bundle.evidence.map((item) => ({
      id: item.id,
      exerciseId: item.exerciseId,
      revision: item.revision,
      sourceSha256: item.sourceSha256,
      provenance: item.provenance,
      text: item.text,
      unitId: item.unitId,
      stage: item.stage,
      regions: item.regions.map((region) => ({
        id: region.id,
        page: region.page
      }))
    }))
  };
}

function releasedEvidence(
  manifest: PublicExerciseManifest
): ReleasedExerciseEvidence[] {
  return manifest.exercises
    .filter((exercise) => exercise.status === "published")
    .map((exercise) => ({
      id: `${exercise.id}:revision-${exercise.revision}`,
      exerciseId: exercise.id,
      revision: exercise.revision,
      sourceSha256: manifest.sourceSha256,
      provenance: "human-reviewed-region-transcription" as const,
      text: exercise.prompt,
      unitId: exercise.unitId,
      stage: exercise.stage,
      regions: exercise.regions.map((region) => ({
        id: region.id,
        page: region.page
      }))
    }));
}

export function parseExerciseReleaseBundle(
  input: unknown
): ExerciseReleaseBundle {
  let value = input;
  if (typeof input === "string" || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(input.toString()) as unknown;
    } catch {
      throw new ExerciseReleaseBundleUnavailableError();
    }
  }

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.releaseId !== "string" ||
    !safeIdPattern.test(value.releaseId) ||
    typeof value.bookId !== "string" ||
    !safeIdPattern.test(value.bookId) ||
    Object.keys(value).length !== 6
  ) {
    throw new ExerciseReleaseBundleUnavailableError();
  }

  const publicResult = parsePublicExerciseManifest(value.publicManifest);
  const privateResult =
    parsePrivateExerciseSolutionsManifest(value.privateManifest);
  if (
    !publicResult.ok ||
    !privateResult.ok ||
    publicResult.value.bookId !== value.bookId ||
    privateResult.value.bookId !== value.bookId ||
    validateExerciseManifests(
      publicResult.value,
      privateResult.value
    ).length > 0 ||
    !Array.isArray(value.evidence)
  ) {
    throw new ExerciseReleaseBundleUnavailableError();
  }
  const expectedEvidence = releasedEvidence(publicResult.value);
  if (JSON.stringify(value.evidence) !== JSON.stringify(expectedEvidence)) {
    throw new ExerciseReleaseBundleUnavailableError();
  }

  return {
    schemaVersion: 1,
    releaseId: value.releaseId,
    bookId: value.bookId,
    publicManifest: projectPublicExerciseManifest(publicResult.value),
    privateManifest: copyPrivateManifest(privateResult.value),
    evidence: expectedEvidence
  };
}

export function encodeExerciseReleaseBundle(input: {
  releaseId: string;
  bookId: string;
  publicManifest: PublicExerciseManifest;
  privateManifest: PrivateExerciseSolutionsManifest;
}): Buffer {
  const bundle = parseExerciseReleaseBundle({
    schemaVersion: 1,
    releaseId: input.releaseId,
    bookId: input.bookId,
    publicManifest: input.publicManifest,
    privateManifest: input.privateManifest,
    evidence: releasedEvidence(input.publicManifest)
  });
  return Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, "utf8");
}

function bundleCache(): Map<string, CachedBundle> {
  const processGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processGlobal[CACHE_KEY];
  if (existing instanceof Map) {
    return existing as Map<string, CachedBundle>;
  }
  const created = new Map<string, CachedBundle>();
  processGlobal[CACHE_KEY] = created;
  return created;
}

const cache = bundleCache();

function identity(metadata: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}): FileIdentity {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    size: metadata.size,
    modifiedAt: metadata.mtimeNs,
    changedAt: metadata.ctimeNs
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.changedAt === right.changedAt
  );
}

async function openedIdentity(
  handle: FileHandle
): Promise<FileIdentity | null> {
  const metadata = await handle.stat({ bigint: true });
  const mode = Number(metadata.mode) & 0o777;
  if (
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > BigInt(MAX_RELEASE_BUNDLE_BYTES) ||
    (mode !== 0o600 && mode !== 0o640)
  ) {
    return null;
  }
  return identity(metadata);
}

/**
 * Reads the authoritative public/private pair from one inode. A single rename
 * can therefore activate both halves without a mixed-revision window.
 *
 * `null` means no bundle has been published yet and permits the legacy
 * two-file reader during migration. Any existing but malformed bundle fails
 * closed.
 */
export async function loadExerciseReleaseBundle(
  bookId: string
): Promise<ExerciseReleaseBundle | null> {
  const filePath = exerciseReleaseBundlePath(bookId);
  let handle: FileHandle | null = null;
  try {
    try {
      handle = await open(
        /* turbopackIgnore: true */ filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw new ExerciseReleaseBundleUnavailableError();
    }

    const before = await openedIdentity(handle);
    if (!before) {
      throw new ExerciseReleaseBundleUnavailableError();
    }
    const cached = cache.get(filePath);
    if (cached && sameIdentity(cached.identity, before)) {
      return copyBundle(cached.bundle);
    }

    const source = await handle.readFile({ encoding: "utf8" });
    const after = await openedIdentity(handle);
    if (!after || !sameIdentity(before, after)) {
      throw new ExerciseReleaseBundleUnavailableError();
    }
    const bundle = parseExerciseReleaseBundle(source);
    if (bundle.bookId !== bookId) {
      throw new ExerciseReleaseBundleUnavailableError();
    }
    cache.set(filePath, { identity: after, bundle });
    return copyBundle(bundle);
  } catch (error) {
    cache.delete(filePath);
    if (error instanceof ExerciseReleaseBundleUnavailableError) {
      throw error;
    }
    throw new ExerciseReleaseBundleUnavailableError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
