import type { Metadata } from "next";
import Link from "next/link";

import { requireTeacherSession } from "@/app/docente/guard";
import { BrandMark } from "@/components/brand-mark";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Panel docente",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DocentePage() {
  await requireTeacherSession();

  const teachers = await prisma.teacher.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      courses: {
        orderBy: { name: "asc" },
        include: {
          grade: { include: { level: true } },
          _count: { select: { enrollments: true, assignments: true } },
        },
      },
    },
  });

  const withCourses = teachers.filter((teacher) => teacher.courses.length > 0);

  return (
    <main id="contenido-principal" className="panel-page">
      <nav className="topbar shell panel-topbar" aria-label="Navegación del panel">
        <Link className="brand" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <span className="panel-badge">Panel docente</span>
      </nav>

      <div className="shell panel-shell">
        <header className="panel-header">
          <p className="eyebrow">Tus clases</p>
          <h1>Elige un curso</h1>
          <p className="panel-lead">
            Dentro de cada curso puedes ver cómo va cada estudiante, registrar
            tus observaciones y asignar tareas con un enlace o código QR.
          </p>
        </header>

        {withCourses.length === 0 ? (
          <div className="panel-empty">
            <h2>Todavía no hay cursos asignados</h2>
            <p>
              Cuando un docente tenga cursos a su cargo, aparecerán aquí junto
              con sus estudiantes.
            </p>
          </div>
        ) : (
          <div className="teacher-blocks">
            {withCourses.map((teacher) => (
              <section key={teacher.id} className="teacher-block">
                <h2>
                  {teacher.firstName} {teacher.lastName}
                </h2>
                <div className="course-grid">
                  {teacher.courses.map((course) => (
                    <Link
                      key={course.id}
                      className="course-card"
                      href={`/docente/${course.id}?docente=${teacher.id}`}
                    >
                      <span className="course-card-level">
                        {course.grade.level.name} · {course.grade.name}
                      </span>
                      <strong>{course.name}</strong>
                      <span className="course-card-meta">
                        {course._count.enrollments}{" "}
                        {course._count.enrollments === 1
                          ? "estudiante"
                          : "estudiantes"}
                        {course._count.assignments > 0
                          ? ` · ${course._count.assignments} ${
                              course._count.assignments === 1
                                ? "tarea"
                                : "tareas"
                            }`
                          : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
