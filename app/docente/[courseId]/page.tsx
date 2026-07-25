import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTeacherSession } from "@/app/docente/guard";
import { BrandMark } from "@/components/brand-mark";
import { ProgressNoteForm } from "@/components/progress-note-form";
import { prisma } from "@/lib/prisma";

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

const assignmentStatusLabels = {
  ACTIVE: "Activa",
  REVOKED: "Revocada",
  ARCHIVED: "Archivada",
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
          items: { orderBy: { position: "asc" } },
          _count: { select: { runs: true } },
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
          <h2 id="tareas">Tareas compartidas por QR</h2>
          {course.assignments.length === 0 ? (
            <p className="panel-note">
              Aún no hay tareas en este curso. Se crean desde la API de
              actividades y aparecerán aquí con su avance.
            </p>
          ) : (
            <ul className="assignment-list">
              {course.assignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className={`assignment-row${
                    assignment.status === "ACTIVE" ? "" : " assignment-closed"
                  }`}
                >
                  <div className="assignment-head">
                    <div>
                      <strong>{assignment.title}</strong>
                      <span className="assignment-meta">
                        {assignment.items.length}{" "}
                        {assignment.items.length === 1
                          ? "objetivo"
                          : "objetivos"}{" "}
                        · {assignment._count.runs}{" "}
                        {assignment._count.runs === 1
                          ? "intento registrado"
                          : "intentos registrados"}{" "}
                        · vence{" "}
                        {new Intl.DateTimeFormat("es-PE", {
                          dateStyle: "medium",
                          timeZone: "America/Lima",
                        }).format(assignment.expiresAt)}
                      </span>
                    </div>
                    <span className="status-pill status-none">
                      {assignmentStatusLabels[assignment.status]}
                    </span>
                  </div>

                  {assignment.items.length > 0 ? (
                    <ul className="completion-list">
                      {assignment.items.map((item) => (
                        <li key={item.id}>
                          <strong>{item.label}</strong>
                          <span>{item.title}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="panel-note panel-note-privacy">
            Los intentos son anónimos: la plataforma no guarda quién resolvió
            cada tarea, solo cuántas veces se trabajó y hasta dónde se llegó.
          </p>
        </section>
      </div>
    </main>
  );
}
