"use client";

import { useActionState, useState } from "react";

import { closeAssignment, type ActionResult } from "@/app/docente/actions";

type Completion = {
  id: string;
  studentAlias: string;
  autonomyLabel: string;
  teacherHint: string;
  shareToken: string;
};

type Assignment = {
  id: string;
  title: string;
  active: boolean;
  firstPage: number;
  lastPage: number;
  url: string;
  qrUrl: string;
  completions: readonly Completion[];
};

type AssignmentListProps = {
  teacherId: string;
  assignments: readonly Assignment[];
};

export function AssignmentList({ teacherId, assignments }: AssignmentListProps) {
  return (
    <ul className="assignment-list">
      {assignments.map((assignment) => (
        <AssignmentRow
          key={assignment.id}
          assignment={assignment}
          teacherId={teacherId}
        />
      ))}
    </ul>
  );
}

function AssignmentRow({
  assignment,
  teacherId,
}: {
  assignment: Assignment;
  teacherId: string;
}) {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [closeState, close, closing] = useActionState<
    ActionResult | null,
    FormData
  >(async (_previous, formData) => closeAssignment(formData), null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(assignment.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  // Prefilled WhatsApp message. wa.me works on phone and desktop alike, which
  // matters because teachers share from whatever is at hand.
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(
    `${assignment.title} — abre la actividad aquí: ${assignment.url}`,
  )}`;

  return (
    <li className={`assignment-row${assignment.active ? "" : " assignment-closed"}`}>
      <div className="assignment-head">
        <div>
          <strong>{assignment.title}</strong>
          <span className="assignment-meta">
            Páginas {assignment.firstPage}–{assignment.lastPage} ·{" "}
            {assignment.completions.length}{" "}
            {assignment.completions.length === 1 ? "entrega" : "entregas"}
            {assignment.active ? "" : " · cerrada"}
          </span>
        </div>

        <div className="assignment-actions">
          <button type="button" onClick={copyLink}>
            {copied ? "Copiado ✓" : "Copiar enlace"}
          </button>
          <a href={whatsappHref} target="_blank" rel="noreferrer noopener">
            WhatsApp
          </a>
          <button type="button" onClick={() => setShowQr((value) => !value)}>
            {showQr ? "Ocultar QR" : "Ver QR"}
          </button>
          {assignment.active && teacherId ? (
            <form action={close}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <input type="hidden" name="teacherId" value={teacherId} />
              <button type="submit" className="assignment-close">
                {closing ? "Cerrando…" : "Cerrar"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {closeState && !closeState.ok ? (
        <p className="note-error" role="alert">
          {closeState.message}
        </p>
      ) : null}

      {showQr ? (
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
            Proyéctalo o imprímelo. El código lleva solo un identificador
            aleatorio: no contiene datos de ningún estudiante.
          </p>
        </div>
      ) : null}

      {assignment.completions.length > 0 ? (
        <ul className="completion-list">
          {assignment.completions.map((completion) => (
            <li key={completion.id}>
              <strong>{completion.studentAlias}</strong>
              <span title={completion.teacherHint}>
                {completion.autonomyLabel}
              </span>
              <a href={`/logro/${completion.shareToken}`}>Ver constancia</a>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
