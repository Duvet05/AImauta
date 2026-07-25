"use client";

import { useActionState, useState } from "react";

import { closeAssignment, type ActionResult } from "@/app/docente/actions";

type Assignment = {
  id: string;
  title: string;
  status: "ACTIVE" | "REVOKED" | "ARCHIVED";
  expiresAt: string;
  pages: readonly number[];
  runCount: number;
  url: string | null;
  qrUrl: string | null;
  manageTeacherId: string | null;
  items: readonly {
    id: string;
    label: string;
    title: string;
  }[];
};

type AssignmentListProps = {
  assignments: readonly Assignment[];
};

export function AssignmentList({ assignments }: AssignmentListProps) {
  return (
    <ul className="assignment-list">
      {assignments.map((assignment) => (
        <AssignmentRow key={assignment.id} assignment={assignment} />
      ))}
    </ul>
  );
}

function AssignmentRow({
  assignment,
}: {
  assignment: Assignment;
}) {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [closeState, close, closing] = useActionState<
    ActionResult | null,
    FormData
  >(async (_previous, formData) => closeAssignment(formData), null);

  async function copyLink() {
    if (!assignment.url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(assignment.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const active = assignment.status === "ACTIVE";
  const whatsappHref = assignment.url
    ? `https://wa.me/?text=${encodeURIComponent(
        `${assignment.title} — abre la actividad aquí: ${assignment.url}`,
      )}`
    : null;
  const pageLabel =
    assignment.pages.length === 0
      ? "Sin páginas"
      : assignment.pages.length === 1
        ? `Página ${assignment.pages[0]}`
        : `Páginas ${assignment.pages[0]}–${
            assignment.pages[assignment.pages.length - 1]
          }`;
  const statusLabel =
    assignment.status === "ACTIVE"
      ? "activa"
      : assignment.status === "REVOKED"
        ? "cerrada"
        : "archivada";

  return (
    <li className={`assignment-row${active ? "" : " assignment-closed"}`}>
      <div className="assignment-head">
        <div>
          <strong>{assignment.title}</strong>
          <span className="assignment-meta">
            {pageLabel} · {assignment.runCount}{" "}
            {assignment.runCount === 1
              ? "sesión anónima"
              : "sesiones anónimas"}{" "}
            · {statusLabel} · vence{" "}
            {new Intl.DateTimeFormat("es-PE", {
              dateStyle: "medium",
              timeZone: "America/Lima",
            }).format(new Date(assignment.expiresAt))}
          </span>
        </div>

        <div className="assignment-actions">
          {assignment.url ? (
            <button type="button" onClick={copyLink}>
              {copied ? "Copiado ✓" : "Copiar enlace"}
            </button>
          ) : null}
          {whatsappHref ? (
            <a href={whatsappHref} target="_blank" rel="noreferrer noopener">
              WhatsApp
            </a>
          ) : null}
          {assignment.qrUrl ? (
            <button type="button" onClick={() => setShowQr((value) => !value)}>
              {showQr ? "Ocultar QR" : "Ver QR"}
            </button>
          ) : null}
          {active && assignment.manageTeacherId ? (
            <form action={close}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <input
                type="hidden"
                name="teacherId"
                value={assignment.manageTeacherId}
              />
              <button type="submit" className="assignment-close">
                {closing ? "Cerrando…" : "Cerrar"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {assignment.manageTeacherId && !assignment.url ? (
        <p className="note-error" role="alert">
          El enlace protegido no está disponible. Revisa los secretos de
          tareas antes de compartir esta actividad.
        </p>
      ) : null}

      {closeState && !closeState.ok ? (
        <p className="note-error" role="alert">
          {closeState.message}
        </p>
      ) : null}

      {showQr && assignment.qrUrl ? (
        <div className="assignment-qr">
          {/* Server-rendered PNG: no QR library ships to the browser. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assignment.qrUrl}
            alt={`Código QR de la tarea ${assignment.title}`}
            width={220}
            height={220}
          />
          <p>
            Proyéctalo o imprímelo. El código contiene un token opaco y no
            incluye nombres, notas ni respuestas.
          </p>
        </div>
      ) : null}

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
  );
}
