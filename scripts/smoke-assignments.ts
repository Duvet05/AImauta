import { randomUUID } from "node:crypto";

import { parseCreateAssignmentInput } from "@/lib/assignment-content";
import {
  assignmentProgressForAdmin,
  completeAssignmentItem,
  createAssignment,
  createAssignmentRun,
  recordAssignmentLearningProgress,
  resolvePublicAssignment,
  startAssignmentItemSession,
  verifyCompletionReceipt
} from "@/lib/assignment-service";
import { recordLearningTurn } from "@/lib/learning-session";
import { prisma } from "@/lib/prisma";

function invariant(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const teacher = await prisma.teacher.create({
    data: {
      firstName: "QR",
      lastName: `Smoke ${suffix}`,
      email: `qr-smoke-${suffix}@example.test`
    }
  });
  let assignmentId: string | null = null;

  try {
    const parsed = await parseCreateAssignmentInput({
      kind: "PAGE",
      title: "Prueba integral QR",
      teacherId: teacher.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      minimumTurnsPerItem: 1,
      items: [
        {
          kind: "PAGE",
          bookId: "fichas-matematica-1-secundaria",
          page: 13
        }
      ]
    });
    const created = await createAssignment(parsed);
    assignmentId = created.assignment.id;
    invariant(
      !JSON.stringify(created.assignment).includes(created.publicToken),
      "El token público apareció dentro del registro administrativo."
    );

    const resolved = await resolvePublicAssignment(created.publicToken);
    invariant(resolved.public.items.length === 1, "No se resolvió el objetivo.");
    const itemId = resolved.public.items[0].id;

    const startedRun = await createAssignmentRun(created.publicToken);
    const learning = await startAssignmentItemSession({
      resumeToken: startedRun.resumeToken,
      itemId
    });
    const turn = recordLearningTurn({
      token: learning.session.token,
      attempt: "Primero compararía los datos que aparecen en el ejercicio."
    });
    await recordAssignmentLearningProgress(turn.state);
    const resumedLearning = await startAssignmentItemSession({
      resumeToken: startedRun.resumeToken,
      itemId
    });
    invariant(
      resumedLearning.session.state.assignment?.turnCountBase === 1,
      "La reanudación no conservó la base de progreso."
    );
    const resumedTurn = recordLearningTurn({
      token: resumedLearning.session.token,
      attempt: "Después comprobaría el resultado con otra representación."
    });
    await recordAssignmentLearningProgress(resumedTurn.state);

    const [completed, repeatedCompletion] = await Promise.all([
      completeAssignmentItem({
        resumeToken: startedRun.resumeToken,
        itemId
      }),
      completeAssignmentItem({
        resumeToken: startedRun.resumeToken,
        itemId
      })
    ]);
    invariant(completed.receipt?.token, "No se emitió el comprobante.");
    invariant(
      repeatedCompletion.receipt?.token === completed.receipt.token,
      "La finalización concurrente emitió comprobantes distintos."
    );
    const receipt = await verifyCompletionReceipt(completed.receipt.token);
    invariant(receipt.verified, "El comprobante no se pudo verificar.");

    const progress = await assignmentProgressForAdmin({
      id: created.assignment.id,
      teacherId: teacher.id
    });
    invariant(
      progress.runs.COMPLETED === 1,
      "El agregado docente no registró la finalización."
    );
    invariant(
      progress.items[0].states.some(
        (state) =>
          state.status === "COMPLETED" &&
          state.averages.turnCount === 2
      ),
      "El agregado no conservó los turnos entre reanudaciones."
    );

    process.stdout.write(
      "✓ QR assignment smoke: create → resolve → resume → learn → complete → verify\n"
    );
  } finally {
    if (assignmentId) {
      await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    }
    await prisma.teacher.deleteMany({ where: { id: teacher.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
