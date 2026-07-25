import type {
  ExerciseRegion,
  PublicExercise,
} from "@/lib/exercise-manifest";

export const PAGE_EXERCISES_SCHEMA_VERSION = 1 as const;

export type ExercisePublicationStatus = "published" | "not-published";

export type PageExercisesResponse = {
  schemaVersion: typeof PAGE_EXERCISES_SCHEMA_VERSION;
  bookId: string;
  page: number;
  publicationStatus: ExercisePublicationStatus;
  exercises: readonly PublicExercise[];
};

const responseKeys = new Set([
  "schemaVersion",
  "bookId",
  "page",
  "publicationStatus",
  "exercises",
]);
const exerciseKeys = new Set([
  "id",
  "status",
  "unitId",
  "stage",
  "revision",
  "label",
  "title",
  "prompt",
  "regions",
]);
const regionKeys = new Set(["id", "page", "role", "order", "rect"]);
const rectKeys = new Set(["x", "y", "width", "height"]);
const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const regionRoles = new Set(["prompt", "context", "figure", "answer-area"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isRegion(value: unknown): value is ExerciseRegion {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, regionKeys) ||
    !safeIdPattern.test(String(value.id ?? "")) ||
    !isPositiveInteger(value.page) ||
    !regionRoles.has(String(value.role ?? "")) ||
    !isPositiveInteger(value.order) ||
    !isRecord(value.rect) ||
    !hasOnlyKeys(value.rect, rectKeys)
  ) {
    return false;
  }

  const { x, y, width, height } = value.rect;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

function isPublicExercise(
  value: unknown,
  requestedPage: number,
): value is PublicExercise {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, exerciseKeys) ||
    !safeIdPattern.test(String(value.id ?? "")) ||
    value.status !== "published" ||
    !safeIdPattern.test(String(value.unitId ?? "")) ||
    (value.stage !== "learn" && value.stage !== "practice") ||
    !isPositiveInteger(value.revision) ||
    !hasText(value.label) ||
    !hasText(value.title) ||
    !hasText(value.prompt) ||
    !Array.isArray(value.regions) ||
    value.regions.length === 0 ||
    !value.regions.every(isRegion)
  ) {
    return false;
  }

  const regionIds = new Set(value.regions.map((region) => region.id));
  return (
    regionIds.size === value.regions.length &&
    value.regions.some((region) => region.page === requestedPage)
  );
}

/**
 * Decodes the browser-facing response without importing the server catalog or
 * trusting arbitrary geometry. A malformed response is treated fail-closed.
 */
export function parsePageExercisesResponse(
  value: unknown,
  expected: { bookId: string; page: number },
): PageExercisesResponse | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, responseKeys) ||
    value.schemaVersion !== PAGE_EXERCISES_SCHEMA_VERSION ||
    value.bookId !== expected.bookId ||
    value.page !== expected.page ||
    (value.publicationStatus !== "published" &&
      value.publicationStatus !== "not-published") ||
    !Array.isArray(value.exercises)
  ) {
    return null;
  }

  if (
    value.publicationStatus === "not-published" &&
    value.exercises.length !== 0
  ) {
    return null;
  }

  if (
    value.publicationStatus === "published" &&
    !value.exercises.every((exercise) =>
      isPublicExercise(exercise, expected.page),
    )
  ) {
    return null;
  }

  const exerciseKeys = new Set(
    value.exercises.map((exercise) => {
      const candidate = exercise as PublicExercise;
      return `${candidate.id}:${candidate.revision}`;
    }),
  );
  if (exerciseKeys.size !== value.exercises.length) {
    return null;
  }

  return value as PageExercisesResponse;
}
