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
          <p className="eyebrow">Cursos de la institución</p>
          <h1>Elige un curso</h1>
          <p className="panel-lead">
            Dentro de cada curso puedes ver cómo va cada estudiante y registrar
            tus observaciones, además de crear y revisar tareas compartidas por
            enlace o código QR.
          </p>
        </header>

        <div className="panel-roadmap-grid">
          <aside
            className="material-coming-soon"
            aria-label="Próximamente: agrega tu material"
          >
            <span className="material-coming-soon-icon" aria-hidden="true">
              +
            </span>
            <div>
              <span className="material-coming-soon-eyebrow">Próximamente</span>
              <h2>¡Agrega tu material!</h2>
              <p>
                Muy pronto podrás incorporar tus propias fichas y recursos a
                AImauta.
              </p>
            </div>
            <span className="material-coming-soon-badge">
              Disponible pronto
            </span>
          </aside>

          <section
            className="teacher-live-preview"
            aria-labelledby="teacher-live-preview-title"
          >
            <div className="teacher-live-preview-heading">
              <span className="teacher-live-preview-icon" aria-hidden="true">
                <LiveTeacherIcon />
              </span>
              <div>
                <span>Próximamente · Atención en vivo</span>
                <h2 id="teacher-live-preview-title">Consultas en tiempo real</h2>
              </div>
              <span className="teacher-live-preview-badge">Mockup</span>
            </div>
            <p>
              Recibe una solicitud cuando un estudiante necesite conversar con
              un profesor real.
            </p>
            <div className="teacher-live-request">
              <span className="teacher-live-request-status" aria-hidden="true" />
              <div>
                <small>Solicitud de ejemplo</small>
                <strong>Un estudiante necesita apoyo</strong>
                <span>Matemática · Ficha 1</span>
              </div>
              <button type="button" disabled>
                Atender llamada
              </button>
            </div>
          </section>
        </div>

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

function LiveTeacherIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M8 11a4 4 0 1 1 8 0v2a4 4 0 0 1-8 0v-2ZM5 12v1a7 7 0 0 0 14 0v-1M12 20v2M9 22h6" />
    </svg>
  );
}
