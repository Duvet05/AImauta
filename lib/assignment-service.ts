import {
  AssignmentItemKind,
  AssignmentItemProgressStatus,
  AssignmentRunStatus,
  AssignmentStatus,
  Prisma,
  type AssignmentStatus as AssignmentStatusValue,
} from "@/lib/generated/prisma/client";
import { getBook } from "@/lib/catalog";
import {
  assignmentItemSnapshotIsCurrent,
  type CreateAssignmentInput,
} from "@/lib/assignment-content";
import {
  assignmentReceiptUrl,
  assignmentShareUrl,
  decryptAssignmentToken,
  encryptAssignmentToken,
  generateAssignmentToken,
  hashAssignmentToken,
} from "@/lib/assignment-security";
import { getPublishedExercise } from "@/lib/exercise-store";
import { ApiError, optionalString } from "@/lib/http";
import {
  issueLearningSession,
  type LearningAssignmentBinding,
  type LearningSessionState,
} from "@/lib/learning-session";
import { prisma } from "@/lib/prisma";

const MAX_ASSIGNMENT_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;

const assignmentInclude = {
  items: { orderBy: { position: "asc" as const } },
  teacher: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  course: {
    include: {
      grade: { include: { level: true } },
    },
  },
  _count: { select: { runs: true } },
} satisfies Prisma.AssignmentInclude;

const publicAssignmentInclude = {
  items: { orderBy: { position: "asc" as const } },
} satisfies Prisma.AssignmentInclude;

const runInclude = {
  assignment: {
    include: {
      items: { orderBy: { position: "asc" as const } },
    },
  },
  progress: {
    include: { item: true },
    orderBy: { item: { position: "asc" as const } },
  },
} satisfies Prisma.AssignmentRunInclude;

type AdminAssignment = Prisma.AssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;
type PublicAssignment = Prisma.AssignmentGetPayload<{
  include: typeof publicAssignmentInclude;
}>;
type AssignmentRunDetail = Prisma.AssignmentRunGetPayload<{
  include: typeof runInclude;
}>;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function assertAssignmentUsable(
  assignment: {
    status: AssignmentStatusValue;
    availableFrom: Date | null;
    expiresAt: Date;
  },
  now = new Date(),
): void {
  if (assignment.status !== AssignmentStatus.ACTIVE) {
    throw new ApiError("Esta tarea ya no está disponible.", 410);
  }
  if (assignment.availableFrom && assignment.availableFrom > now) {
    throw new ApiError("Esta tarea todavía no está disponible.", 403);
  }
  if (assignment.expiresAt <= now) {
    throw new ApiError("Esta tarea venció.", 410);
  }
}

async function assertAssignmentContentCurrent(
  assignment: PublicAssignment,
): Promise<void> {
  const current = await Promise.all(
    assignment.items.map((item) => assignmentItemSnapshotIsCurrent(item)),
  );
  if (current.some((value) => !value)) {
    throw new ApiError(
      "La versión del material de esta tarea cambió. El docente debe generar un enlace nuevo.",
      410,
    );
  }
}

function presentAdminAssignment(assignment: AdminAssignment) {
  return {
    id: assignment.id,
    kind: assignment.kind,
    status: assignment.status,
    title: assignment.title,
    instructions: assignment.instructions,
    groupLabel: assignment.groupLabel,
    availableFrom: iso(assignment.availableFrom),
    expiresAt: assignment.expiresAt.toISOString(),
    maxHintLevel: assignment.maxHintLevel,
    requiredItemCount: assignment.requiredItemCount,
    minimumTurnsPerItem: assignment.minimumTurnsPerItem,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
    teacher: assignment.teacher,
    course: assignment.course,
    items: assignment.items.map((item) => ({
      id: item.id,
      position: item.position,
      kind: item.kind,
      bookId: item.bookId,
      bookSha256: item.bookSha256,
      curriculumVersion: item.curriculumVersion,
      unitId: item.unitId,
      pages: [...item.pages],
      exerciseId: item.exerciseId,
      exerciseRevision: item.exerciseRevision,
      label: item.label,
      title: item.title,
    })),
    runCount: assignment._count.runs,
  };
}

