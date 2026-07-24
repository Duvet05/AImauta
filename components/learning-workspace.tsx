"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { BrandMark } from "@/components/brand-mark";
import { PdfViewer } from "@/components/pdf-viewer";
import type { Book } from "@/lib/catalog";

type Citation =
  | number
  | string
  | {
      page?: number;
      label?: string;
      excerpt?: string;
    };

type ConversationMessage = {
  id: string;
  role: "student" | "tutor";
  content: string;
  citations?: Citation[];
};

type TutorResponse = {
  message: string;
  citations?: Citation[];
  mode?: string;
};

type LearningWorkspaceProps = {
  book: Book;
};

export function LearningWorkspace({ book }: LearningWorkspaceProps) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState("");
  const [question, setQuestion] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      id: "welcome",
      role: "tutor",
      content:
        "Estoy aquí para ayudarte a pensar. Cuéntame qué ejercicio estás resolviendo y cuál sería tu primer paso.",
    },
  ]);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  const apiHistory = useMemo(
    () =>
      messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [messages],
  );

  async function askTutor(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage || isSending) return;

    const studentMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "student",
      content: cleanMessage,
    };

    setMessages((current) => [...current, studentMessage]);
    setQuestion("");
    setIsSending(true);
    setStatusMessage("AImauta está preparando una pregunta para ayudarte.");

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          page,
          message: cleanMessage,
          attempt: attempt.trim(),
          history: apiHistory,
        }),
      });

      if (!response.ok) {
        throw new Error("No se pudo contactar al tutor");
      }

      const data = (await response.json()) as TutorResponse;

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "tutor",
          content:
            data.message ||
            "Revisa los datos del ejercicio. ¿Cuál de ellos se relaciona con lo que quieres encontrar?",
          citations: data.citations,
        },
      ]);
      setStatusMessage(
        data.mode
          ? "Nueva orientación disponible."
          : "AImauta respondió con una nueva pista.",
      );
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "tutor",
          content:
            "No pude conectarme en este momento. Mientras volvemos a intentarlo: ¿qué sabes ya y qué parte exacta te falta descubrir?",
        },
      ]);
      setStatusMessage("No se pudo conectar con el tutor. Puedes volver a intentarlo.");
    } finally {
      setIsSending(false);
      window.setTimeout(() => {
        conversationEndRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 50);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askTutor(question);
  }

  function reviewAttempt() {
    if (!attempt.trim()) {
      setStatusMessage("Escribe primero tu intento para poder revisarlo contigo.");
      return;
    }

    void askTutor(
      "Este es mi intento. Ayúdame a revisarlo con una pregunta o una pista, sin darme la respuesta.",
    );
  }

  return (
    <div className="learning-shell">
      <header className="workspace-header">
        <Link className="brand brand-small" href="/" aria-label="Volver a AImauta">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <div className="workspace-breadcrumb" aria-label="Ubicación actual">
          <span>{book.level}</span>
          <i aria-hidden="true">/</i>
          <strong>{book.subject}</strong>
        </div>
        <div className="guide-badge">
          <span className="status-dot" aria-hidden="true" />
          Modo guía
        </div>
      </header>

      <div className="workspace-grid">
        <PdfViewer book={book} page={page} onPageChange={setPage} />

        <aside className="coach-panel" aria-label="Espacio de aprendizaje guiado">
          <section className="attempt-section">
            <div className="panel-heading">
              <span className="panel-step">1</span>
              <div>
                <p>Primero piensa tú</p>
                <h2>Escribe tu intento</h2>
              </div>
            </div>
            <label className="sr-only" htmlFor="student-attempt">
              Tu intento para resolver el ejercicio
            </label>
            <textarea
              id="student-attempt"
              placeholder="Explica qué entendiste, qué datos usarías o cuál sería tu primer paso…"
              value={attempt}
              onChange={(event) => setAttempt(event.target.value)}
              rows={5}
            />
            <div className="attempt-footer">
              <span>{attempt.length} caracteres</span>
              <button
                className="review-button"
                type="button"
                onClick={reviewAttempt}
                disabled={isSending}
              >
                Revisar mi intento
                <SparkIcon />
              </button>
            </div>
          </section>

          <section className="tutor-section">
            <div className="panel-heading tutor-heading">
              <span className="panel-step panel-step-tutor">
                <BrandMark />
              </span>
              <div>
                <p>Luego avanzamos juntos</p>
                <h2>Conversa con AImauta</h2>
              </div>
            </div>

            <div className="conversation" aria-live="polite" aria-busy={isSending}>
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onCitationPage={(citationPage) =>
                    setPage(Math.min(Math.max(citationPage, 1), book.pages))
                  }
                />
              ))}
              {isSending ? (
                <div className="message-row message-row-tutor">
                  <span className="avatar avatar-tutor">AI</span>
                  <div className="message-bubble tutor-bubble typing-indicator">
                    <span />
                    <span />
                    <span />
                    <span className="sr-only">Pensando</span>
                  </div>
                </div>
              ) : null}
              <div ref={conversationEndRef} />
            </div>

            <form className="question-form" onSubmit={submitQuestion}>
              <label className="sr-only" htmlFor="student-question">
                Pregunta o duda para AImauta
              </label>
              <textarea
                id="student-question"
                placeholder="Cuéntame dónde te quedaste…"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
              />
              <button
                className="send-button"
                type="submit"
                disabled={isSending || !question.trim()}
                aria-label="Enviar mensaje"
              >
                <SendIcon />
              </button>
            </form>
            <p className="tutor-promise">
              <ShieldIcon />
              Te dará pistas y preguntas, no la respuesta final.
            </p>
            <p className="sr-only" role="status">
              {statusMessage}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onCitationPage,
}: {
  message: ConversationMessage;
  onCitationPage: (page: number) => void;
}) {
  const isTutor = message.role === "tutor";

  return (
    <div
      className={`message-row ${isTutor ? "message-row-tutor" : "message-row-student"}`}
    >
      {isTutor ? <span className="avatar avatar-tutor">AI</span> : null}
      <div>
        <div className={`message-bubble ${isTutor ? "tutor-bubble" : "student-bubble"}`}>
          {message.content}
        </div>
        {message.citations?.length ? (
          <div className="citation-list" aria-label="Referencias del material">
            {message.citations.map((citation, index) => {
              const details = citationDetails(citation);
              return details.page ? (
                <button
                  type="button"
                  key={`${details.label}-${index}`}
                  onClick={() => onCitationPage(details.page!)}
                  title={details.excerpt}
                >
                  {details.label}
                </button>
              ) : (
                <span key={`${details.label}-${index}`} title={details.excerpt}>
                  {details.label}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function citationDetails(citation: Citation) {
  if (typeof citation === "number") {
    return { page: citation, label: `Página ${citation}`, excerpt: undefined };
  }

  if (typeof citation === "string") {
    const pageMatch = citation.match(/\d+/);
    const parsedPage = pageMatch ? Number.parseInt(pageMatch[0], 10) : undefined;
    return { page: parsedPage, label: citation, excerpt: undefined };
  }

  return {
    page: citation.page,
    label: citation.label ?? (citation.page ? `Página ${citation.page}` : "Fuente"),
    excerpt: citation.excerpt,
  };
}

function SparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 2.5 11.5 7 16 8.5 11.5 10 10 14.5 8.5 10 4 8.5 8.5 7 10 2.5Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m3 3 14 7-14 7 2-7-2-7Z" />
      <path d="M5 10h8" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 2.5 16 5v4.5c0 3.8-2.3 6.4-6 8-3.7-1.6-6-4.2-6-8V5l6-2.5Z" />
      <path d="m7.5 10 1.6 1.6 3.5-3.5" />
    </svg>
  );
}
