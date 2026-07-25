import {
  AssignmentItemKind,
  AssignmentKind,
  type AssignmentItemKind as AssignmentItemKindValue,
  type AssignmentKind as AssignmentKindValue,
} from "@/lib/generated/prisma/client";
import { getBook } from "@/lib/catalog";
import {
  getBookCurriculum,
  getPageActivity,
} from "@/lib/curriculum";
import {
  ExerciseManifestUnavailableError,
  getPublishedExercise,
} from "@/lib/exercise-store";
import {
  ApiError,
  optionalString,
  requiredString,
} from "@/lib/http";

const MAX_ASSIGNMENT_ITEMS = 50;
const MAX_ASSIGNMENT_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;

export type AssignmentItemSnapshot = {
  position: number;
  kind: AssignmentItemKindValue;
  bookId: string;
  bookSha256: string;
  curriculumVersion: string;
  unitId: string | null;
  pages: number[];
  exerciseId: string | null;
  exerciseRevision: number | null;
  label: string;
  title: string;
};

export type CreateAssignmentInput = {
  kind: AssignmentKindValue;
  title: string;
  instructions?: string;
  teacherId: string;
  courseId?: string;
  groupLabel?: string;
  availableFrom: Date | null;
  expiresAt: Date;
  maxHintLevel: number;
  requiredItemCount: number;
  minimumTurnsPerItem: number;
  items: AssignmentItemSnapshot[];
};

function integerField(
  value: unknown,
  field: string,
  options: {
    minimum: number;
    maximum: number;
    defaultValue?: number;
  },
): number {
  if (value === undefined && options.defaultValue !== undefined) {
    return options.defaultValue;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < options.minimum ||
    value > options.maximum
  ) {
    throw new ApiError(
      `El campo "${field}" debe ser un entero entre ${options.minimum} y ${options.maximum}.`,
      400,
    );
  }
  return value;
}

function enumField<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new ApiError(
      `El campo "${field}" no contiene un valor permitido.`,
      400,
    );
  }
  return value as T;
}

function dateField(
  value: unknown,
  field: string,
  { optional = false }: { optional?: boolean } = {},
): Date | null {
  if ((value === undefined || value === null) && optional) {
    return null;
  }
  if (typeof value !== "string" || value.length > 64) {
    throw new ApiError(
      `El campo "${field}" debe usar una fecha ISO 8601.`,
      400,
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ApiError(
      `El campo "${field}" debe usar una fecha ISO 8601 canónica.`,
      400,
    );
  }
  return parsed;
}

function itemObjects(value: unknown): Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ASSIGNMENT_ITEMS ||
    value.some(
      (item) =>
        typeof item !== "object" ||
        item === null ||
        Array.isArray(item),
    )
  ) {
    throw new ApiError(
      `El campo "items" debe contener entre 1 y ${MAX_ASSIGNMENT_ITEMS} objetivos.`,
      400,
    );
  }
  return value as Record<string, unknown>[];
}

function orderedUniquePages(pages: readonly number[]): number[] {
  return [...new Set(pages)].sort((left, right) => left - right);
}