function presentPublicAssignment(
  assignment: PublicAssignment,
  publicToken: string | null,
) {
  return {
    kind: assignment.kind,
    title: assignment.title,
    instructions: assignment.instructions,
    availableFrom: iso(assignment.availableFrom),
    expiresAt: assignment.expiresAt.toISOString(),
    maxHintLevel: assignment.maxHintLevel,
    completionCriteria: {
      requiredItemCount: assignment.requiredItemCount,
      minimumTurnsPerItem: assignment.minimumTurnsPerItem,
      totalItemCount: assignment.items.length,
    },
    items: assignment.items.map((item) => {
      const book = getBook(item.bookId);
      return {
        id: item.id,
        position: item.position,
        kind: item.kind,
        bookId: item.bookId,
        bookTitle: book?.title ?? item.bookId,
        edition: book?.edition ?? null,
        unitId: item.unitId,
        pages: [...item.pages],
        exerciseId: item.exerciseId,
        exerciseRevision: item.exerciseRevision,
        label: item.label,
        title: item.title,
        launchPath: publicToken
          ? `/a/${encodeURIComponent(publicToken)}/${encodeURIComponent(item.id)}`
          : null,
      };
    }),
  };
}

function presentRun(run: AssignmentRunDetail) {
  return {
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    lastActivityAt: run.lastActivityAt.toISOString(),
    completedAt: iso(run.completedAt),
    completionCriteria: {
      requiredItemCount: run.assignment.requiredItemCount,
      minimumTurnsPerItem: run.assignment.minimumTurnsPerItem,
      totalItemCount: run.assignment.items.length,
    },
    progress: run.progress.map((progress) => ({
      itemId: progress.assignmentItemId,
      position: progress.item.position,
      status: progress.status,
      turnCount: progress.turnCount,
      attemptCount: progress.attemptCount,
      hintLevel: progress.hintLevel,
      startedAt: iso(progress.startedAt),
      completedAt: iso(progress.completedAt),
    })),
  };
}

async function assignmentForAdmin(
  id: string,
  teacherId: string,
): Promise<AdminAssignment> {
  const assignment = await prisma.assignment.findFirst({
    where: { id, teacherId },
    include: assignmentInclude,
  });
  if (!assignment) {
    throw new ApiError("Tarea no encontrada.", 404);
  }
  return assignment;
}

async function assertTeacherCanAssignCourse(
  teacherId: string,
  courseId?: string,
): Promise<void> {
  const teacher = await prisma.teacher.findFirst({
    where: {
      id: teacherId,
      ...(courseId
        ? { courses: { some: { id: courseId } } }
        : {}),
    },
    select: { id: true },
  });
  if (!teacher) {
    throw new ApiError(
      courseId
        ? "El docente no pertenece al curso indicado."
        : "Docente no encontrado.",
      400,
    );
  }
}

export async function createAssignment(input: CreateAssignmentInput) {
  await assertTeacherCanAssignCourse(input.teacherId, input.courseId);
  const publicToken = generateAssignmentToken();
  const assignment = await prisma.assignment.create({
    data: {
      publicTokenHash: hashAssignmentToken(
        "assignment-public",
        publicToken,
      ),
      publicTokenCiphertext: encryptAssignmentToken(
        "assignment-public",
        publicToken,
      ),
      kind: input.kind,
      title: input.title,
      instructions: input.instructions,
      teacherId: input.teacherId,
      courseId: input.courseId,
      groupLabel: input.groupLabel,
      availableFrom: input.availableFrom,
      expiresAt: input.expiresAt,
      maxHintLevel: input.maxHintLevel,
      requiredItemCount: input.requiredItemCount,
      minimumTurnsPerItem: input.minimumTurnsPerItem,
      items: {
        create: input.items.map((item) => ({
          position: item.position,
          kind: item.kind,
          bookId: item.bookId,
          bookSha256: item.bookSha256,
          curriculumVersion: item.curriculumVersion,
          unitId: item.unitId,
          pages: item.pages,
          exerciseId: item.exerciseId,
          exerciseRevision: item.exerciseRevision,
          label: item.label,
          title: item.title,
        })),
      },
    },
    include: assignmentInclude,
  });
  return {
    assignment: presentAdminAssignment(assignment),
    publicToken,
    shareUrl: assignmentShareUrl(publicToken),
  };
}

