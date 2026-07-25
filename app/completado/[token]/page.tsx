import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { BrandMark } from "@/components/brand-mark";
import { ShareAchievement } from "@/components/share-achievement";
import { verifyCompletionReceipt } from "@/lib/assignment-service";

import styles from "../../a/[token]/assignment-access.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Comprobante de finalización | AImauta",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

type CompletionPageProps = {
  params: Promise<{ token: string }>;
};

export default async function CompletionPage({
  params
}: CompletionPageProps) {
  await connection();
  const { token } = await params;
  const receipt = await verifyCompletionReceipt(token).catch(() => null);

  return (
    <main className={styles.page} id="contenido-principal">
      <div className={styles.shell}>
        <Link className={styles.brand} href="/">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <section className={styles.card}>
          <p className={styles.eyebrow}>
            {receipt ? "Comprobante verificado" : "Comprobante no encontrado"}
          </p>
          <h1 className={receipt ? undefined : styles.error}>
            {receipt
              ? receipt.assignmentTitle
              : "Este comprobante no es válido."}
          </h1>
          {receipt ? (
            <>
              <p className={styles.instructions}>
                Actividad completada el{" "}
                {new Intl.DateTimeFormat("es-PE", {
                  dateStyle: "long",
                  timeStyle: "short",
                  timeZone: "America/Lima"
                }).format(new Date(receipt.completedAt))}
                .
              </p>
              <ul className={styles.meta}>
                <li>
                  {receipt.completedItemCount} objetivo(s) completado(s)
                </li>
                <li>
                  Criterio: {receipt.requiredItemCount} de{" "}
                  {receipt.totalItemCount}
                </li>
              </ul>
              <ShareAchievement
                token={token}
                assignmentTitle={receipt.assignmentTitle}
              />
            </>
          ) : (
            <p className={styles.instructions}>
              Revisa que el enlace esté completo o solicita uno nuevo.
            </p>
          )}
          <p className={styles.privacy}>
            El comprobante verifica una finalización anónima. No muestra
            nombres, calificaciones ni respuestas del estudiante.
          </p>
        </section>
      </div>
    </main>
  );
}
