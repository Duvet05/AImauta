"use client";

import { useState, type FormEvent } from "react";

import type { Book } from "@/lib/catalog";

type PdfViewerProps = {
  book: Book;
  page: number;
  onPageChange: (page: number) => void;
};

export function PdfViewer({ book, page, onPageChange }: PdfViewerProps) {
  const [pageInput, setPageInput] = useState<string | null>(null);
  const pdfUrl = `/api/materials/${encodeURIComponent(book.id)}/pdf#page=${page}&view=FitH`;

  function movePage(nextPage: number) {
    setPageInput(null);
    onPageChange(Math.min(Math.max(nextPage, 1), book.pages));
  }

  function submitPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedPage = Number.parseInt(pageInput ?? "", 10);

    if (Number.isFinite(parsedPage)) {
      movePage(parsedPage);
    } else {
      setPageInput(null);
    }
  }

  return (
    <section className="document-panel" aria-label={`Visor de ${book.title}`}>
      <header className="document-toolbar">
        <div className="document-title">
          <span className="document-icon" aria-hidden="true">
            <DocumentIcon />
          </span>
          <div>
            <strong>{book.title}</strong>
            <small>{book.subject}</small>
          </div>
        </div>

        <div className="page-controls" aria-label="Navegación de páginas">
          <button
            type="button"
            className="icon-button"
            onClick={() => movePage(page - 1)}
            disabled={page <= 1}
            aria-label="Página anterior"
          >
            <ChevronIcon direction="left" />
          </button>
          <form onSubmit={submitPage}>
            <label htmlFor="pdf-page">Página</label>
            <input
              id="pdf-page"
              inputMode="numeric"
              min={1}
              max={book.pages}
              onChange={(event) => setPageInput(event.target.value)}
              value={pageInput ?? String(page)}
              aria-describedby="page-total"
            />
            <span id="page-total">de {book.pages}</span>
          </form>
          <button
            type="button"
            className="icon-button"
            onClick={() => movePage(page + 1)}
            disabled={page >= book.pages}
            aria-label="Página siguiente"
          >
            <ChevronIcon direction="right" />
          </button>
        </div>

        <a
          className="source-link"
          href={book.sourcePageUrl}
          target="_blank"
          rel="noreferrer"
        >
          Ver fuente
          <ExternalIcon />
        </a>
      </header>

      <div className="pdf-frame-wrap">
        <iframe
          key={page}
          className="pdf-frame"
          src={pdfUrl}
          title={`${book.title}, página ${page}`}
        />
        <noscript>
          Necesitas activar JavaScript para navegar por las páginas del material.
        </noscript>
      </div>
      <p className="pdf-attribution">
        {book.attribution}. {book.edition}.{" "}
        <a href={book.licenseUrl} target="_blank" rel="noreferrer">
          {book.licenseName}
        </a>
        .
      </p>
    </section>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M7 3.5h7l4 4v13H7v-17Z" />
      <path d="M14 3.5v4h4M10 12h5M10 15.5h5" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg className={direction === "right" ? "flip-x" : undefined} viewBox="0 0 20 20">
      <path d="m12 5-5 5 5 5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M8 5H5v10h10v-3M11 5h4v4M9 11l6-6" />
    </svg>
  );
}
