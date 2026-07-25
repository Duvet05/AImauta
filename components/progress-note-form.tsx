"use client";

import { useActionState } from "react";

import { recordProgressNote, type ActionResult } from "@/app/docente/actions";

type ProgressNoteFormProps = {
  enrollmentId: string;
  teacherId: string;
  studentName: string;
};

const STATUS_OPTIONS = [
  { value: "EXCELLING", label: "Va muy bien" },
  { value: "ON_TRACK", label: "En camino" },
  { value: "NEEDS_SUPPORT", label: "Necesita apoyo" },
  { value: "AT_RISK", label: "Requiere atención" },
] as const;

async function submit(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return recordProgressNote(formData);
}

export function ProgressNoteForm({
  enrollmentId,
  teacherId,
  studentName,
}: ProgressNoteFormProps) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    submit,
    null,
  );

  return (
    <form className="note-form" action={action}>
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="teacherId" value={teacherId} />

      <label className="sr-only" htmlFor={`feedback-${enrollmentId}`}>
        Observación sobre {studentName}
      </label>
      <input
        id={`feedback-${enrollmentId}`}
        name="feedback"
        type="text"
        placeholder="Qué observaste hoy…"
        maxLength={1000}
        required
      />

      <label className="sr-only" htmlFor={`status-${enrollmentId}`}>
        Situación de {studentName}
      </label>
      <select id={`status-${enrollmentId}`} name="status" defaultValue="ON_TRACK">
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </button>

      {state && !state.ok ? (
        <p className="note-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