async function snapshotItem(
  item: Record<string, unknown>,
  position: number,
): Promise<AssignmentItemSnapshot> {
  const kind = enumField(
    item.kind,
    `items[${position}].kind`,
    Object.values(AssignmentItemKind),
  );
  const bookId = requiredString(
    item.bookId,
    `items[${position}].bookId`,
    { maxLength: 160 },
  );
  const book = getBook(bookId);
  const curriculum = getBookCurriculum(bookId);
  if (!book || !curriculum) {
    throw new ApiError(
      `El material de items[${position}] no está publicado con un currículo válido.`,
      400,
    );
  }

  const base = {
    position,
    kind,
    bookId: book.id,
    bookSha256: book.expectedSha256,
    curriculumVersion: curriculum.version,
  };

  if (kind === AssignmentItemKind.UNIT) {
    const unitId = requiredString(
      item.unitId,
      `items[${position}].unitId`,
      { maxLength: 160 },
    );
    const unit = curriculum.units.find((candidate) => candidate.id === unitId);
    if (!unit) {
      throw new ApiError(
        `La ficha de items[${position}] no pertenece al material publicado.`,
        400,
      );
    }
    return {
      ...base,
      unitId: unit.id,
      pages: Array.from(
        { length: unit.endPage - unit.startPage + 1 },
        (_, offset) => unit.startPage + offset,
      ),
      exerciseId: null,
      exerciseRevision: null,
      label: `Ficha ${unit.number}`,
      title: unit.title,
    };
  }

  if (kind === AssignmentItemKind.PAGE) {
    const page = integerField(
      item.page,
      `items[${position}].page`,
      { minimum: 1, maximum: book.pages },
    );
    const activity = getPageActivity(book.id, page);
    return {
      ...base,
      unitId: activity.unitId,
      pages: [page],
      exerciseId: null,
      exerciseRevision: null,
      label: `Página ${page}`,
      title:
        activity.unitId === null
          ? activity.stageLabel
          : `${activity.stageLabel} · ${activity.unitTitle}`,
    };
  }

  const exerciseId = requiredString(
    item.exerciseId,
    `items[${position}].exerciseId`,
    { maxLength: 160 },
  );
  let exercise;
  try {
    exercise = await getPublishedExercise(book.id, exerciseId);
  } catch (error) {
    if (error instanceof ExerciseManifestUnavailableError) {
      throw new ApiError(
        "Los ejercicios publicados no están disponibles para crear la tarea.",
        503,
      );
    }
    throw error;
  }
  if (!exercise) {
    throw new ApiError(
      `El ejercicio de items[${position}] no está publicado.`,
      400,
    );
  }
  const pages = orderedUniquePages(
    exercise.regions.map((region) => region.page),
  );
  if (pages.length === 0) {
    throw new ApiError(
      `El ejercicio de items[${position}] no contiene regiones válidas.`,
      400,
    );
  }
  return {
    ...base,
    unitId: exercise.unitId,
    pages,
    exerciseId: exercise.id,
    exerciseRevision: exercise.revision,
    label: exercise.label,
    title: exercise.title,
  };
}

function assertKindShape(
  kind: AssignmentKindValue,
  items: readonly AssignmentItemSnapshot[],
): void {
  if (kind === AssignmentKind.TASK) {
    return;
  }
  if (items.length !== 1) {
    throw new ApiError(
      "Este tipo de actividad debe contener exactamente un objetivo.",
      400,
    );
  }
  const itemKind = items[0].kind;
  const expected =
    kind === AssignmentKind.WORKSHEET
      ? AssignmentItemKind.UNIT
      : kind === AssignmentKind.PAGE
        ? AssignmentItemKind.PAGE
        : AssignmentItemKind.EXERCISE;
  if (itemKind !== expected) {
    throw new ApiError(
      "El objetivo no coincide con el tipo de actividad.",
      400,
    );
  }
}

