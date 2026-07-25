"use client";

import { useActionState, useState } from "react";

import { createAssignment, type ActionResult } from "@/app/docente/actions";

type AssignmentComposerProps = {
  teacherId: string;
  courseId: string;
  books: ReadonlyArray<{ id: string; title: string; pages: number }>;
};

async function submit(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return createAssignment(formData);
}

export function AssignmentComposer({
  teacherId,
  courseId,
  books,
}: AssignmentComposerProps) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    submit,
    null,
  );
  const [bookId, setBookId] = useState(books[0]?.id ?? "");

  const selectedBook = books.find((book) => book.id === bookId);

  if (books.length === 0) {
    return (
      <p className="panel-note">
        No hay cuadernos disponibles para asignar todavía.
      </p>
    );
  }

  return (
    <form className="composer" action={action}>
      <input type="hidden" name="teacherId" value={teacherId} />
      <input type="hidden" name="courseId" value={courseId} />

      <div className="composer-row">
        <label htmlFor="assignment-title">Nombre de la tarea</label>
        <input
          id="assignment-title"
          name="title"
          type="text"
          placeholder="Ej.: Ficha 3 — Fracciones"
          maxLength={120}
          required
        />
      </div>

      <div className="composer-row">
        <label htmlFor="assignment-book">Cuaderno</label>
        <select
          id="assignment-book"
          name="bookId"
          value={bookId}
          onChange={(event) => setBookId(event.target.value)}
        >
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
      </div>

      <div className="composer-pages">
        <div className="composer-row">
          <label htmlFor="assignment-first">Desde la página</label>
          <input
            id="assignment-first"
            name="firstPage"
            type="number"
            min={1}
            max={selectedBook?.pages ?? 9999}
            defaultValue={1}
            required
          />
        </div>
        <div className="composer-row">
          <label htmlFor="assignment-last">Hasta la página</label>
          <input
            id="assignment-last"
            name="lastPage"
            type="number"
            min={1}
            max={selectedBook?.pages ?? 9999}
            defaultValue={1}
            required
          />
        </div>
      </div>

      {selectedBook ? (
        <p className="composer-hint">
          Este cuaderno tiene {selectedBook.pages} páginas. Puedes incluir
          hasta 50 páginas y el enlace vencerá en 30 días.
        </p>
      ) : null}

      <div className="composer-row">
        <label htmlFor="assignment-instructions">
          Indicaciones para el estudiante <span>(opcional)</span>
        </label>
        <textarea
          id="assignment-instructions"
          name="instructions"
          rows={3}
          maxLength={600}
          placeholder="Ej.: Resuelve los ejercicios 1 al 4. Escribe tu procedimiento."
        />
      </div>

      <div className="composer-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Crear tarea y generar QR"}
        </button>
        {state && !state.ok ? (
          <p className="note-error" role="alert">
            {state.message}
          </p>
        ) : null}
        {state?.ok ? (
          <p className="note-success" role="status">
            Tarea creada. Aparece arriba con su enlace y código QR.
          </p>
        ) : null}
      </div>
    </form>
  );
}
