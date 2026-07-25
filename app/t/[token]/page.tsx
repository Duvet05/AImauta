import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { TaskStarter } from "@/components/task-starter";
import { isAssignmentOpen, isWellFormedToken } from "@/lib/assignments";
import { getBook } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";

// Not indexed: a task link is meant for one classroom, not for search results.
export const metadata: Metadata = {
  title: "Tu actividad",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TareaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isWellFormedToken(token)) {
    notFound();
  }

  const assignment = await prisma.assignment.findUnique({
    where: { token },
    include: { course: { include: { grade: { include: { level: true } } } } },
  });

  if (!assignment) {
    notFound();
  }

  const book = getBook(assignment.bookId);
  const open = isAssignmentOpen(assignment);

  return (
    <main id="contenido-principal" className="task-page">
      <nav className="topbar shell task-topbar" aria-label="Navegación principal">
        <Link className="brand" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>
      </nav>

      <div className="task-shell">
        <p className="eyebrow">
          {assignment.course.grade.level.name} ·{" "}
          {assignment.course.grade.name} · {assignment.course.name}
        </p>
        <h1>{assignment.title}</h1>

        {assignment.instructions ? (
          <p className="task-instructions">{assignment.instructions}</p>
        ) : null}

        <dl className="task-facts">
          <div>
            <dt>Cuaderno</dt>
            <dd>{book?.title ?? "Material no disponible"}</dd>
          </div>
          <div>
            <dt>Páginas</dt>
            <dd>
              {assignment.firstPage} a {assignment.lastPage}
            </dd>
          </div>
        </dl>

        {!open ? (
          <div className="task-closed" role="status">
            <strong>Esta actividad ya está cerrada</strong>
            <p>
              Tu profesor cerró la tarea. Si crees que es un error, avísale en
              clase.
            </p>
          </div>
        ) : !book ? (
          <div className="task-closed" role="status">
            <strong>El cuaderno no está disponible</strong>
            <p>
              No pudimos abrir el material de esta actividad. Avisa a tu
              profesor.
            </p>
          </div>
        ) : (
          <TaskStarter
            token={token}
            bookId={assignment.bookId}
            firstPage={assignment.firstPage}
          />
        )}

        <p className="task-privacy">
          Solo pedimos tu nombre o número de lista para que tu profesor
          reconozca tu trabajo. No necesitas crear una cuenta.
        </p>
      </div>
    </main>
  );
}
