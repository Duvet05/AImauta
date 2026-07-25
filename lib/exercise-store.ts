import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { getBook, type Book } from "@/lib/catalog";
import { getPageActivity } from "@/lib/curriculum";
import {
  parsePublicExerciseManifest,
  projectPublicExerciseManifest,
  type PublicExercise,
  type PublicExerciseManifest,
} from "@/lib/exercise-manifest";

const DEFAULT_EXERCISE_MANIFEST_DIR =
  "/srv/aimauta/manifests/exercises";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const CACHE_KEY = Symbol.for("org.aimauta.public-exercise-manifests.v1");

type FileIdentity = {
  device: bigint;
  inode: bigint;
  size: bigint;
  modifiedAt: bigint;
  changedAt: bigint;
};

type CachedManifest = {
  identity: FileIdentity;
  manifest: PublicExerciseManifest;
};

export class ExerciseManifestUnavailableError extends Error {
  constructor() {
    super("El manifiesto público de ejercicios no está disponible.");
    this.name = "ExerciseManifestUnavailableError";
  }
}

function manifestCache(): Map<string, CachedManifest> {
  const processGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processGlobal[CACHE_KEY];
  if (existing instanceof Map) {
    return existing as Map<string, CachedManifest>;
  }

  const created = new Map<string, CachedManifest>();
  processGlobal[CACHE_KEY] = created;
  return created;
}

const cache = manifestCache();

function fileIdentity(metadata: {
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
    changedAt: metadata.ctimeNs,
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

function manifestDirectory(): string {
  const configured =
    process.env.AIMAUTA_EXERCISE_MANIFEST_DIR?.trim() ||
    DEFAULT_EXERCISE_MANIFEST_DIR;
  if (!path.isAbsolute(configured)) {
    throw new ExerciseManifestUnavailableError();
  }
  return configured;
}

function manifestPath(bookId: string): string {
  return path.join(manifestDirectory(), `${bookId}.public.json`);
}

function copyExercise(exercise: PublicExercise): PublicExercise {
  return {
    id: exercise.id,
    status: exercise.status,
    unitId: exercise.unitId,
    stage: exercise.stage,
    revision: exercise.revision,
    label: exercise.label,
    title: exercise.title,
    prompt: exercise.prompt,
    regions: exercise.regions.map((region) => ({
      id: region.id,
      page: region.page,
      role: region.role,
      order: region.order,
      rect: {
        x: region.rect.x,
        y: region.rect.y,
        width: region.rect.width,
        height: region.rect.height,
      },
    })),
  };
}

function matchesPublishedBook(
  manifest: PublicExerciseManifest,
  book: Book,
): boolean {
  if (
    manifest.bookId !== book.id ||
    manifest.sourceSha256 !== book.expectedSha256 ||
    manifest.pageCount !== book.pages
  ) {
    return false;
  }

  return manifest.exercises.every((exercise) =>
    exercise.regions.every((region) => {
      if (region.page < 1 || region.page > book.pages) {
        return false;
      }
      const activity = getPageActivity(book.id, region.page);
      return (
        activity.tutorAvailable &&
        activity.unitId === exercise.unitId &&
        activity.stage === exercise.stage
      );
    }),
  );
}

async function openedIdentity(
  handle: FileHandle,
): Promise<FileIdentity | null> {
  const metadata = await handle.stat({ bigint: true });
  if (
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > BigInt(MAX_MANIFEST_BYTES)
  ) {
    return null;
  }
  return fileIdentity(metadata);
}

async function readAndValidateManifest(
  book: Book,
): Promise<PublicExerciseManifest> {
  const filePath = manifestPath(book.id);
  let handle: FileHandle | null = null;

  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const before = await openedIdentity(handle);
    if (!before) {
      throw new ExerciseManifestUnavailableError();
    }

    const cached = cache.get(filePath);
    if (cached && sameIdentity(cached.identity, before)) {
      return projectPublicExerciseManifest(cached.manifest);
    }

    const source = await handle.readFile({ encoding: "utf8" });
    const after = await openedIdentity(handle);
    if (!after || !sameIdentity(before, after)) {
      throw new ExerciseManifestUnavailableError();
    }

    const parsed = parsePublicExerciseManifest(source);
    if (!parsed.ok || !matchesPublishedBook(parsed.value, book)) {
      throw new ExerciseManifestUnavailableError();
    }

    const manifest = projectPublicExerciseManifest(parsed.value);
    cache.set(filePath, { identity: after, manifest });
    return projectPublicExerciseManifest(manifest);
  } catch {
    cache.delete(filePath);
    throw new ExerciseManifestUnavailableError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Reads only `<bookId>.public.json`. Private solution files deliberately live
 * in another directory/mount and are never opened by this module.
 */
export async function loadPublicExerciseManifest(
  bookId: string,
): Promise<PublicExerciseManifest> {
  const book = getBook(bookId);
  if (!book) {
    throw new ExerciseManifestUnavailableError();
  }
  return readAndValidateManifest(book);
}

export async function getPublishedExercisesForPage(
  bookId: string,
  page: number,
): Promise<readonly PublicExercise[]> {
  const book = getBook(bookId);
  if (
    !book ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > book.pages
  ) {
    throw new ExerciseManifestUnavailableError();
  }

  const manifest = await readAndValidateManifest(book);
  return manifest.exercises
    .filter(
      (exercise) =>
        exercise.status === "published" &&
        exercise.regions.some((region) => region.page === page),
    )
    .map(copyExercise);
}

export async function getPublishedExercise(
  bookId: string,
  exerciseId: string,
): Promise<PublicExercise | undefined> {
  const manifest = await loadPublicExerciseManifest(bookId);
  const exercise = manifest.exercises.find(
    (candidate) =>
      candidate.status === "published" &&
      candidate.id === exerciseId,
  );
  return exercise ? copyExercise(exercise) : undefined;
}
