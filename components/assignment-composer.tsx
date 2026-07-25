"use client";

import { useActionState, useState } from "react";

import { createAssignment, type ActionResult } from "@/app/docente/actions";

type AssignmentScope = "PAGE" | "UNIT" | "EXERCISE";

type AssignmentComposerProps = {
  teacherId: string;
  courseId: string;
  books: ReadonlyArray<{
    id: string;
    title: string;
    pages: number;
    units: ReadonlyArray<{
      id: string;
      number: number;
      title: string;
      startPage: number;
      endPage: number;
    }>;
    exercises: ReadonlyArray<{
      id: string;
      label: string;
      title: string;
      pages: readonly number[];
    }>;
  }>;
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
  const [scope, setScope] = useState<AssignmentScope>("PAGE");

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
          onChange={(event) => {
            const nextBookId = event.target.value;
            const nextBook = books.find((book) => book.id === nextBookId);
            setBookId(nextBookId);
            if (
              (scope === "UNIT" && nextBook?.units.length === 0) ||
              (scope === "EXERCISE" && nextBook?.exercises.length === 0)
            ) {
              setScope("PAGE");
            }
          }}
        >
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
      </div>

      <div className="composer-row">
        <label htmlFor="assignment-scope">Qué quieres asignar</label>
        <select
          id="assignment-scope"
          name="scope"
          value={scope}
          onChange={(event) =>
            setScope(event.target.value as AssignmentScope)
          }
        >
          <option value="PAGE">Un rango de páginas</option>
          <option value="UNIT" disabled={!selectedBook?.units.length}>
            Una ficha completa
          </option>
          <option
            value="EXERCISE"
            disabled={!selectedBook?.exercises.length}
          >
            Un ejercicio publicado
          </option>
        </select>
      </div>

      {scope === "PAGE" ? (
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
      ) : null}

      {scope === "UNIT" ? (
        <div className="composer-row">
          <label htmlFor="assignment-unit">Ficha</label>
          <select id="assignment-unit" name="unitId" required>
            {selectedBook?.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                Ficha {unit.number}: {unit.title} · págs. {unit.startPage}–
                {unit.endPage}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {scope === "EXERCISE" ? (
        <div className="composer-row">
          <label htmlFor="assignment-exercise">Ejercicio</label>
          <select id="assignment-exercise" name="exerciseId" required>
            {selectedBook?.exercises.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.label}: {exercise.title} · pág.
                {exercise.pages.length === 1 ? "" : "s."}{" "}
                {exercise.pages.join(", ")}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {selectedBook ? (
        <p className="composer-hint">
          {scope === "PAGE"
            ? `Este cuaderno tiene ${selectedBook.pages} páginas. Puedes incluir hasta 50 páginas.`
            : scope === "UNIT"
              ? "La tarea incluirá todas las páginas de la ficha elegida."
              : "La tarea quedará vinculada a la revisión publicada del ejercicio."}{" "}
          El enlace vencerá en 30 días.
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
