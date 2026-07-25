import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  parsePrivateExerciseSolutionsManifest,
  validateExerciseManifests,
  type PrivateExerciseSolution,
} from "@/lib/exercise-manifest";
import { loadExerciseReleaseBundle } from "@/lib/exercise-release-bundle";
import { loadPublicExerciseManifest } from "@/lib/exercise-store";

const DEFAULT_SOLUTION_DIR = "/srv/aimauta/exercise-solutions";
const MAX_SOLUTION_MANIFEST_BYTES = 16 * 1024 * 1024;

export class ExerciseSolutionUnavailableError extends Error {
  constructor() {
    super("La guía revisada del ejercicio no está disponible.");
    this.name = "ExerciseSolutionUnavailableError";
  }
}

function solutionDirectory(): string {
  const configured =
    process.env.AIMAUTA_EXERCISE_SOLUTION_DIR?.trim() ||
    DEFAULT_SOLUTION_DIR;
  if (!path.isAbsolute(configured)) {
    throw new ExerciseSolutionUnavailableError();
  }
  return configured;
}

function copySolution(
  solution: PrivateExerciseSolution,
): PrivateExerciseSolution {
  return {
    exerciseId: solution.exerciseId,
    revision: solution.revision,
    reviewed: solution.reviewed,
    finalAnswer: solution.finalAnswer,
    pedagogicalSteps: [...solution.pedagogicalSteps],
    hints: solution.hints.map((hint) => ({
      level: hint.level,
      text: hint.text,
    })),
    rubric: solution.rubric.map((item) => ({
      criterion: item.criterion,
      expectedEvidence: item.expectedEvidence,
    })),
    confidence: solution.confidence,
  };
}

async function readPrivateManifest(
  bookId: string,
): Promise<unknown> {
  const filePath = path.join(
    /* turbopackIgnore: true */ solutionDirectory(),
    `${bookId}.private.json`,
  );
  let handle: FileHandle | null = null;

  try {
    handle = await open(
      /* turbopackIgnore: true */ filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size <= 0 ||
      before.size > BigInt(MAX_SOLUTION_MANIFEST_BYTES)
    ) {
      throw new ExerciseSolutionUnavailableError();
    }

    const source = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new ExerciseSolutionUnavailableError();
    }
    return source;
  } catch {
    throw new ExerciseSolutionUnavailableError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Server-only lookup. It validates the public/private pair again so a
 * published exercise can never use an unreviewed or stale solution.
 */
export async function getReviewedExerciseSolution(input: {
  bookId: string;
  exerciseId: string;
  revision: number;
}): Promise<PrivateExerciseSolution> {
  try {
    const bundle = await loadExerciseReleaseBundle(input.bookId);
    const publicManifest = bundle
      ? bundle.publicManifest
      : await loadPublicExerciseManifest(input.bookId);
    const privateResult = bundle
      ? { ok: true as const, value: bundle.privateManifest }
      : parsePrivateExerciseSolutionsManifest(
          await readPrivateManifest(input.bookId)
        );
    if (
      !privateResult.ok ||
      validateExerciseManifests(
        publicManifest,
        privateResult.value,
      ).length > 0
    ) {
      throw new ExerciseSolutionUnavailableError();
    }

    const exercise = publicManifest.exercises.find(
      (candidate) =>
        candidate.id === input.exerciseId &&
        candidate.status === "published" &&
        candidate.revision === input.revision,
    );
    const solution = privateResult.value.solutions.find(
      (candidate) =>
        candidate.exerciseId === input.exerciseId &&
        candidate.revision === input.revision &&
        candidate.reviewed,
    );
    if (!exercise || !solution) {
      throw new ExerciseSolutionUnavailableError();
    }
    return copySolution(solution);
  } catch {
    throw new ExerciseSolutionUnavailableError();
  }
}