export async function listAssignments(input: {
  teacherId: string;
  skip: number;
  take: number;
}) {
  const where: Prisma.AssignmentWhereInput = {
    teacherId: input.teacherId,
  };
  const [assignments, total] = await prisma.$transaction([
    prisma.assignment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: input.skip,
      take: input.take,
      include: assignmentInclude,
    }),
    prisma.assignment.count({ where }),
  ]);
  return {
    assignments: assignments.map(presentAdminAssignment),
    total,
  };
}

export async function getAssignmentForAdmin(
  id: string,
  teacherId: string,
) {
  return presentAdminAssignment(await assignmentForAdmin(id, teacherId));
}

function optionalDatePatch(
  value: unknown,
  field: string,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 64) {
    throw new ApiError(
      `El campo "${field}" debe ser una fecha ISO 8601.`,
      400,
    );
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new ApiError(
      `El campo "${field}" debe ser una fecha ISO 8601 canónica.`,
      400,
    );
  }
  return date;
}

function optionalIntegerPatch(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ApiError(
      `El campo "${field}" debe ser un entero entre ${minimum} y ${maximum}.`,
      400,
    );
  }
  return value;
}

export async function patchAssignment(input: {
  id: string;
  teacherId: string;
  body: Record<string, unknown>;
}) {
  const current = await assignmentForAdmin(input.id, input.teacherId);
  const title = optionalString(input.body.title, "title", {
    maxLength: 160,
  });
  const groupLabel =
    input.body.groupLabel === null
      ? null
      : optionalString(input.body.groupLabel, "groupLabel", {
          maxLength: 100,
        });
  const instructions =
    input.body.instructions === null
      ? null
      : optionalString(input.body.instructions, "instructions", {
          maxLength: 2_000,
        });
  const availableFrom = optionalDatePatch(
    input.body.availableFrom,
    "availableFrom",
  );
  const expiresAt = optionalDatePatch(input.body.expiresAt, "expiresAt");
  if (expiresAt === null) {
    throw new ApiError("El vencimiento no puede eliminarse.", 400);
  }
  const effectiveExpiry = expiresAt ?? current.expiresAt;
  const effectiveStart =
    availableFrom === undefined ? current.availableFrom : availableFrom;
  const currentTime = new Date();
  if (
    (expiresAt !== undefined || availableFrom !== undefined) &&
    (effectiveExpiry <= currentTime ||
      effectiveExpiry.getTime() - currentTime.getTime() >
        MAX_ASSIGNMENT_LIFETIME_MS ||
      (effectiveStart && effectiveStart >= effectiveExpiry))
  ) {
    throw new ApiError(
      "Las fechas de disponibilidad y vencimiento no son válidas.",
      400,
    );
  }
  const maxHintLevel = optionalIntegerPatch(
    input.body.maxHintLevel,
    "maxHintLevel",
    0,
    3,
  );
  const minimumTurnsPerItem = optionalIntegerPatch(
    input.body.minimumTurnsPerItem,
    "minimumTurnsPerItem",
    0,
    40,
  );
  const requiredItemCount = optionalIntegerPatch(
    input.body.requiredItemCount,
    "requiredItemCount",
    1,
    current.items.length,
  );
  let status: AssignmentStatusValue | undefined;
  if (input.body.status !== undefined) {
    if (
      typeof input.body.status !== "string" ||
      !Object.values(AssignmentStatus).includes(
        input.body.status as AssignmentStatusValue,
      )
    ) {
      throw new ApiError('El campo "status" no es válido.', 400);
    }
    status = input.body.status as AssignmentStatusValue;
  }
  if (
    title === undefined &&
    groupLabel === undefined &&
    instructions === undefined &&
    availableFrom === undefined &&
    expiresAt === undefined &&
    maxHintLevel === undefined &&
    minimumTurnsPerItem === undefined &&
    requiredItemCount === undefined &&
    status === undefined
  ) {
    throw new ApiError("No hay campos para actualizar.", 400);
  }

  const updated = await prisma.assignment.update({
    where: { id: current.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(groupLabel !== undefined ? { groupLabel } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(availableFrom !== undefined ? { availableFrom } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(maxHintLevel !== undefined ? { maxHintLevel } : {}),
      ...(minimumTurnsPerItem !== undefined
        ? { minimumTurnsPerItem }
        : {}),
      ...(requiredItemCount !== undefined ? { requiredItemCount } : {}),
      ...(status !== undefined ? { status } : {}),
    },
    include: assignmentInclude,
  });
  return presentAdminAssignment(updated);
}

export async function rotateAssignmentPublicToken(input: {
  id: string;
  teacherId: string;
}) {
  const current = await assignmentForAdmin(input.id, input.teacherId);
  const publicToken = generateAssignmentToken();
  const assignment = await prisma.assignment.update({
    where: { id: current.id },
    data: {
      publicTokenHash: hashAssignmentToken(
        "assignment-public",
        publicToken,
      ),
      publicTokenCiphertext: encryptAssignmentToken(
        "assignment-public",
        publicToken,
      ),
    },
    include: assignmentInclude,
  });
  return {
    assignment: presentAdminAssignment(assignment),
    publicToken,
    shareUrl: assignmentShareUrl(publicToken),
  };
}

export async function assignmentShareForAdmin(input: {
  id: string;
  teacherId: string;
}) {
  const assignment = await assignmentForAdmin(input.id, input.teacherId);
  const publicToken = decryptAssignmentToken(
    "assignment-public",
    assignment.publicTokenCiphertext,
  );
  if (
    hashAssignmentToken("assignment-public", publicToken) !==
    assignment.publicTokenHash
  ) {
    throw new ApiError("El token almacenado de la tarea no es íntegro.", 500);
  }
  return {
    assignment: presentAdminAssignment(assignment),
    publicToken,
    shareUrl: assignmentShareUrl(publicToken),
  };
}

export async function resolvePublicAssignment(
  publicToken: string,
  now = new Date(),
) {
  const assignment = await prisma.assignment.findUnique({
    where: {
      publicTokenHash: hashAssignmentToken(
        "assignment-public",
        publicToken,
      ),
    },
    include: publicAssignmentInclude,
  });
  if (!assignment) {
    throw new ApiError("Enlace no encontrado.", 404);
  }
  assertAssignmentUsable(assignment, now);
  await assertAssignmentContentCurrent(assignment);
  return {
    assignment,
    public: presentPublicAssignment(assignment, publicToken),
  };
}

export async function createAssignmentRun(
  publicToken: string,
  now = new Date(),
) {
  const resolved = await resolvePublicAssignment(publicToken, now);
  const resumeToken = generateAssignmentToken();
  const run = await prisma.assignmentRun.create({
    data: {
      assignmentId: resolved.assignment.id,
      resumeTokenHash: hashAssignmentToken(
        "assignment-resume",
        resumeToken,
      ),
      startedAt: now,
      lastActivityAt: now,
      progress: {
        create: resolved.assignment.items.map((item) => ({
          assignmentItemId: item.id,
        })),
      },
    },
    include: runInclude,
  });
  return {
    resumeToken,
    run: presentRun(run),
    assignment: resolved.public,
  };
}

async function runByResumeToken(
  resumeToken: string,
  now = new Date(),
): Promise<AssignmentRunDetail> {
  const run = await prisma.assignmentRun.findUnique({
    where: {
      resumeTokenHash: hashAssignmentToken(
        "assignment-resume",
        resumeToken,
      ),
    },
    include: runInclude,
  });
  if (!run) {
    throw new ApiError("Sesión de tarea no encontrada.", 404);
  }
  assertAssignmentUsable(run.assignment, now);
  await assertAssignmentContentCurrent(run.assignment);
  return run;
}

export async function resumeAssignmentRun(
  resumeToken: string,
  now = new Date(),
) {
  const run = await runByResumeToken(resumeToken, now);
  return {
    run: presentRun(run),
    assignment: presentPublicAssignment(run.assignment, null),
    receipt:
      run.status === AssignmentRunStatus.COMPLETED &&
      run.receiptTokenCiphertext
        ? (() => {
            const token = decryptAssignmentToken(
              "assignment-receipt",
              run.receiptTokenCiphertext,
            );
            return {
              token,
              url: assignmentReceiptUrl(token),
            };
          })()
        : null,
  };
}

function assignmentBindingForItem(input: {
  assignmentId: string;
  runId: string;
  maxHintLevel: number;
  item: {
    id: string;
    pages: readonly number[];
    exerciseId: string | null;
    exerciseRevision: number | null;
  };
  turnCountBase: number;
  attemptCountBase: number;
}): LearningAssignmentBinding {
  return {
    assignmentId: input.assignmentId,
    runId: input.runId,
    itemId: input.item.id,
    allowedPages: [...input.item.pages],
    exerciseId: input.item.exerciseId,
    exerciseRevision: input.item.exerciseRevision,
    maxHintLevel: input.maxHintLevel as 0 | 1 | 2 | 3,
    turnCountBase: input.turnCountBase,
    attemptCountBase: input.attemptCountBase,
  };
}

export async function startAssignmentItemSession(input: {
  resumeToken: string;
  itemId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const run = await runByResumeToken(input.resumeToken, now);
  if (run.status !== AssignmentRunStatus.IN_PROGRESS) {
    throw new ApiError("Esta tarea ya fue completada.", 409);
  }
  const progress = run.progress.find(
    (candidate) => candidate.assignmentItemId === input.itemId,
  );
  if (!progress) {
    throw new ApiError("Objetivo de tarea no encontrado.", 404);
  }
  if (progress.status === AssignmentItemProgressStatus.COMPLETED) {
    throw new ApiError("Este objetivo ya fue completado.", 409);
  }
  const item = progress.item;
  if (!(await assignmentItemSnapshotIsCurrent(item))) {
    throw new ApiError("El contenido asignado ya no está vigente.", 410);
  }

  let exercise = null;
  if (
    item.kind === AssignmentItemKind.EXERCISE &&
    item.exerciseId &&
    item.exerciseRevision
  ) {
    try {
      const published = await getPublishedExercise(
        item.bookId,
        item.exerciseId,
      );
      if (!published || published.revision !== item.exerciseRevision) {
        throw new ApiError("El ejercicio asignado ya no está vigente.", 410);
      }
      exercise = {
        id: published.id,
        revision: published.revision,
        unitId: published.unitId,
        stage: published.stage,
        pages: [...new Set(published.regions.map((region) => region.page))],
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "El ejercicio asignado no está disponible.",
        503,
      );
    }
  }
  const binding = assignmentBindingForItem({
    assignmentId: run.assignmentId,
    runId: run.id,
    maxHintLevel: run.assignment.maxHintLevel,
    item,
    turnCountBase: progress.turnCount,
    attemptCountBase: progress.attemptCount,
  });
  const session = issueLearningSession({
    bookId: item.bookId,
    page: item.pages[0],
    exercise,
    assignment: binding,
    initialHintLevel: progress.hintLevel as 0 | 1 | 2 | 3,
  });

  await prisma.$transaction(async (transaction) => {
    const activeRun = await transaction.assignmentRun.updateMany({
      where: {
        id: run.id,
        status: AssignmentRunStatus.IN_PROGRESS,
      },
      data: { lastActivityAt: now },
    });
    if (activeRun.count !== 1) {
      throw new ApiError("Esta tarea ya fue completada.", 409);
    }
    const activeItem =
      await transaction.assignmentItemProgress.updateMany({
        where: {
          id: progress.id,
          status: { not: AssignmentItemProgressStatus.COMPLETED },
        },
        data: {
          status: AssignmentItemProgressStatus.IN_PROGRESS,
          startedAt: progress.startedAt ?? now,
        },
      });
    if (activeItem.count !== 1) {
      throw new ApiError("Este objetivo ya fue completado.", 409);
    }
  });

  return {
    item: {
      id: item.id,
      kind: item.kind,
      bookId: item.bookId,
      pages: [...item.pages],
      exerciseId: item.exerciseId,
      exerciseRevision: item.exerciseRevision,
      label: item.label,
      title: item.title,
    },
    session,
  };
}

export async function recordAssignmentLearningProgress(
  state: LearningSessionState,
  now = new Date(),
): Promise<void> {
  const binding = state.assignment;
  if (!binding) return;

  await prisma.$transaction(async (transaction) => {
    const progress = await transaction.assignmentItemProgress.findUnique({
      where: {
        runId_assignmentItemId: {
          runId: binding.runId,
          assignmentItemId: binding.itemId,
        },
      },
    });
    const run = progress
      ? await transaction.assignmentRun.findUnique({
          where: { id: progress.runId },
        })
      : null;
    const assignment = run
      ? await transaction.assignment.findUnique({
          where: { id: run.assignmentId },
        })
      : null;
    if (
      !progress ||
      !run ||
      !assignment ||
      progress.assignmentId !== binding.assignmentId ||
      run.assignmentId !== binding.assignmentId
    ) {
      throw new ApiError("La tarea vinculada a la sesión no existe.", 410);
    }
    assertAssignmentUsable(assignment, now);
    if (
      run.status !== AssignmentRunStatus.IN_PROGRESS ||
      progress.status === AssignmentItemProgressStatus.COMPLETED
    ) {
      throw new ApiError("La tarea vinculada ya fue completada.", 409);
    }
    const activeRun = await transaction.assignmentRun.updateMany({
      where: {
        id: progress.runId,
        status: AssignmentRunStatus.IN_PROGRESS,
      },
      data: { lastActivityAt: now },
    });
    if (activeRun.count !== 1) {
      throw new ApiError("La tarea vinculada ya fue completada.", 409);
    }
    const activeItem =
      await transaction.assignmentItemProgress.updateMany({
        where: {
          id: progress.id,
          status: AssignmentItemProgressStatus.IN_PROGRESS,
        },
        data: {
          turnCount: Math.max(
            progress.turnCount,
            binding.turnCountBase + state.totalTurnCount,
          ),
          attemptCount: Math.max(
            progress.attemptCount,
            binding.attemptCountBase + state.attemptCount,
          ),
          hintLevel: Math.min(
            binding.maxHintLevel,
            Math.max(progress.hintLevel, state.hintLevel),
          ),
        },
      });
    if (activeItem.count !== 1) {
      throw new ApiError("El objetivo vinculado ya fue completado.", 409);
    }
  });
}

export async function completeAssignmentItem(input: {
  resumeToken: string;
  itemId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const run = await runByResumeToken(input.resumeToken, now);
  const completion = await prisma.$transaction(async (transaction) => {
    const lockedRows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "AssignmentRun"
        WHERE "id" = ${run.id}
        FOR UPDATE
      `,
    );
    if (lockedRows.length !== 1) {
      throw new ApiError("Sesión de tarea no encontrada.", 404);
    }

    const lockedRun = await transaction.assignmentRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const assignment = await transaction.assignment.findUniqueOrThrow({
      where: { id: lockedRun.assignmentId },
    });
    const progressRows =
      await transaction.assignmentItemProgress.findMany({
        where: { runId: lockedRun.id },
      });
    assertAssignmentUsable(assignment, now);
    const progress = progressRows.find(
      (candidate) => candidate.assignmentItemId === input.itemId,
    );
    if (!progress) {
      throw new ApiError("Objetivo de tarea no encontrado.", 404);
    }

    let receiptToken: string | null =
      lockedRun.receiptTokenCiphertext
        ? decryptAssignmentToken(
            "assignment-receipt",
            lockedRun.receiptTokenCiphertext,
          )
        : null;
    if (lockedRun.status === AssignmentRunStatus.COMPLETED) {
      return { receiptToken };
    }
    if (
      progress.status !== AssignmentItemProgressStatus.COMPLETED &&
      progress.turnCount < assignment.minimumTurnsPerItem
    ) {
      throw new ApiError(
        `Completa al menos ${assignment.minimumTurnsPerItem} turno(s) de acompañamiento antes de finalizar este objetivo.`,
        409,
      );
    }

    const newlyCompleted =
      progress.status === AssignmentItemProgressStatus.COMPLETED ? 0 : 1;
    const completedBefore = progressRows.filter(
      (candidate) =>
        candidate.status === AssignmentItemProgressStatus.COMPLETED,
    ).length;
    const completesRun =
      completedBefore + newlyCompleted >=
      assignment.requiredItemCount;
    if (completesRun && !receiptToken) {
      receiptToken = generateAssignmentToken();
    }

    if (newlyCompleted) {
      await transaction.assignmentItemProgress.update({
        where: { id: progress.id },
        data: {
          status: AssignmentItemProgressStatus.COMPLETED,
          startedAt: progress.startedAt ?? now,
          completedAt: now,
        },
      });
    }
    await transaction.assignmentRun.update({
      where: { id: lockedRun.id },
      data: {
        lastActivityAt: now,
        ...(completesRun && receiptToken
          ? {
              status: AssignmentRunStatus.COMPLETED,
              completedAt: lockedRun.completedAt ?? now,
              receiptTokenHash: hashAssignmentToken(
                "assignment-receipt",
                receiptToken,
              ),
              receiptTokenCiphertext: encryptAssignmentToken(
                "assignment-receipt",
                receiptToken,
              ),
            }
          : {}),
      },
    });
    return { receiptToken };
  });

  const updated = await prisma.assignmentRun.findUniqueOrThrow({
    where: { id: run.id },
    include: runInclude,
  });
  const receiptToken =
    completion.receiptToken ??
    (updated.receiptTokenCiphertext
      ? decryptAssignmentToken(
          "assignment-receipt",
          updated.receiptTokenCiphertext,
        )
      : null);
  return {
    run: presentRun(updated),
    receipt:
      updated.status === AssignmentRunStatus.COMPLETED &&
      receiptToken
        ? {
            token: receiptToken,
            url: assignmentReceiptUrl(receiptToken),
          }
        : null,
  };
}

export async function verifyCompletionReceipt(receiptToken: string) {
  const run = await prisma.assignmentRun.findUnique({
    where: {
      receiptTokenHash: hashAssignmentToken(
        "assignment-receipt",
        receiptToken,
      ),
    },
    include: {
      assignment: {
        include: {
          items: true,
        },
      },
      progress: true,
    },
  });
  if (
    !run ||
    run.status !== AssignmentRunStatus.COMPLETED ||
    !run.completedAt
  ) {
    throw new ApiError("Comprobante no encontrado.", 404);
  }
  const completedItems = run.progress.filter(
    (progress) =>
      progress.status === AssignmentItemProgressStatus.COMPLETED,
  ).length;
  return {
    verified: true,
    assignmentTitle: run.assignment.title,
    completedAt: run.completedAt.toISOString(),
    completedItemCount: completedItems,
    requiredItemCount: run.assignment.requiredItemCount,
    totalItemCount: run.assignment.items.length,
  };
}

export async function assignmentProgressForAdmin(input: {
  id: string;
  teacherId: string;
}) {
  const assignment = await assignmentForAdmin(input.id, input.teacherId);
  const runsByStatus = await prisma.assignmentRun.groupBy({
    by: ["status"],
    where: { assignmentId: assignment.id },
    _count: { _all: true },
  });
  const itemProgress = await prisma.assignmentItemProgress.groupBy({
    by: ["assignmentItemId", "status"],
    where: { assignmentId: assignment.id },
    _count: { _all: true },
    _avg: {
      turnCount: true,
      attemptCount: true,
      hintLevel: true,
    },
  });
  return {
    assignment: presentAdminAssignment(assignment),
    runs: Object.fromEntries(
      runsByStatus.map((entry) => [entry.status, entry._count._all]),
    ),
    items: assignment.items.map((item) => ({
      itemId: item.id,
      position: item.position,
      label: item.label,
      title: item.title,
      states: itemProgress
        .filter((entry) => entry.assignmentItemId === item.id)
        .map((entry) => ({
          status: entry.status,
          count: entry._count._all,
          averages: entry._avg,
        })),
    })),
  };
}
