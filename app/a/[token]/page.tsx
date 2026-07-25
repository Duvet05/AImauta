import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { BrandMark } from "@/components/brand-mark";
import { ApiError } from "@/lib/http";
import { resolvePublicAssignment } from "@/lib/assignment-service";

import styles from "./assignment-access.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Actividad asignada | AImauta",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

type AssignmentAccessPageProps = {
  params: Promise<{ token: string }>;
};

function expirationLabel(value: string): string {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima"
  }).format(new Date(value));
}

export default async function AssignmentAccessPage({
  params
}: AssignmentAccessPageProps) {
  await connection();
  const { token } = await params;
  let assignment: Awaited<
    ReturnType<typeof resolvePublicAssignment>
  >["public"] | null = null;
  let errorMessage = "";

  try {
    const resolved = await resolvePublicAssignment(token);
    assignment = resolved.public;
  } catch (error) {
    errorMessage =
      error instanceof ApiError
        ? error.message
        : "No pudimos abrir esta actividad.";
  }

  if (!assignment) {
    return (
      <main className={styles.page} id="contenido-principal">
        <div className={styles.shell}>
          <Link className={styles.brand} href="/">
            <BrandMark />
            <span>AImauta</span>
          </Link>
          <section className={styles.card}>
            <p className={styles.eyebrow}>Acceso no disponible</p>
            <h1 className={styles.error}>{errorMessage}</h1>
            <p className={styles.instructions}>
              Pide al docente un código QR vigente para continuar.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} id="contenido-principal">
      <div className={styles.shell}>
        <Link className={styles.brand} href="/">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <section className={styles.card}>
          <p className={styles.eyebrow}>Actividad asignada</p>
          <h1>{assignment.title}</h1>
          {assignment.instructions ? (
            <p className={styles.instructions}>
              {assignment.instructions}
            </p>
          ) : null}
          <ul className={styles.meta}>
            <li>Vence: {expirationLabel(assignment.expiresAt)}</li>
            <li>
              {assignment.completionCriteria.requiredItemCount} de{" "}
              {assignment.completionCriteria.totalItemCount} objetivo(s)
            </li>
            <li>Ayuda máxima: nivel {assignment.maxHintLevel}</li>
          </ul>
          <div className={styles.items}>
            {assignment.items.map((item) => (
              <a
                className={styles.item}
                href={item.launchPath ?? "#"}
                key={item.id}
              >
                <span className={styles.number}>{item.position + 1}</span>
                <span>
                  <strong>{item.label}: {item.title}</strong>
                  <small>
                    {item.bookTitle} · página
                    {item.pages.length === 1 ? "" : "s"}{" "}
                    {item.pages.join(", ")}
                  </small>
                </span>
                <span className={styles.arrow} aria-hidden="true">→</span>
              </a>
            ))}
          </div>
          <p className={styles.privacy}>
            No necesitas instalar una aplicación. Este enlace no contiene
            nombres, notas ni datos personales del estudiante.
          </p>
        </section>
      </div>
    </main>
  );
}
