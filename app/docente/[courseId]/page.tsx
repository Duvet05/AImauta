import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTeacherSession } from "@/app/docente/guard";
import { AssignmentComposer } from "@/components/assignment-composer";
import { AssignmentList } from "@/components/assignment-list";
import { BrandMark } from "@/components/brand-mark";
import { ProgressNoteForm } from "@/components/progress-note-form";
import { autonomyLabels } from "@/lib/assignments";
import { getBooks } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { assignmentUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Curso",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const statusLabels = {
  EXCELLING: { label: "Va muy bien", tone: "excelling" },
  ON_TRACK: { label: "En camino", tone: "ontrack" },
  NEEDS_SUPPORT: { label: "Necesita apoyo", tone: "support" },
  AT_RISK: { label: "Requiere atención", tone: "risk" },
} as const;

export default async function CursoPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ docente?: string }>;
}) {
  await requireTeacherSession();

  const { courseId } = await params;
  const { docente } = await searchParams;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      grade: { include: { level: true } },
      teachers: { orderBy: { lastName: "asc" } },
      enrollments: {
        include: {
          student: true,
          // Only the newest note matters for the current picture; the rest
          // stays in the database as history.
          progressNotes: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      assignments: {
        orderBy: { createdAt: "desc" },
        include: {
          completions: { orderBy: { completedAt: "desc" } },
        },
      },
    },
  });

  if (!course) {
    notFound();
  }

  // Without a teacher in context the panel can display the course but must not
  // offer actions, since every write is scoped to a teacher of this course.
  const activeTeacher =
    course.teachers.find((teacher) => teacher.id === docente) ??
    course.teachers[0] ??
    null;

  const roster = [...course.enrollments].sort((left, right) =>
    `${left.student.lastName} ${left.student.firstName}`.localeCompare(
      `${right.student.lastName} ${right.student.firstName}`,
      "es-PE",
    ),
  );

  const books = getBooks();

  return (
    <main id="contenido-principal" className="panel-page">
      <nav className="topbar shell panel-topbar" aria-label="Navegación del panel">
        <Link className="brand" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <Link className="quiet-link panel-back" href="/docente">
          ← Todos los cursos
        </Link>
      </nav>

      <div className="shell panel-shell">
        <header className="panel-header">
          <p className="eyebrow">
            {course.grade.level.name} · {course.grade.name}
          </p>
          <h1>{course.name}</h1>
          <p className="panel-lead">
            {roster.length}{" "}
            {roster.length === 1 ? "estudiante" : "estudiantes"}
            {activeTeacher
              ? ` · ${activeTeacher.firstName} ${activeTeacher.lastName}`
              : ""}
          </p>
        </header>

        <section className="panel-section" aria-labelledby="estudiantes">
          <h2 id="estudiantes">Cómo va cada estudiante</h2>
          {roster.length === 0 ? (
            <p className="panel-note">
              Este curso todavía no tiene estudiantes matriculados.
            </p>
          ) : (
            <ul className="roster">
              {roster.map((enrollment) => {
                const latest = enrollment.progressNotes[0];
                const status = latest ? statusLabels[latest.status] : null;
                return (
                  <li key={enrollment.id} className="roster-row">
                    <div className="roster-identity">
                      <strong>
                        {enrollment.student.firstName}{" "}
                        {enrollment.student.lastName}
                      </strong>
                      {latest ? (
                        <p className="roster-feedback">{latest.feedback}</p>
                      ) : (
                        <p className="roster-feedback roster-feedback-empty">
                          Sin observaciones registradas.
                        </p>
                      )}
                    </div>

                    <div className="roster-status">
                      {status ? (
                        <span className={`status-pill status-${status.tone}`}>
                          {status.label}
                        </span>
                      ) : (
                        <span className="status-pill status-none">
                          Sin registrar
                        </span>
                      )}
                    </div>

                    {activeTeacher ? (
                      <ProgressNoteForm
                        enrollmentId={enrollment.id}
                        teacherId={activeTeacher.id}
                        studentName={enrollment.student.firstName}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel-section" aria-labelledby="tareas">
          <h2 id="tareas">Tareas asignadas</h2>
          {course.assignments.length === 0 ? (
            <p className="panel-note">
              Aún no has asignado tareas en este curso. Crea la primera abajo.
            </p>
          ) : (
            <AssignmentList
              teacherId={activeTeacher?.id ?? ""}
              assignments={course.assignments.map((assignment) => ({
                id: assignment.id,
                title: assignment.title,
                active: assignment.active,
                firstPage: assignment.firstPage,
                lastPage: assignment.lastPage,
                url: assignmentUrl(assignment.token),
                qrUrl: `/api/assignments/${assignment.id}/qr`,
                completions: assignment.completions.map((completion) => ({
                  id: completion.id,
                  studentAlias: completion.studentAlias,
                  autonomyLabel: autonomyLabels[completion.autonomy].label,
                  teacherHint: autonomyLabels[completion.autonomy].teacherHint,
                  shareToken: completion.shareToken,
                })),
              }))}
            />
          )}
        </section>

        {activeTeacher ? (
          <section className="panel-section" aria-labelledby="nueva-tarea">
            <h2 id="nueva-tarea">Asignar una tarea nueva</h2>
            <AssignmentComposer
              teacherId={activeTeacher.id}
              courseId={course.id}
              books={books.map((book) => ({
                id: book.id,
                title: book.title,
                pages: book.pages,
              }))}
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
