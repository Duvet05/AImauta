"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAX_STUDENT_ALIAS } from "@/lib/assignments";

type TaskStarterProps = {
  token: string;
  bookId: string;
  firstPage: number;
};

const ALIAS_STORAGE_KEY = "aimauta.alias";

/**
 * Entry point a student reaches after scanning the QR. Asks for the least it
 * can — an alias the teacher already uses in class — and hands off to the
 * reader. No account, no email, no verification.
 */
export function TaskStarter({ token, bookId, firstPage }: TaskStarterProps) {
  const router = useRouter();
  const [alias, setAlias] = useState("");
  const [error, setError] = useState("");

  function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = alias.trim();
    if (!trimmed) {
      setError("Escribe tu nombre o número de lista para continuar.");
      return;
    }

    // Kept locally so returning to the task does not ask twice. It never
    // leaves the device except when the completion is recorded.
    try {
      window.localStorage.setItem(ALIAS_STORAGE_KEY, trimmed);
    } catch {
      // Private browsing or disabled storage: continuing is more important
      // than remembering the alias.
    }

    const query = new URLSearchParams({
      page: String(firstPage),
      tarea: token,
    });
    router.push(
      `/aprender/${encodeURIComponent(bookId)}?${query.toString()}` as Route,
    );
  }

  return (
    <form className="task-starter" onSubmit={start}>
      <label htmlFor="alias">¿Cómo te reconoce tu profesor?</label>
      <input
        id="alias"
        name="alias"
        type="text"
        value={alias}
        onChange={(event) => {
          setAlias(event.target.value);
          setError("");
        }}
        maxLength={MAX_STUDENT_ALIAS}
        placeholder="Tu nombre o número de lista"
        autoComplete="off"
        required
      />
      {error ? (
        <p className="note-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit">Empezar la actividad</button>
    </form>
  );
}
