import Link from "next/link";

import type { Book } from "@/lib/catalog";

type BookCardProps = {
  book: Book;
  index: number;
};

const subjectSymbols: Record<string, string> = {
  matemática: "∑",
  matemáticas: "∑",
  comunicación: "Aa",
  ciencia: "⌬",
  ciencias: "⌬",
  "ciencia y tecnología": "⌬",
  "personal social": "◎",
  inglés: "Hi",
  historia: "⌛",
};

export function BookCard({ book, index }: BookCardProps) {
  const subjectKey = book.subject.toLocaleLowerCase("es");
  const symbol = subjectSymbols[subjectKey] ?? "✦";
  const colorVariant = (index % 4) + 1;

  return (
    <article className="book-card">
      <Link
        className={`book-cover book-cover-${colorVariant}`}
        href={`/aprender/${encodeURIComponent(book.id)}`}
        aria-label={`Abrir ${book.title}`}
      >
        <span className="book-spine" aria-hidden="true" />
        <div className="book-cover-top">
          <span>{book.level}</span>
          <span>{book.grade}</span>
        </div>
        <strong className="book-symbol" aria-hidden="true">
          {symbol}
        </strong>
        <div className="book-cover-title">
          <small>{book.subject}</small>
          <strong>{book.title}</strong>
        </div>
        <span className="book-pages">{book.pages} págs.</span>
      </Link>

      <div className="book-card-copy">
        <div className="book-tags">
          <span>{book.subject}</span>
          <span>{book.grade}</span>
        </div>
        <h3>
          <Link href={`/aprender/${encodeURIComponent(book.id)}`}>{book.title}</Link>
        </h3>
        <p>{book.description}</p>
        <div className="book-card-footer">
          <span>{book.sourceLabel}</span>
          <Link href={`/aprender/${encodeURIComponent(book.id)}`}>
            Comenzar <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
