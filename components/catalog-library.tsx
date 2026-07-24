"use client";

import { useId, useMemo, useState } from "react";

import { BookCard } from "@/components/book-card";
import type { Book } from "@/lib/catalog";

import styles from "./catalog-library.module.css";

type CatalogLibraryProps = {
  books: readonly Book[];
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "es-PE", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-PE");
}

function resultLabel(count: number): string {
  return `${count} ${count === 1 ? "material encontrado" : "materiales encontrados"}`;
}

export function CatalogLibrary({ books }: CatalogLibraryProps) {
  const idPrefix = useId();
  const [level, setLevel] = useState("");
  const [grade, setGrade] = useState("");
  const [course, setCourse] = useState("");
  const [query, setQuery] = useState("");

  const levels = useMemo(
    () => uniqueSorted(books.map((book) => book.level)),
    [books],
  );
  const grades = useMemo(
    () =>
      level
        ? uniqueSorted(
            books
              .filter((book) => book.level === level)
              .map((book) => book.grade),
          )
        : [],
    [books, level],
  );
  const courses = useMemo(
    () =>
      level && grade
        ? uniqueSorted(
            books
              .filter(
                (book) => book.level === level && book.grade === grade,
              )
              .map((book) => book.subject),
          )
        : [],
    [books, grade, level],
  );

  const normalizedQuery = normalize(query.trim());
  const filteredBooks = useMemo(
    () =>
      books.filter((book) => {
        if (level && book.level !== level) return false;
        if (grade && book.grade !== grade) return false;
        if (course && book.subject !== course) return false;
        if (!normalizedQuery) return true;

        return normalize(
          [
            book.title,
            book.subject,
            book.grade,
            book.level,
            book.description,
            book.sourceLabel,
          ].join(" "),
        ).includes(normalizedQuery);
      }),
    [books, course, grade, level, normalizedQuery],
  );

  const hasActiveFilters = Boolean(level || grade || course || query.trim());

  function resetFilters() {
    setLevel("");
    setGrade("");
    setCourse("");
    setQuery("");
  }

  if (books.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptySymbol} aria-hidden="true">
          ⌁
        </span>
        <h3>La biblioteca se está preparando</h3>
        <p>Vuelve pronto para comenzar con el primer material.</p>
      </div>
    );
  }

  return (
    <div className={styles.library}>
      <form
        className={styles.filters}
        role="search"
        aria-label="Filtrar materiales de la biblioteca"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className={styles.filterHeading}>
          <div>
            <p className={styles.filterEyebrow}>Encuentra tu material</p>
            <h3>Elige tu ruta de aprendizaje</h3>
          </div>
          {hasActiveFilters ? (
            <button
              className={styles.clearButton}
              type="button"
              onClick={resetFilters}
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>

        <div
          className={styles.filterGrid}
          aria-describedby={`${idPrefix}-filter-help`}
        >
          <label className={styles.field} htmlFor={`${idPrefix}-level`}>
            <span>
              <b aria-hidden="true">1</b>
              Nivel
            </span>
            <select
              id={`${idPrefix}-level`}
              value={level}
              onChange={(event) => {
                setLevel(event.target.value);
                setGrade("");
                setCourse("");
              }}
            >
              <option value="">Todos los niveles</option>
              {levels.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <span className={styles.connector} aria-hidden="true">
            →
          </span>

          <label className={styles.field} htmlFor={`${idPrefix}-grade`}>
            <span>
              <b aria-hidden="true">2</b>
              Grado
            </span>
            <select
              id={`${idPrefix}-grade`}
              value={grade}
              disabled={!level}
              onChange={(event) => {
                setGrade(event.target.value);
                setCourse("");
              }}
            >
              <option value="">
                {level ? "Todos los grados" : "Elige primero el nivel"}
              </option>
              {grades.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <span className={styles.connector} aria-hidden="true">
            →
          </span>

          <label className={styles.field} htmlFor={`${idPrefix}-course`}>
            <span>
              <b aria-hidden="true">3</b>
              Curso
            </span>
            <select
              id={`${idPrefix}-course`}
              value={course}
              disabled={!grade}
              onChange={(event) => setCourse(event.target.value)}
            >
              <option value="">
                {grade ? "Todos los cursos" : "Elige primero el grado"}
              </option>
              {courses.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label
            className={`${styles.field} ${styles.searchField}`}
            htmlFor={`${idPrefix}-search`}
          >
            <span>Buscar por nombre o tema</span>
            <span className={styles.searchControl}>
              <SearchIcon />
              <input
                id={`${idPrefix}-search`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ej.: Matemática"
                autoComplete="off"
              />
            </span>
          </label>
        </div>

        <p className={styles.filterHelp} id={`${idPrefix}-filter-help`}>
          Los grados y cursos se habilitan según tu selección anterior.
        </p>
      </form>

      <div className={styles.resultsHeading}>
        <p role="status" aria-live="polite" aria-atomic="true">
          {resultLabel(filteredBooks.length)}
        </p>
        {level ? (
          <p className={styles.selectionSummary}>
            {level}
            {grade ? ` · ${grade}` : ""}
            {course ? ` · ${course}` : ""}
          </p>
        ) : null}
      </div>

      {filteredBooks.length > 0 ? (
        <div className={styles.bookGrid}>
          {filteredBooks.map((book, index) => (
            <BookCard book={book} index={index} key={book.id} />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <span className={styles.emptySymbol} aria-hidden="true">
            ◌
          </span>
          <h3>No encontramos materiales con esos filtros</h3>
          <p>Prueba otra combinación o limpia los filtros para ver la biblioteca.</p>
          <button
            className={styles.resetButton}
            type="button"
            onClick={resetFilters}
          >
            Ver todos los materiales
          </button>
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m13 13 4 4" />
    </svg>
  );
}