export async function parseCreateAssignmentInput(
  body: Record<string, unknown>,
  now = new Date(),
): Promise<CreateAssignmentInput> {
  const kind = enumField(
    body.kind,
    "kind",
    Object.values(AssignmentKind),
  );
  const title = requiredString(body.title, "title", { maxLength: 160 });
  const instructions = optionalString(body.instructions, "instructions", {
    maxLength: 2_000,
  });
  const teacherId = requiredString(body.teacherId, "teacherId", {
    maxLength: 100,
  });
  const courseId = optionalString(body.courseId, "courseId", {
    maxLength: 100,
  });
  const groupLabel = optionalString(body.groupLabel, "groupLabel", {
    maxLength: 100,
  });
  const availableFrom = dateField(body.availableFrom, "availableFrom", {
    optional: true,
  });
  const expiresAt = dateField(body.expiresAt, "expiresAt");
  if (!expiresAt) {
    throw new ApiError('El campo "expiresAt" es obligatorio.', 400);
  }
  if (
    expiresAt.getTime() <= now.getTime() ||
    expiresAt.getTime() - now.getTime() > MAX_ASSIGNMENT_LIFETIME_MS
  ) {
    throw new ApiError(
      "La tarea debe vencer en el futuro y dentro de los próximos 366 días.",
      400,
    );
  }
  if (availableFrom && availableFrom.getTime() >= expiresAt.getTime()) {
    throw new ApiError(
      "La fecha de inicio debe ser anterior al vencimiento.",
      400,
    );
  }

  const requestedItems = itemObjects(body.items);
  const items = await Promise.all(
    requestedItems.map((item, index) => snapshotItem(item, index)),
  );
  assertKindShape(kind, items);
  const identities = new Set<string>();
  for (const item of items) {
    const identity = [
      item.kind,
      item.bookId,
      item.unitId ?? "",
      item.pages.join(","),
      item.exerciseId ?? "",
      item.exerciseRevision ?? "",
    ].join(":");
    if (identities.has(identity)) {
      throw new ApiError("La tarea contiene objetivos repetidos.", 400);
    }
    identities.add(identity);
  }

  const maxHintLevel = integerField(body.maxHintLevel, "maxHintLevel", {
    minimum: 0,
    maximum: 3,
    defaultValue: 3,
  });
  const minimumTurnsPerItem = integerField(
    body.minimumTurnsPerItem,
    "minimumTurnsPerItem",
    {
      minimum: 0,
      maximum: 40,
      defaultValue: items.every(
        (item) => item.kind === AssignmentItemKind.EXERCISE,
      )
        ? 1
        : 0,
    },
  );
  const requiredItemCount = integerField(
    body.requiredItemCount,
    "requiredItemCount",
    {
      minimum: 1,
      maximum: items.length,
      defaultValue: items.length,
    },
  );

  return {
    kind,
    title,
    instructions,
    teacherId,
    courseId,
    groupLabel,
    availableFrom,
    expiresAt,
    maxHintLevel,
    requiredItemCount,
    minimumTurnsPerItem,
    items,
  };
}

export async function assignmentItemSnapshotIsCurrent(item: {
  kind: AssignmentItemKindValue;
  bookId: string;
  bookSha256: string;
  curriculumVersion: string;
  unitId: string | null;
  pages: readonly number[];
  exerciseId: string | null;
  exerciseRevision: number | null;
}): Promise<boolean> {
  const book = getBook(item.bookId);
  const curriculum = getBookCurriculum(item.bookId);
  if (
    !book ||
    !curriculum ||
    book.expectedSha256 !== item.bookSha256 ||
    curriculum.version !== item.curriculumVersion
  ) {
    return false;
  }

  if (item.kind === AssignmentItemKind.UNIT) {
    const unit = curriculum.units.find(
      (candidate) => candidate.id === item.unitId,
    );
    if (!unit) return false;
    const pages = Array.from(
      { length: unit.endPage - unit.startPage + 1 },
      (_, offset) => unit.startPage + offset,
    );
    return pages.join(",") === item.pages.join(",");
  }
  if (item.kind === AssignmentItemKind.PAGE) {
    return (
      item.pages.length === 1 &&
      item.pages[0] >= 1 &&
      item.pages[0] <= book.pages &&
      getPageActivity(book.id, item.pages[0]).unitId === item.unitId
    );
  }
  if (!item.exerciseId || !item.exerciseRevision) {
    return false;
  }
  try {
    const exercise = await getPublishedExercise(
      item.bookId,
      item.exerciseId,
    );
    return Boolean(
      exercise &&
        exercise.revision === item.exerciseRevision &&
        exercise.unitId === item.unitId &&
        orderedUniquePages(
          exercise.regions.map((region) => region.page),
        ).join(",") === item.pages.join(","),
    );
  } catch {
    return false;
  }
}
