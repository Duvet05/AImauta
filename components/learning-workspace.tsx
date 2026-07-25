"use client";

import dynamic from "next/dynamic";
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
import {
  parsePageExercisesResponse,
  type PageExercisesResponse,
} from "@/lib/page-exercises-response";

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

type AssignmentLaunch = {
  publicToken: string;
  itemId: string;
  landingPath: string;
  assignmentTitle: string;
};

type TutorResponse = {
  message: string;
  citations?: Citation[];
  mode:
    | "openai"
    | "xai"
    | "gemini"
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

type LearningWorkspaceProps = {
  assignmentLaunch?: AssignmentLaunch;
  avatarPreviewEnabled: boolean;
  book: Book;
  firstPage: number;
  units: readonly BookUnit[];
  voiceTutorEnabled: boolean;
};

const AvatarPreview = dynamic(
  () =>
    import("@/components/avatar-preview").then(
      (module) => module.AvatarPreview,
    ),
  { ssr: false },
);

const VoiceTutor = dynamic(
  () =>
    import("@/components/voice-tutor").then((module) => module.VoiceTutor),
  { ssr: false },
);

type ExerciseAvailability =
  | "loading"
  | "available"
  | "empty"
  | "not-published"
  | "failed";

type ExerciseModeCopy = {
  quickstartTitle: string;
  quickstartBody: string;
  focusTitle: string;
  focusBody: string;
  focusTone: "active" | "selectable" | "neutral" | "warning";
  focusIcon: string;
  attemptEyebrow: string;
  attemptTitle: string;
  attemptPlaceholder: string;
  reviewButtonLabel: string;
  chatPlaceholder: string;
  tutorPromise: string;
  tutorDisabledReason: string;
  banner:
    | {
        title: string;
        body: string;
        tone: "neutral" | "warning";
        loading?: boolean;
        retryLabel?: string;
      }
    | null;
};

function exerciseModeCopy({
  availability,
  isAssessment,
  viewerMode,
  hasActiveExercise,
}: {
  availability: ExerciseAvailability;
  isAssessment: boolean;
  viewerMode: ViewerMode;
  hasActiveExercise: boolean;
}): ExerciseModeCopy {
  if (isAssessment) {
    return {
      quickstartTitle: "Evaluación: ayuda en pausa",
      quickstartBody:
        "Resuelve por tu cuenta. En esta etapa no mostramos recuadros, pistas ni respuestas.",
      focusTitle: "Evaluación: ayuda en pausa",
      focusBody:
        "El PDF y tu espacio de respuesta siguen disponibles mientras resuelves.",
      focusTone: "neutral",
      focusIcon: "i",
      attemptEyebrow: "Tu momento de resolver",
      attemptTitle: "Desarrolla tu respuesta",
      attemptPlaceholder:
        "Escribe tu procedimiento y tu respuesta con tus propias palabras…",
      reviewButtonLabel: "Evaluación en curso",
      chatPlaceholder: "El chat se reanudará después de Evaluamos.",
      tutorPromise:
        "En Evaluamos, AImauta no entrega recuadros, pistas ni respuestas.",
      tutorDisabledReason:
        "La ayuda se pausa en Evaluamos para que resuelvas por tu cuenta.",
      banner: {
        title: "Evaluación: ayuda en pausa",
        body:
          "Puedes leer y navegar por el cuaderno; los ejercicios y las pistas están desactivados.",
        tone: "neutral",
      },
    };
  }

  if (viewerMode === "native-readonly") {
    return {
      quickstartTitle: "Visor en modo lectura",
      quickstartBody:
        "Puedes leer el cuaderno, pero en esta vista no se pueden seleccionar ejercicios.",
      focusTitle: "Visor en modo lectura",
      focusBody:
        "Vuelve al visor interactivo para recuperar los ejercicios marcados.",
      focusTone: "neutral",
      focusIcon: "i",
      attemptEyebrow: "Notas de lectura",
      attemptTitle: "Anota lo que observas",
      attemptPlaceholder:
        "Escribe una idea, un dato importante o el procedimiento que intentarías…",
      reviewButtonLabel: "Tutor no disponible",
      chatPlaceholder:
        "Para conversar necesitas el visor interactivo y un ejercicio seleccionado.",
      tutorPromise:
        "En modo lectura, AImauta no consulta el cuaderno ni da pistas.",
      tutorDisabledReason:
        "El visor está en modo lectura; recárgalo para seleccionar un ejercicio.",
      banner: {
        title: "Visor en modo lectura",
        body:
          "El cuaderno sigue disponible, pero aquí no se pueden seleccionar ejercicios.",
        tone: "neutral",
      },
    };
  }

  if (availability === "loading") {
    return {
      quickstartTitle: "Preparando el modo interactivo",
      quickstartBody:
        "El cuaderno ya está disponible; estamos comprobando si esta página tiene ejercicios.",
      focusTitle: "Buscando ejercicios…",
      focusBody: "Puedes empezar a leer mientras termina la comprobación.",
      focusTone: "neutral",
      focusIcon: "…",
      attemptEyebrow: "Notas de lectura",
      attemptTitle: "Anota lo que observas",
      attemptPlaceholder:
        "Escribe una idea, un dato importante o el procedimiento que intentarías…",
      reviewButtonLabel: "Comprobando ejercicios",
      chatPlaceholder: "Podrás conversar si esta página tiene un ejercicio.",
      tutorPromise:
        "AImauta dará pistas cuando encuentre un ejercicio revisado en esta página.",
      tutorDisabledReason:
        "Estamos comprobando los ejercicios de esta página.",
      banner: {
        title: "Preparando los ejercicios",
        body: "El cuaderno ya está disponible; puedes empezar a leer.",
        tone: "neutral",
        loading: true,
      },
    };
  }

  if (availability === "not-published") {
    return {
      quickstartTitle: "Modo lectura seguro",
      quickstartBody:
        "Este cuaderno todavía no tiene ejercicios preparados. Puedes seguir leyéndolo.",
      focusTitle: "Ejercicios en preparación",
      focusBody:
        "No marcamos ejercicios aproximados: aparecerán cuando una persona los haya revisado.",
      focusTone: "neutral",
      focusIcon: "i",
      attemptEyebrow: "Notas de lectura",
      attemptTitle: "Anota lo que observas",
      attemptPlaceholder:
        "Escribe una idea, un dato importante o el procedimiento que intentarías…",
      reviewButtonLabel: "Pistas no disponibles",
      chatPlaceholder:
        "Podrás conversar cuando este cuaderno tenga ejercicios preparados.",
      tutorPromise:
        "Sin ejercicios revisados, AImauta no consulta el cuaderno ni da pistas.",
      tutorDisabledReason:
        "Este cuaderno todavía no tiene ejercicios preparados.",
      banner: {
        title: "Ejercicios en preparación",
        body:
          "Puedes leer y navegar por el cuaderno; los ejercicios y las pistas siguen cerrados.",
        tone: "neutral",
        retryLabel: "Comprobar de nuevo",
      },
    };
  }

  if (availability === "failed") {
    return {
      quickstartTitle: "Modo lectura temporal",
      quickstartBody:
        "No pudimos comprobar los ejercicios. El cuaderno sigue disponible.",
      focusTitle: "No pudimos cargar los ejercicios",
      focusBody:
        "No marcaremos ejercicios ni daremos pistas hasta recuperar una versión válida.",
      focusTone: "warning",
      focusIcon: "!",
      attemptEyebrow: "Notas de lectura",
      attemptTitle: "Anota lo que observas",
      attemptPlaceholder:
        "Escribe una idea, un dato importante o el procedimiento que intentarías…",
      reviewButtonLabel: "Pistas no disponibles",
      chatPlaceholder:
        "La conversación seguirá cerrada hasta recuperar los ejercicios.",
      tutorPromise:
        "Ante un error, AImauta prefiere callar antes que usar material incompleto.",
      tutorDisabledReason:
        "No pudimos cargar una versión válida de los ejercicios.",
      banner: {
        title: "Modo lectura temporal",
        body:
          "No pudimos cargar los ejercicios. El cuaderno sigue disponible.",
        tone: "warning",
        retryLabel: "Reintentar ejercicios",
      },
    };
  }

  if (availability === "empty") {
    return {
      quickstartTitle: "Modo lectura",
      quickstartBody:
        "Esta página todavía no tiene ejercicios. Puedes seguir navegando por el cuaderno.",
      focusTitle: "Sin ejercicios en esta página",
      focusBody:
        "Las pistas seguirán desactivadas; cambia de página para buscar un ejercicio.",
      focusTone: "neutral",
      focusIcon: "i",
      attemptEyebrow: "Notas de lectura",
      attemptTitle: "Anota lo que observas",
      attemptPlaceholder:
        "Escribe una idea, un dato importante o el procedimiento que intentarías…",
      reviewButtonLabel: "Pistas no disponibles",
      chatPlaceholder:
        "Ve a una página con un ejercicio marcado para conversar.",
      tutorPromise:
        "En esta página, AImauta no consulta el cuaderno ni da pistas.",
      tutorDisabledReason:
        "Esta página no tiene ejercicios preparados.",
      banner: {
        title: "Modo lectura",
        body:
          "Esta página no tiene ejercicios; puedes seguir leyendo y navegando el cuaderno.",
        tone: "neutral",
      },
    };
  }

  if (hasActiveExercise) {
    return {
      quickstartTitle: "Listo para pedir una pista",
      quickstartBody:
        "Escribe tu intento y pide una pista. Pulsa su fuente para abrir la página que la respalda.",
      focusTitle: "Ejercicio activo",
      focusBody:
        "Las pistas quedaron vinculadas únicamente a este ejercicio.",
      focusTone: "active",
      focusIcon: "✓",
      attemptEyebrow: "Paso 1 · Tu razonamiento",
      attemptTitle: "Escribe qué intentaste",
      attemptPlaceholder:
        "Explica qué entendiste, qué datos usarías o cuál sería tu primer paso…",
      reviewButtonLabel: "Pedir una pista con fuente",
      chatPlaceholder: "Escribe tu duda sobre el ejercicio de esta página…",
      tutorPromise:
        "Cada pista sale de este ejercicio y muestra su página. La respuesta completa aparece sólo después de tres pistas y varios intentos.",
      tutorDisabledReason: "",
      banner: null,
    };
  }

  return {
    quickstartTitle: "Elige un ejercicio para empezar",
    quickstartBody:
      "Pulsa la etiqueta de un ejercicio marcado en rojo. Luego escribe tu intento y pide una pista.",
    focusTitle: "Elige un ejercicio",
    focusBody:
      "Pulsa la etiqueta de un ejercicio marcado en rojo sobre el cuaderno.",
    focusTone: "selectable",
    focusIcon: "▢",
    attemptEyebrow: "Trabajo individual",
    attemptTitle: "Escribe qué intentaste",
    attemptPlaceholder:
      "Explica qué entendiste, qué datos usarías o cuál sería tu primer paso…",
    reviewButtonLabel: "Selecciona un ejercicio",
    chatPlaceholder:
      "Selecciona primero un ejercicio marcado en rojo.",
    tutorPromise:
      "AImauta consulta el cuaderno sólo después de que elijas un ejercicio.",
    tutorDisabledReason:
      "Selecciona primero un ejercicio marcado en rojo.",
    banner: null,
  };
}

function welcomeMessage(activity?: PageActivity): ConversationMessage {
  if (activity?.stage === "assessment") {
    return {
      id: crypto.randomUUID(),
      role: "tutor",
      content:
        "Estás en Evaluamos. Lee el material y desarrolla tu respuesta por tu cuenta; aquí las pistas y respuestas permanecen cerradas.",
    };
  }

  if (activity?.unitNumber) {
    return {
      id: crypto.randomUUID(),
      role: "tutor",
      content: `Estás en la ficha ${activity.unitNumber}: ${activity.unitTitle}. Lee el material y escribe tu primer intento. Si la página tiene un ejercicio marcado, podrás seleccionarlo para pedir una pista.`,
    };
  }

  return {
    id: "welcome",
    role: "tutor",
    content:
      "Lee el material y escribe tu primer intento. Las pistas se habilitan cuando seleccionas un ejercicio marcado.",
  };
}

export function LearningWorkspace({
  assignmentLaunch,
  avatarPreviewEnabled,
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
  const [sessionError, setSessionError] = useState("");
  const [exercises, setExercises] = useState<PublicExercise[]>([]);
  const [selectedExercise, setSelectedExercise] =
    useState<ExerciseSelection | null>(null);
  const [exerciseAvailability, setExerciseAvailability] =
    useState<ExerciseAvailability>("loading");
  const [exerciseRequestRevision, setExerciseRequestRevision] = useState(0);
  const [viewerMode, setViewerMode] = useState<ViewerMode>("pdfjs");
  const [isCompletingAssignment, setIsCompletingAssignment] = useState(false);
  const [assignmentItemCompleted, setAssignmentItemCompleted] = useState(false);
  const [completionReceiptUrl, setCompletionReceiptUrl] = useState("");
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
  const assignmentResumeTokenRef = useRef("");
  const exercisesRef = useRef<PublicExercise[]>([]);

  const currentDraftKey = `${activity?.unitId ?? "orientation"}:${selectedExercise?.exerciseId ?? "none"}:${selectedExercise?.exerciseRevision ?? 0}`;
  const activeExercise =
    exercises.find(
      (exercise) =>
        exercise.id === selectedExercise?.exerciseId &&
        exercise.revision === selectedExercise.exerciseRevision,
    ) ?? null;
  const pageTutorAvailable = activity?.tutorAvailable ?? false;
  const overlayState =
    exerciseAvailability === "loading"
      ? "loading"
      : exerciseAvailability === "available" ||
          exerciseAvailability === "empty"
        ? "ready"
        : "error";
  const tutorAvailable =
    pageTutorAvailable &&
    activeExercise !== null &&
    exerciseAvailability === "available" &&
    viewerMode === "pdfjs" &&
    !isSyncingPage &&
    !assignmentItemCompleted;
  const isAssessment =
    activity?.stage === "assessment" && activity.unitId !== null;
  const modeCopy = exerciseModeCopy({
    availability: exerciseAvailability,
    isAssessment,
    viewerMode,
    hasActiveExercise: activeExercise !== null,
  });
  const interactiveSupportAvailable =
    pageTutorAvailable &&
    exerciseAvailability === "available" &&
    viewerMode === "pdfjs";

  const applySession = useCallback((result: SessionResponse) => {
    canonicalSessionRef.current = result.state;
    sessionTokenRef.current = result.token;
    setSessionToken(result.token);
    setSession(result.state);
    setActivity(result.activity);
    setPage(result.state.page);
    if (result.state.exerciseId && result.state.exerciseRevision) {
      const exercise = exercisesRef.current.find(
        (candidate) =>
          candidate.id === result.state.exerciseId &&
          candidate.revision === result.state.exerciseRevision,
      );
      const region = exercise?.regions.find(
        (candidate) => candidate.page === result.state.page,
      );
      if (exercise && region) {
        setSelectedExercise({
          exerciseId: exercise.id,
          exerciseRevision: exercise.revision,
          regionId: region.id,
          page: result.state.page,
        });
      }
    }
  }, []);

  const requestSession = useCallback(
    async (
      targetPage: number,
      token?: string,
      signal?: AbortSignal,
      selection?: ExerciseSelection | null,
    ): Promise<SessionResponse> => {
      const requestStandardSession = async (
        currentToken?: string,
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
            ...(currentToken ? { sessionToken: currentToken } : {}),
          }),
          signal,
        });
        const body = (await response.json().catch(() => ({}))) as
          | Partial<SessionResponse> & { error?: string };

        if (!response.ok || !body.token || !body.state || !body.activity) {
          throw new Error(body.error || "No se pudo preparar la sesión.");
        }
        return body as SessionResponse;
      };

      if (token || !assignmentLaunch) {
        return requestStandardSession(token);
      }

      const storageKey =
        `aimauta.assignment-run.v1:${assignmentLaunch.publicToken}`;
      let resumeToken = assignmentResumeTokenRef.current;
      if (!resumeToken) {
        try {
          resumeToken = window.localStorage.getItem(storageKey) ?? "";
        } catch {
          resumeToken = "";
        }
      }

      for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
        if (!resumeToken) {
          const createResponse = await fetch(
            `/api/assignments/public/${encodeURIComponent(assignmentLaunch.publicToken)}/runs`,
            { method: "POST", signal },
          );
          const created = (await createResponse.json().catch(() => ({}))) as {
            resumeToken?: string;
            error?: string;
          };
          if (!createResponse.ok || !created.resumeToken) {
            throw new Error(
              created.error || "No se pudo iniciar la actividad asignada.",
            );
          }
          resumeToken = created.resumeToken;
          assignmentResumeTokenRef.current = resumeToken;
          try {
            window.localStorage.setItem(storageKey, resumeToken);
          } catch {
            // La sesión sigue activa en memoria si el navegador bloquea storage.
          }
        }

        const startResponse = await fetch(
          `/api/assignment-runs/current/items/${encodeURIComponent(assignmentLaunch.itemId)}/session`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${resumeToken}` },
            signal,
          },
        );
        const started = (await startResponse.json().catch(() => ({}))) as {
          session?: SessionResponse;
          error?: string;
        };
        if (
          startResponse.ok &&
          started.session?.token &&
          started.session.state &&
          started.session.activity
        ) {
          assignmentResumeTokenRef.current = resumeToken;
          const assignedSession = started.session;
          const selectionMatches =
            selection === undefined ||
            selection === null ||
            (assignedSession.state.exerciseId === selection.exerciseId &&
              assignedSession.state.exerciseRevision ===
                selection.exerciseRevision);
          if (
            assignedSession.state.page === targetPage &&
            selectionMatches
          ) {
            return assignedSession;
          }
          return requestStandardSession(assignedSession.token);
        }

        if (
          attemptNumber === 0 &&
          (startResponse.status === 401 || startResponse.status === 404)
        ) {
          resumeToken = "";
          assignmentResumeTokenRef.current = "";
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            // No hay nada más que limpiar si storage no está disponible.
          }
          continue;
        }
        throw new Error(
          started.error || "No se pudo abrir el objetivo asignado.",
        );
      }

      throw new Error("No se pudo reanudar la actividad asignada.");
    },
    [assignmentLaunch, book.id],
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
        const body = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error("EXERCISE_REQUEST_FAILED");
        }
        const parsed = parsePageExercisesResponse(body, {
          bookId: book.id,
          page,
        });
        if (!parsed) {
          throw new Error("EXERCISE_RESPONSE_INVALID");
        }
        return parsed;
      })
      .then((result: PageExercisesResponse) => {
        if (controller.signal.aborted) return;
        if (result.publicationStatus === "not-published") {
          exercisesRef.current = [];
          setExercises([]);
          setSelectedExercise(null);
          setExerciseAvailability("not-published");
          return;
        }

        const pageExercises = [...result.exercises];
        exercisesRef.current = pageExercises;
        setExercises(pageExercises);
        setSelectedExercise((current) => {
          const boundSession = canonicalSessionRef.current;
          const exercise = pageExercises.find(
            (candidate) =>
              candidate.id ===
                (current?.exerciseId ?? boundSession?.exerciseId) &&
              candidate.revision ===
                (current?.exerciseRevision ??
                  boundSession?.exerciseRevision),
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
        setExerciseAvailability(
          pageExercises.length > 0 ? "available" : "empty",
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        exercisesRef.current = [];
        setExercises([]);
        setSelectedExercise(null);
        setExerciseAvailability("failed");
      });

    return () => controller.abort();
  }, [book.id, exerciseRequestRevision, page]);

  useEffect(() => {
    const controller = new AbortController();
    const requestEpoch = ++stateRequestEpochRef.current;

    void requestSession(firstPage, undefined, controller.signal)
      .then((result) => {
        if (requestEpoch !== stateRequestEpochRef.current) return;
        applySession(result);
        setSessionError("");
        setMessages([welcomeMessage(result.activity)]);
      })
      .catch(() => {
        if (
          controller.signal.aborted ||
          requestEpoch !== stateRequestEpochRef.current
        ) {
          return;
        }
        setSessionError(
          "No pudimos iniciar la sesión de aprendizaje. Vuelve a intentarlo.",
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
      if (
        !sessionTokenRef.current ||
        targetPage === page ||
        pendingNavigationEpochRef.current !== null
      ) {
        return;
      }
      const previousExerciseAvailability = exerciseAvailability;
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
      setExerciseAvailability("loading");
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
        if (previousExerciseAvailability === "loading") {
          setExerciseRequestRevision((current) => current + 1);
        } else {
          setExerciseAvailability(previousExerciseAvailability);
        }
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
      exerciseAvailability,
      page,
      requestSession,
    ],
  );

  async function selectExercise(selection: ExerciseSelection) {
    if (
      !sessionTokenRef.current ||
      isSyncingPage ||
      exerciseAvailability !== "available" ||
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

  function retryExercises() {
    setNotice("");
    exercisesRef.current = [];
    setExercises([]);
    setSelectedExercise(null);
    setExerciseAvailability("loading");
    setExerciseRequestRevision((current) => current + 1);
  }

  async function completeAssignedItem() {
    if (
      !assignmentLaunch ||
      !assignmentResumeTokenRef.current ||
      isCompletingAssignment ||
      assignmentItemCompleted
    ) {
      return;
    }
    setIsCompletingAssignment(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/assignment-runs/current/items/${encodeURIComponent(assignmentLaunch.itemId)}/complete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${assignmentResumeTokenRef.current}`,
          },
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        receipt?: { url?: string } | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "No se pudo completar este objetivo.");
      }
      setAssignmentItemCompleted(true);
      setCompletionReceiptUrl(body.receipt?.url ?? "");
      setNotice(
        body.receipt?.url
          ? "Actividad completada. Ya puedes abrir o compartir tu comprobante."
          : "Objetivo completado. Vuelve a la tarea para continuar con el siguiente.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo completar este objetivo.",
      );
    } finally {
      setIsCompletingAssignment(false);
    }
  }

  return (
    <div className="learning-shell">
      <header className="workspace-header">
        <a
          className="brand brand-small"
          href={assignmentLaunch?.landingPath ?? "/"}
          aria-label={
            assignmentLaunch ? "Volver a la tarea" : "Volver a AImauta"
          }
        >
          <BrandMark />
          <span>AImauta</span>
        </a>
        <div className="workspace-breadcrumb" aria-label="Ubicación actual">
          <span>{book.level}</span>
          <i aria-hidden="true">/</i>
          <strong>{book.subject}</strong>
          {assignmentLaunch ? (
            <>
              <i aria-hidden="true">/</i>
              <strong>{assignmentLaunch.assignmentTitle}</strong>
            </>
          ) : null}
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
              error={sessionError}
              isLoading={isStartingSession}
              onRetry={() => window.location.reload()}
            />
          )}
          {sessionToken &&
          session &&
          !isSyncingPage &&
          modeCopy.banner ? (
            <ExerciseAvailabilityBanner
              {...modeCopy.banner}
              onRetry={
                modeCopy.banner.retryLabel ? retryExercises : undefined
              }
            />
          ) : null}
          {isSyncingPage ? (
            <div className="page-sync-overlay" role="status">
              <span className="sync-spinner" aria-hidden="true" />
              Preparando la página y su contexto…
            </div>
          ) : null}
        </div>

        <aside className="coach-panel coach-panel-session" aria-label="Sesión guiada">
          <section className="session-context-section">
            <div className="guide-quickstart" role="note">
              <span aria-hidden="true">GUÍA</span>
              <div>
                <strong>{modeCopy.quickstartTitle}</strong>
                <p>{modeCopy.quickstartBody}</p>
              </div>
            </div>

            <div
              className={`exercise-focus exercise-focus-${modeCopy.focusTone}`}
              role="status"
            >
              <span aria-hidden="true">{modeCopy.focusIcon}</span>
              <div>
                <strong>
                  {modeCopy.focusTone === "active" && activeExercise
                    ? `${activeExercise.label}: ${activeExercise.title}`
                    : modeCopy.focusTitle}
                </strong>
                <p>{modeCopy.focusBody}</p>
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
                <StageProgress
                  activity={activity}
                  session={session}
                  supportAvailable={interactiveSupportAvailable}
                />
                {voiceTutorEnabled ? (
                  <VoiceTutor
                    sessionId={session.sessionId}
                    sessionToken={sessionToken}
                    disabled={!tutorAvailable}
                    disabledReason={modeCopy.tutorDisabledReason}
                    onSessionUpdate={applyVoiceSession}
                  />
                ) : avatarPreviewEnabled ? (
                  <AvatarPreview />
                ) : null}
              </>
            ) : null}
          </section>

          <section className="attempt-section attempt-section-session">
            <div className="panel-heading">
              <span className="panel-step">1</span>
              <div>
                <p>{modeCopy.attemptEyebrow}</p>
                <h2>{modeCopy.attemptTitle}</h2>
              </div>
            </div>
            <label className="sr-only" htmlFor="student-attempt">
              {tutorAvailable
                ? "Tu intento para resolver el ejercicio"
                : "Tus notas sobre la página"}
            </label>
            <textarea
              id="student-attempt"
              placeholder={modeCopy.attemptPlaceholder}
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
                {modeCopy.reviewButtonLabel}
                {tutorAvailable ? <SparkIcon /> : <LockButtonIcon />}
              </button>
              {assignmentLaunch ? (
                <button
                  className="review-button"
                  type="button"
                  onClick={() => void completeAssignedItem()}
                  disabled={
                    !sessionToken ||
                    isCompletingAssignment ||
                    assignmentItemCompleted
                  }
                >
                  {assignmentItemCompleted
                    ? "Objetivo completado"
                    : isCompletingAssignment
                      ? "Guardando…"
                      : "Completar objetivo"}
                </button>
              ) : null}
            </div>
            {completionReceiptUrl ? (
              <p className="workspace-notice" role="status">
                <a href={completionReceiptUrl}>Abrir comprobante verificable</a>
              </p>
            ) : null}
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
                placeholder={modeCopy.chatPlaceholder}
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
              {modeCopy.tutorPromise}
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

function ExerciseAvailabilityBanner({
  title,
  body,
  tone,
  loading = false,
  retryLabel,
  onRetry,
}: {
  title: string;
  body: string;
  tone: "neutral" | "warning";
  loading?: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <section
      className={`exercise-availability-banner exercise-availability-banner-${tone}`}
      role={tone === "warning" ? "alert" : "status"}
      aria-live={tone === "warning" ? "assertive" : "polite"}
    >
      <span
        className={
          loading
            ? "sync-spinner"
            : "exercise-availability-banner-icon"
        }
        aria-hidden="true"
      >
        {loading ? null : tone === "warning" ? "!" : "i"}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      {retryLabel && onRetry ? (
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </section>
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
