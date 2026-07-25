"use server";

import { revalidatePath } from "next/cache";

import { requireTeacherSession } from "@/app/docente/guard";
import {
  AssignmentValidationError,
  createToken,
  validateAssignmentDraft,
} from "@/lib/assignments";
import type { ProgressStatus } from "@/lib/generated/prisma/client";
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
 * Creates a task and its share token in one step, so the teacher leaves the
 * form with a link and QR ready to hand out.
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

  let draft;
  try {
    draft = validateAssignmentDraft({
      bookId: formData.get("bookId"),
      title: formData.get("title"),
      instructions: formData.get("instructions"),
      firstPage: formData.get("firstPage"),
      lastPage: formData.get("lastPage"),
      unitId: formData.get("unitId"),
    });
  } catch (error) {
    if (error instanceof AssignmentValidationError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, teachers: { some: { id: teacherId } } },
    select: { id: true },
  });
  if (!course) {
    return { ok: false, message: "No puedes asignar tareas en ese curso." };
  }

  await prisma.assignment.create({
    data: { ...draft, teacherId, courseId, token: createToken() },
  });

  revalidatePath(`/docente/${courseId}`);
  return { ok: true };
}

/**
 * Closing a task keeps the record and its completions; it only stops new
 * students from opening the link. Deleting would lose evidence of work already
 * done, which is the opposite of what the panel is for.
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

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, teacherId },
    select: { id: true, courseId: true },
  });
  if (!assignment) {
    return { ok: false, message: "Esa tarea no es tuya." };
  }

  await prisma.assignment.update({
    where: { id: assignment.id },
    data: { active: false },
  });

  revalidatePath(`/docente/${assignment.courseId}`);
  return { ok: true };
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
