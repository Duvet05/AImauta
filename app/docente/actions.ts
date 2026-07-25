"use server";

import { revalidatePath } from "next/cache";

import { requireTeacherSession } from "@/app/docente/guard";
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

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
