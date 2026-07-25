"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { BrandMark } from "@/components/brand-mark";
import {
  PdfViewer,
  type ExerciseSelection,
  type ViewerMode,
} from "@/components/pdf-viewer";
import { StageProgress } from "@/components/stage-progress";
import type { VoiceSessionUpdate } from "@/components/voice-tutor";
import type { Book } from "@/lib/catalog";
import type { BookUnit, PageActivity } from "@/lib/curriculum";
import type { PublicExercise } from "@/lib/exercise-manifest";
import type { LearningSessionState } from "@/lib/learning-session";

type Citation =
  | number
  | string
  | {
      sourceId?: string;
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

type SessionResponse = {
  token: string;
  state: LearningSessionState;
  activity: PageActivity;
};

type TutorResponse = {
  message: string;
  citations?: Citation[];
  mode:
    | "gemma"
    | "guided-fallback"
    | "assessment-locked"
    | "exercise-locked"
    | "reviewed-answer";
  sessionToken: string;
  session: LearningSessionState;
  activity: PageActivity;
  policy: {
    hintLevel: 0 | 1 | 2 | 3;
    canRevealSolution: boolean;
  };
};

type PageExercisesResponse = {
  schemaVersion: 1;
  bookId: string;
  page: number;
  exercises: PublicExercise[];
};

type LearningWorkspaceProps = {
  book: Book;
  firstPage: number;
  units: readonly BookUnit[];
  voiceTutorEnabled: boolean;
};

const VoiceTutor = dynamic(
  () =>
    import("@/components/voice-tutor").then((module) => module.VoiceTutor),
  { ssr: false },
);

function welcomeMessage(activity?: PageActivity): ConversationMessage {
  if (activity?.unitNumber) {
    return {
      id: crypto.randomUUID(),
      role: "tutor",
      content: `Estás en la ficha ${activity.unitNumber}: ${activity.unitTitle}. Lee el ejercicio, escribe qué intentaste y pide una pista. La respuesta citará la página usada.`,
    };
  }

  return {
    id: "welcome",
    role: "tutor",
    content:
      "Lee el ejercicio, escribe qué intentaste y pide una pista. La respuesta citará la página usada.",
  };
}

export function LearningWorkspace({
  book,
  firstPage,
  units,
  voiceTutorEnabled,
}: LearningWorkspaceProps) {
  const [page, setPage] = useState(firstPage);
  const [attempt, setAttempt] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([
    welcomeMessage(),
  ]);
  const [sessionToken, setSessionToken] = useState("");
  const [session, setSession] = useState<LearningSessionState | null>(null);
  const [activity, setActivity] = useState<PageActivity | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(true);
  const [isSyncingPage, setIsSyncingPage] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [exercises, setExercises] = useState<PublicExercise[]>([]);
  const [selectedExercise, setSelectedExercise] =
    useState<ExerciseSelection | null>(null);
  const [overlayState, setOverlayState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [viewerMode, setViewerMode] = useState<ViewerMode>("pdfjs");
  const conversationRef = useRef<HTMLDivElement>(null);
  const sessionTokenRef = useRef("");
  const canonicalSessionRef = useRef<LearningSessionState | null>(null);
  const stateRequestEpochRef = useRef(0);
  const pageSyncSequenceRef = useRef(0);
  const pendingNavigationEpochRef = useRef<number | null>(null);
  const tutorRequestSequenceRef = useRef(0);
  const tutorAbortRef = useRef<AbortController | null>(null);
  const attemptDraftsRef = useRef<Record<string, string>>({});
  const previousSelectionRef = useRef<ExerciseSelection | null>(null);

  const currentDraftKey = `${activity?.unitId ?? "orientation"}:${selectedExercise?.exerciseId ?? "none"}:${selectedExercise?.exerciseRevision ?? 0}`;
  const activeExercise =
    exercises.find(
      (exercise) =>
        exercise.id === selectedExercise?.exerciseId &&
        exercise.revision === selectedExercise.exerciseRevision,
    ) ?? null;
  const pageTutorAvailable = activity?.tutorAvailable ?? false;
  const tutorAvailable =
    pageTutorAvailable &&
    activeExercise !== null &&
    overlayState === "ready" &&
    viewerMode === "pdfjs" &&
    !isSyncingPage;
  const isAssessment =
    activity?.stage === "assessment" && activity.unitId !== null;
  const tutorDisabledReason = isAssessment
    ? "La voz se pausa en Evaluamos para que resuelvas por tu cuenta."
    : viewerMode === "native-readonly"
      ? "El visor está en modo lectura; recarga PDF.js para seleccionar un ejercicio."
      : "Selecciona primero un ejercicio marcado en rojo.";

  const applySession = useCallback((result: SessionResponse) => {
    canonicalSessionRef.current = result.state;
    sessionTokenRef.current = result.token;
    setSessionToken(result.token);
    setSession(result.state);
    setActivity(result.activity);
    setPage(result.state.page);
  }, []);

  const requestSession = useCallback(
    async (
      targetPage: number,
      token?: string,
      signal?: AbortSignal,
      selection?: ExerciseSelection | null,
    ): Promise<SessionResponse> => {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          page: targetPage,
          exerciseId: selection?.exerciseId ?? null,
          exerciseRevision: selection?.exerciseRevision ?? null,
          exerciseRegionId: selection?.regionId ?? null,
          ...(token ? { sessionToken: token } : {}),
        }),
        signal,
      });
      const body = (await response.json().catch(() => ({}))) as
        | Partial<SessionResponse> & { error?: string };

      if (!response.ok || !body.token || !body.state || !body.activity) {
        throw new Error(body.error || "No se pudo preparar la sesión.");
      }

      return body as SessionResponse;
    },
    [book.id],
  );

  useEffect(() => {
    const controller = new AbortController();

    void fetch(
      `/api/materials/${encodeURIComponent(book.id)}/exercises?page=${page}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as
          | Partial<PageExercisesResponse>
          | { error?: string };
        if (
          !response.ok ||
          !("exercises" in body) ||
          !Array.isArray(body.exercises)
        ) {
          const message =
            "error" in body && typeof body.error === "string"
              ? body.error
              : "Los ejercicios de esta página aún no están publicados.";
          throw new Error(message);
        }
        return body.exercises;
      })
      .then((pageExercises) => {
        if (controller.signal.aborted) return;
        setExercises(pageExercises);
        setSelectedExercise((current) => {
          if (!current) return null;
          const exercise = pageExercises.find(
            (candidate) =>
              candidate.id === current.exerciseId &&
              candidate.revision === current.exerciseRevision,
          );
          const region = exercise?.regions.find(
            (candidate) => candidate.page === page,
          );
          return exercise && region
            ? {
                exerciseId: exercise.id,
                exerciseRevision: exercise.revision,
                regionId: region.id,
                page,
              }
            : null;
        });
        setOverlayState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setExercises([]);
        setSelectedExercise(null);
        setOverlayState("error");
        setNotice(
          error instanceof Error
            ? error.message
            : "Los ejercicios de esta página aún no están publicados.",
        );
      });

    return () => controller.abort();
  }, [book.id, page]);

  useEffect(() => {
    const controller = new AbortController();
    const requestEpoch = ++stateRequestEpochRef.current;

    void requestSession(firstPage, undefined, controller.signal)
      .then((result) => {
        if (requestEpoch !== stateRequestEpochRef.current) return;
        applySession(result);
        setMessages([welcomeMessage(result.activity)]);
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          requestEpoch !== stateRequestEpochRef.current
        ) {
          return;
        }
        setNotice(
          error instanceof Error
            ? error.message
            : "No se pudo iniciar la sesión de aprendizaje.",
        );
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requestEpoch === stateRequestEpochRef.current
        ) {
          setIsStartingSession(false);
        }
      });

    return () => controller.abort();
  }, [applySession, firstPage, requestSession]);

  useEffect(
    () => () => {
      stateRequestEpochRef.current += 1;
      tutorRequestSequenceRef.current += 1;
      tutorAbortRef.current?.abort();
      tutorAbortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    attemptDraftsRef.current[currentDraftKey] = attempt;
  }, [attempt, currentDraftKey]);

  useEffect(() => {
    if (previousSelectionRef.current && !selectedExercise) {
      setMessages([welcomeMessage(activity ?? undefined)]);
      setQuestion("");
    }
    previousSelectionRef.current = selectedExercise;
  }, [activity, selectedExercise]);

  const scrollConversationToEnd = useCallback(() => {
    window.setTimeout(() => {
      const conversation = conversationRef.current;
      if (conversation) {
        conversation.scrollTo({
          top: conversation.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 50);
  }, []);

  const syncPage = useCallback(
    async (requestedPage: number, source: "page" | "unit" | "citation") => {
      const targetPage = Math.min(Math.max(requestedPage, 1), book.pages);
      if (!sessionTokenRef.current || targetPage === page) return;
      const retainedRegion =
        source !== "unit"
          ? activeExercise?.regions.find(
              (region) => region.page === targetPage,
            )
          : undefined;
      const targetSelection: ExerciseSelection | null =
        retainedRegion && activeExercise
          ? {
              exerciseId: activeExercise.id,
              exerciseRevision: activeExercise.revision,
              regionId: retainedRegion.id,
              page: targetPage,
            }
          : null;
      const targetExerciseId = targetSelection?.exerciseId ?? null;

      attemptDraftsRef.current[currentDraftKey] = attempt;
      const sequence = ++pageSyncSequenceRef.current;
      const requestEpoch = ++stateRequestEpochRef.current;
      pendingNavigationEpochRef.current = requestEpoch;
      tutorRequestSequenceRef.current += 1;
      tutorAbortRef.current?.abort();
      tutorAbortRef.current = null;
      setIsSending(false);
      setIsSyncingPage(true);
      setOverlayState("loading");
      setNotice("");

      try {
        let result: SessionResponse;
        try {
          result = await requestSession(
            targetPage,
            sessionTokenRef.current,
            undefined,
            targetSelection,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (!/sesión|token|firma|expiró/iu.test(message)) {
            throw error;
          }
          result = await requestSession(
            targetPage,
            undefined,
            undefined,
            targetSelection,
          );
        }

        if (
          sequence !== pageSyncSequenceRef.current ||
          requestEpoch !== stateRequestEpochRef.current
        ) {
          return;
        }

        const previousUnitId = activity?.unitId;
        applySession(result);
        setSelectedExercise(targetSelection);
        const nextDraftKey = `${result.activity.unitId ?? "orientation"}:${targetExerciseId ?? "none"}:${targetSelection?.exerciseRevision ?? 0}`;
        setAttempt(attemptDraftsRef.current[nextDraftKey] ?? "");
        setQuestion("");

        if (
          source === "unit" ||
          previousUnitId !== result.activity.unitId ||
          targetSelection === null ||
          !result.activity.tutorAvailable
        ) {
          setMessages([welcomeMessage(result.activity)]);
        }
      } catch (error) {
        if (
          sequence !== pageSyncSequenceRef.current ||
          requestEpoch !== stateRequestEpochRef.current
        ) {
          return;
        }
        setNotice(
          error instanceof Error
            ? error.message
            : "No se pudo cambiar de página. El material continúa en la página anterior.",
        );
      } finally {
        if (
          sequence === pageSyncSequenceRef.current &&
          requestEpoch === stateRequestEpochRef.current
        ) {
          setIsSyncingPage(false);
        }
        if (pendingNavigationEpochRef.current === requestEpoch) {
          pendingNavigationEpochRef.current = null;
        }
      }
    },
    [
      activity,
      activeExercise,
      applySession,
      attempt,
      book.pages,
      currentDraftKey,
      page,
      requestSession,
    ],
  );

  async function selectExercise(selection: ExerciseSelection) {
    if (
      !sessionTokenRef.current ||
      isSyncingPage ||
      overlayState !== "ready" ||
      viewerMode !== "pdfjs"
    ) {
      return;
    }
    const exercise = exercises.find(
      (candidate) =>
        candidate.id === selection.exerciseId &&
        candidate.revision === selection.exerciseRevision &&
        candidate.regions.some(
          (region) =>
            region.id === selection.regionId && region.page === page,
        ),
    );
    if (!exercise) {
      setNotice("Ese ejercicio no está publicado para la página visible.");
      return;
    }
    if (
      selectedExercise?.exerciseId === selection.exerciseId &&
      selectedExercise.exerciseRevision === selection.exerciseRevision &&
      selectedExercise.regionId === selection.regionId
    ) {
      return;
    }

    attemptDraftsRef.current[currentDraftKey] = attempt;
    const requestEpoch = ++stateRequestEpochRef.current;
    tutorRequestSequenceRef.current += 1;
    tutorAbortRef.current?.abort();
    tutorAbortRef.current = null;
    setIsSending(false);
    setIsSyncingPage(true);
    setNotice("");

    try {
      let result: SessionResponse;
      try {
        result = await requestSession(
          page,
          sessionTokenRef.current,
          undefined,
          selection,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/sesión|token|firma|expiró/iu.test(message)) {
          throw error;
        }
        result = await requestSession(
          page,
          undefined,
          undefined,
          selection,
        );
      }
      if (requestEpoch !== stateRequestEpochRef.current) return;

      applySession(result);
      setSelectedExercise(selection);
      const nextDraftKey = `${result.activity.unitId ?? "orientation"}:${exercise.id}:${exercise.revision}`;
      setAttempt(attemptDraftsRef.current[nextDraftKey] ?? "");
      setQuestion("");
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "tutor",
          content: `Seleccionaste ${exercise.label}: ${exercise.title}. Cuéntame qué entendiste o escribe tu primer intento; avanzaré con pistas sobre este ejercicio.`,
        },
      ]);
    } catch (error) {
      if (requestEpoch !== stateRequestEpochRef.current) return;
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo activar ese ejercicio.",
      );
    } finally {
      if (requestEpoch === stateRequestEpochRef.current) {
        setIsSyncingPage(false);
      }
    }
  }

  async function askTutor(message: string) {
    const cleanMessage = message.trim();
    if (
      !cleanMessage ||
      isSending ||
      pendingNavigationEpochRef.current !== null ||
      tutorAbortRef.current !== null ||
      !sessionTokenRef.current ||
      !tutorAvailable
    ) {
      return;
    }

    const studentMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "student",
      content: cleanMessage,
    };

    setMessages((current) => [...current, studentMessage]);
    setQuestion("");
    setNotice("");
    setIsSending(true);
    const requestEpoch = ++stateRequestEpochRef.current;
    const requestSequence = ++tutorRequestSequenceRef.current;
    const controller = new AbortController();
    tutorAbortRef.current = controller;

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken: sessionTokenRef.current,
          message: cleanMessage,
          attempt: attempt.trim(),
        }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as
        | Partial<TutorResponse> & { error?: string };

      if (
        !response.ok ||
        !data.message ||
        !data.sessionToken ||
        !data.session ||
        !data.activity
      ) {
        throw new Error(data.error || "No se pudo contactar al tutor.");
      }

      const result = data as TutorResponse;
      if (
        controller.signal.aborted ||
        requestEpoch !== stateRequestEpochRef.current
      ) {
        return;
      }

      applySession({
        token: result.sessionToken,
        state: result.session,
        activity: result.activity,
      });
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "tutor",
          content: result.message,
          citations: result.citations,
        },
      ]);
      scrollConversationToEnd();
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestEpoch !== stateRequestEpochRef.current
      ) {
        return;
      }
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo conectar con AImauta. Tu intento sigue guardado en esta pantalla.",
      );
    } finally {
      if (tutorRequestSequenceRef.current === requestSequence) {
        tutorAbortRef.current = null;
        setIsSending(false);
      }
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askTutor(question);
  }

  function reviewAttempt() {
    if (!tutorAvailable) return;
    if (!attempt.trim()) {
      setNotice("Escribe primero tu intento para poder revisarlo contigo.");
      return;
    }

    void askTutor(
      "Este es mi intento. Ayúdame a revisarlo con una pregunta o una pista, sin darme la respuesta.",
    );
  }

  function chooseUnit(unitId: string) {
    if (!unitId) {
      void syncPage(1, "unit");
      return;
    }
    const selectedUnit = units.find((unit) => unit.id === unitId);
    if (selectedUnit) {
      void syncPage(selectedUnit.startPage, "unit");
    }
  }

  function applyVoiceSession(update: VoiceSessionUpdate) {
    const currentSession = canonicalSessionRef.current;
    if (
      pendingNavigationEpochRef.current !== null ||
      !currentSession ||
      update.state.bookId !== book.id ||
      update.state.page < 1 ||
      update.state.page > book.pages ||
      update.state.sessionId !== currentSession.sessionId ||
      update.state.createdAt !== currentSession.createdAt ||
      update.state.expiresAt !== currentSession.expiresAt ||
      update.state.page !== currentSession.page ||
      update.state.unitId !== currentSession.unitId ||
      update.state.stage !== currentSession.stage ||
      update.state.exerciseId !== currentSession.exerciseId ||
      update.state.exerciseRevision !== currentSession.exerciseRevision ||
      update.token === sessionTokenRef.current ||
      update.state.revision <= currentSession.revision ||
      update.state.turnCount <= currentSession.turnCount ||
      update.state.attemptCount < currentSession.attemptCount ||
      update.state.hintLevel < currentSession.hintLevel
    ) {
      return;
    }

    stateRequestEpochRef.current += 1;
    tutorRequestSequenceRef.current += 1;
    tutorAbortRef.current?.abort();
    tutorAbortRef.current = null;
    setIsSending(false);
    applySession(update);
    setNotice("");
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
          <span
            className={`status-dot ${isSyncingPage ? "status-dot-busy" : ""}`}
            aria-hidden="true"
          />
          {isSyncingPage ? "Sincronizando…" : activity?.stageLabel ?? "Modo guía"}
        </div>
      </header>

      <div
        className="workspace-grid workspace-grid-session"
        aria-busy={isStartingSession || isSyncingPage}
      >
        <div className="document-stack">
          {sessionToken && session ? (
            <PdfViewer
              book={book}
              page={page}
              onPageChange={(nextPage) => void syncPage(nextPage, "page")}
              exercises={exercises}
              selected={selectedExercise}
              overlayState={overlayState}
              onExerciseSelect={(selection) =>
                void selectExercise(selection)
              }
              onViewerModeChange={setViewerMode}
            />
          ) : (
            <SessionLoading
              bookTitle={book.title}
              error={notice}
              isLoading={isStartingSession}
              onRetry={() => window.location.reload()}
            />
          )}
          {isSyncingPage ? (
            <div className="page-sync-overlay" role="status">
              <span className="sync-spinner" aria-hidden="true" />
              Preparando la página y su contexto…
            </div>
          ) : null}
        </div>

        <aside className="coach-panel coach-panel-session" aria-label="Sesión guiada">
          <section className="session-context-section">
            <div className="rag-quickstart" role="note">
              <span aria-hidden="true">RAG</span>
              <div>
                <strong>Cómo probar las pistas con fuentes</strong>
                <p>
                  Lee el ejercicio de la página, escribe tu intento y pide una
                  pista. Pulsa su cita para abrir la página usada.
                </p>
              </div>
            </div>

            <div
              className={`exercise-focus ${
                activeExercise ? "exercise-focus-active" : ""
              }`}
              role="status"
            >
              <span aria-hidden="true">
                {activeExercise ? "✓" : "▢"}
              </span>
              <div>
                <strong>
                  {activeExercise
                    ? `${activeExercise.label}: ${activeExercise.title}`
                    : overlayState === "loading"
                      ? "Detectando ejercicios publicados…"
                      : overlayState === "error"
                        ? "Ejercicios aún no disponibles"
                        : exercises.length > 0
                          ? "Elige un ejercicio"
                          : "No hay ejercicios publicados en esta página"}
                </strong>
                <p>
                  {activeExercise
                    ? "El RAG y las pistas quedaron vinculados a este recuadro."
                    : viewerMode === "native-readonly"
                      ? "El visor alternativo es sólo de lectura y no permite seleccionar recuadros."
                      : exercises.length > 0
                        ? "Pulsa la etiqueta de un recuadro rojo sobre el PDF para activar el RAG."
                        : "Puedes leer el PDF, pero el tutor permanece cerrado hasta que haya una detección revisada."}
                </p>
              </div>
            </div>

            <div className="unit-selector-row">
              <label htmlFor="learning-unit">Ficha de trabajo</label>
              <select
                id="learning-unit"
                value={activity?.unitId ?? ""}
                onChange={(event) => chooseUnit(event.target.value)}
                disabled={!sessionToken || isSyncingPage}
              >
                <option value="">Orientación del libro</option>
                {units.map((unit: BookUnit) => (
                  <option value={unit.id} key={unit.id}>
                    Ficha {unit.number}: {unit.title}
                  </option>
                ))}
              </select>
            </div>

            {activity && session ? (
              <>
                <div className="unit-summary">
                  <span>
                    {activity.unitNumber
                      ? `Ficha ${activity.unitNumber}`
                      : "Orientación"}
                  </span>
                  <div>
                    <strong>{activity.unitTitle}</strong>
                    {activity.competency ? <p>{activity.competency}</p> : null}
                  </div>
                </div>
                <StageProgress activity={activity} session={session} />
                {voiceTutorEnabled ? (
                  <VoiceTutor
                    sessionId={session.sessionId}
                    sessionToken={sessionToken}
                    disabled={!tutorAvailable}
                    disabledReason={tutorDisabledReason}
                    onSessionUpdate={applyVoiceSession}
                  />
                ) : null}
              </>
            ) : null}
          </section>

          <section className="attempt-section attempt-section-session">
            <div className="panel-heading">
              <span className="panel-step">1</span>
              <div>
                <p>
                  {tutorAvailable
                    ? "Paso 1 · Tu razonamiento"
                    : isAssessment
                      ? "Tu momento de resolver"
                      : "Trabajo individual"}
                </p>
                <h2>Escribe qué intentaste</h2>
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
              maxLength={2_000}
              rows={4}
            />
            <div className="attempt-footer">
              <span>{attempt.length} caracteres</span>
              <button
                className="review-button"
                type="button"
                onClick={reviewAttempt}
                disabled={
                  isSending ||
                  isSyncingPage ||
                  !sessionToken ||
                  !tutorAvailable
                }
              >
                {tutorAvailable
                  ? "Pedir una pista con cita"
                  : isAssessment
                    ? "Evaluación en curso"
                    : "Tutor no disponible"}
                {tutorAvailable ? <SparkIcon /> : <LockButtonIcon />}
              </button>
            </div>
          </section>

          <section className="tutor-section tutor-section-session">
            <div className="panel-heading tutor-heading">
              <span className="panel-step panel-step-tutor">
                <BrandMark />
              </span>
              <div>
                <p>
                  {tutorAvailable
                    ? "Paso 2 · Revisa la fuente"
                    : "Pistas en pausa"}
                </p>
                <h2>Pistas basadas en esta ficha</h2>
              </div>
            </div>

            <div
              className="conversation"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Conversación con AImauta"
              aria-busy={isSending}
              ref={conversationRef}
            >
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onCitationPage={(citationPage) =>
                    void syncPage(citationPage, "citation")
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
                    <span className="sr-only">AImauta está preparando una pregunta</span>
                  </div>
                </div>
              ) : null}
            </div>

            <form className="question-form" onSubmit={submitQuestion}>
              <label className="sr-only" htmlFor="student-question">
                Pregunta o duda para AImauta
              </label>
              <textarea
                id="student-question"
                placeholder={
                  tutorAvailable
                    ? "Escribe tu duda sobre el ejercicio de esta página…"
                    : isAssessment
                      ? "El chat se reanudará después de Evaluamos."
                      : "El chat no está habilitado en esta sección."
                }
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={1_500}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={
                  isSyncingPage ||
                  !sessionToken ||
                  !tutorAvailable
                }
                rows={2}
              />
              <button
                className="send-button"
                type="submit"
                disabled={
                  isSending ||
                  !question.trim() ||
                  isSyncingPage ||
                  !sessionToken ||
                  !tutorAvailable
                }
                aria-label="Enviar mensaje"
              >
                <SendIcon />
              </button>
            </form>
            <p className="tutor-promise">
              <ShieldIcon />
              {tutorAvailable
                ? "La ayuda usa este ejercicio y cita sus páginas. La respuesta revisada aparece sólo después de tres pistas y varios intentos."
                : isAssessment
                  ? "En Evaluamos, AImauta no entrega pistas ni respuestas."
                  : "En esta sección, AImauta no consulta RAG ni entrega ayuda."}
            </p>
            {notice && sessionToken ? (
              <p className="workspace-notice" role="status">
                {notice}
              </p>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function SessionLoading({
  bookTitle,
  error,
  isLoading,
  onRetry,
}: {
  bookTitle: string;
  error: string;
  isLoading: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="session-loading" aria-labelledby="session-loading-title">
      <span className="session-loading-mark" aria-hidden="true">
        <BrandMark />
      </span>
      <h2 id="session-loading-title">
        {isLoading ? "Preparando tu espacio" : "No pudimos abrir el material"}
      </h2>
      <p>
        {isLoading
          ? `Estamos ubicando ${bookTitle} en la primera ficha.`
          : error}
      </p>
      {!isLoading ? (
        <button type="button" onClick={onRetry}>
          Volver a intentar
        </button>
      ) : (
        <span className="sync-spinner" aria-hidden="true" />
      )}
    </section>
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
    return {
      page: citation,
      label: `Fuente: pág. ${citation}`,
      excerpt: undefined,
    };
  }

  if (typeof citation === "string") {
    const pageMatch = citation.match(/\d+/);
    const parsedPage = pageMatch ? Number.parseInt(pageMatch[0], 10) : undefined;
    return {
      page: parsedPage,
      label: parsedPage ? `Fuente: pág. ${parsedPage}` : citation,
      excerpt: undefined,
    };
  }

  return {
    page: citation.page,
    label: citation.page
      ? `Fuente: pág. ${citation.page}`
      : (citation.label ?? "Fuente"),
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

function LockButtonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M6.5 8V6.5a3.5 3.5 0 0 1 7 0V8M5.5 8h9v8h-9V8Z" />
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
