"use server";

import { revalidatePath } from "next/cache";

import { requireTeacherSession } from "@/app/docente/guard";
import { parseCreateAssignmentInput } from "@/lib/assignment-content";
import {
  createAssignment as createSecureAssignment,
  patchAssignment,
} from "@/lib/assignment-service";
import type { ProgressStatus } from "@/lib/generated/prisma/client";
import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: true } | { ok: false; message: string };

const PROGRESS_STATUSES: readonly ProgressStatus[] = [
  "EXCELLING",
  "ON_TRACK",
  "NEEDS_SUPPORT",
  "AT_RISK",
];

/**
 * Records qualitative feedback for a student in a course. ProgressNote is
 * append-only by design, so this always creates: the history of how a student
 * moved is what makes the panel useful, and overwriting would erase it.
 *
 * This is the teacher's own observation of a named student in their class, and
 * is unrelated to assignment runs, which stay anonymous.
 */
export async function recordProgressNote(
  formData: FormData,
): Promise<ActionResult> {
  await requireTeacherSession();

  const enrollmentId = readString(formData, "enrollmentId");
  const teacherId = readString(formData, "teacherId");
  const feedback = readString(formData, "feedback").slice(0, 1_000);
  const status = readString(formData, "status") as ProgressStatus;

  if (!enrollmentId || !teacherId) {
    return { ok: false, message: "Falta identificar al estudiante o al docente." };
  }
  if (!feedback) {
    return { ok: false, message: "Escribe una observación antes de guardar." };
  }
  if (!PROGRESS_STATUSES.includes(status)) {
    return { ok: false, message: "Elige en qué situación está el estudiante." };
  }

  // The enrollment must belong to a course this teacher actually teaches.
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, course: { teachers: { some: { id: teacherId } } } },
    select: { id: true, courseId: true },
  });
  if (!enrollment) {
    return { ok: false, message: "No puedes registrar avance en ese curso." };
  }

  await prisma.progressNote.create({
    data: { enrollmentId, teacherId, feedback, status },
  });

  revalidatePath(`/docente/${enrollment.courseId}`);
  return { ok: true };
}

/**
 * Creates the assignment through the canonical snapshot parser and service.
 * The service hashes and encrypts the public token before persisting it.
 */
export async function createAssignment(
  formData: FormData,
): Promise<ActionResult> {
  await requireTeacherSession();

  const teacherId = readString(formData, "teacherId");
  const courseId = readString(formData, "courseId");
  if (!teacherId || !courseId) {
    return { ok: false, message: "Falta identificar el curso o el docente." };
  }

  const bookId = readString(formData, "bookId");
  const title = readString(formData, "title");
  const instructions = readString(formData, "instructions");
  if (!bookId || !title) {
    return { ok: false, message: "Elige un cuaderno y escribe un nombre." };
  }

  const scope = readString(formData, "scope");
  let items: Array<Record<string, unknown>>;
  if (scope === "UNIT") {
    const unitId = readString(formData, "unitId");
    if (!unitId) {
      return { ok: false, message: "Elige una ficha válida." };
    }
    items = [{ kind: "UNIT", bookId, unitId }];
  } else if (scope === "EXERCISE") {
    const exerciseId = readString(formData, "exerciseId");
    if (!exerciseId) {
      return { ok: false, message: "Elige un ejercicio publicado." };
    }
    items = [{ kind: "EXERCISE", bookId, exerciseId }];
  } else if (scope === "PAGE") {
    const firstPage = readInteger(formData, "firstPage");
    const lastPage = readInteger(formData, "lastPage");
    if (
      firstPage === null ||
      lastPage === null ||
      firstPage < 1 ||
      lastPage < firstPage
    ) {
      return { ok: false, message: "Elige un rango de páginas válido." };
    }
    if (lastPage - firstPage + 1 > 50) {
      return {
        ok: false,
        message: "Una tarea puede incluir como máximo 50 páginas.",
      };
    }
    items = Array.from(
      { length: lastPage - firstPage + 1 },
      (_, offset) => ({
        kind: "PAGE",
        bookId,
        page: firstPage + offset,
      }),
    );
  } else {
    return { ok: false, message: "Elige qué contenido quieres asignar." };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);

  try {
    const input = await parseCreateAssignmentInput({
      kind: "TASK",
      title,
      ...(instructions ? { instructions } : {}),
      teacherId,
      courseId,
      availableFrom: null,
      expiresAt: expiresAt.toISOString(),
      maxHintLevel: 3,
      minimumTurnsPerItem: 0,
      requiredItemCount: items.length,
      items,
    });

    await createSecureAssignment(input);
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  revalidatePath(`/docente/${courseId}`);
  return { ok: true };
}

/**
 * Revocation preserves aggregate anonymous runs while stopping new access.
 */
export async function closeAssignment(
  formData: FormData,
): Promise<ActionResult> {
  await requireTeacherSession();

  const assignmentId = readString(formData, "assignmentId");
  const teacherId = readString(formData, "teacherId");
  if (!assignmentId || !teacherId) {
    return { ok: false, message: "Falta identificar la tarea." };
  }

  try {
    const assignment = await patchAssignment({
      id: assignmentId,
      teacherId,
      body: { status: "REVOKED" },
    });
    revalidatePath(
      assignment.course?.id
        ? `/docente/${assignment.course.id}`
        : "/docente",
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
  return { ok: true };
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(formData: FormData, key: string): number | null {
  const value = readString(formData, key);
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
