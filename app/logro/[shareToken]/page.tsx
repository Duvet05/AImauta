import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { ShareAchievement } from "@/components/share-achievement";
import { autonomyLabels, isWellFormedToken } from "@/lib/assignments";
import { prisma } from "@/lib/prisma";
import { achievementUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}): Promise<Metadata> {
  const { shareToken } = await params;
  if (!isWellFormedToken(shareToken)) {
    return { title: "Logro", robots: { index: false, follow: false } };
  }

  const completion = await prisma.assignmentCompletion.findUnique({
    where: { shareToken },
    include: { assignment: true },
  });

  if (!completion) {
    return { title: "Logro", robots: { index: false, follow: false } };
  }

  const title = `${completion.studentAlias} terminó ${completion.assignment.title}`;
  const description =
    "Actividad completada con AImauta, el tutor que acompaña sin dar la respuesta.";
  const image = `/api/logro/${encodeURIComponent(shareToken)}/image`;

  return {
    title,
    description,
    // Never indexed: it names a child, even if only by alias.
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      url: achievementUrl(shareToken),
      images: [{ url: image, width: 1080, height: 1080 }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function LogroPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  if (!isWellFormedToken(shareToken)) {
    notFound();
  }

  const completion = await prisma.assignmentCompletion.findUnique({
    where: { shareToken },
    include: { assignment: { include: { course: true } } },
  });

  if (!completion) {
    notFound();
  }

  const autonomy = autonomyLabels[completion.autonomy];

  return (
    <main id="contenido-principal" className="achievement-page">
      <nav className="topbar shell task-topbar" aria-label="Navegación principal">
        <Link className="brand" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>
      </nav>

      <div className="achievement-shell">
        <ShareAchievement
          shareToken={shareToken}
          studentAlias={completion.studentAlias}
          assignmentTitle={completion.assignment.title}
        />

        <div className="achievement-copy">
          <p className="eyebrow">{completion.assignment.course.name}</p>
          <h1>{autonomy.label}</h1>
          <p>
            {completion.studentAlias} completó{" "}
            <strong>{completion.assignment.title}</strong>.
          </p>
          <p className="achievement-note">
            Esta constancia muestra que la actividad se terminó. No incluye
            calificaciones ni comparaciones con otros estudiantes.
          </p>
        </div>
      </div>
    </main>
  );
}
