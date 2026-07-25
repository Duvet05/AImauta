import { getPageActivity } from "@/lib/curriculum";
import {
  LearningSessionError,
  recordLearningTurn,
  verifyLearningSession
} from "@/lib/learning-session";
import { getReviewedExerciseSolution } from "@/lib/exercise-solution-store";
import { getPublishedExercise } from "@/lib/exercise-store";
import { askOllama } from "@/lib/ollama";
import {
  buildTutorSystemPrompt,
  fallbackGuide,
  getTurnPolicy,
  isSafeTutorMessage,
  parseGuidanceMove,
  renderGuidanceMove
} from "@/lib/pedagogy";
import { retrieveExerciseEvidence } from "@/lib/retrieval";
import { consumeRateLimit } from "@/lib/rate-limit";

export type TutorTurnResult = {
  message: string;
  citations: Array<{ sourceId: string; page: number }>;
  mode:
    | "gemma"
    | "guided-fallback"
    | "assessment-locked"
    | "exercise-locked"
    | "reviewed-answer";
  sessionToken: string;
  session: ReturnType<typeof recordLearningTurn>["state"];
  activity: ReturnType<typeof recordLearningTurn>["activity"];
  policy: {
    hintLevel: 0 | 1 | 2 | 3;
    canRevealSolution: boolean;
  };
};

export async function guideLearningTurn(input: {
  sessionToken: string;
  message: string;
  attempt: string;
}): Promise<TutorTurnResult> {
  const verified = verifyLearningSession(input.sessionToken);
  consumeRateLimit({
    scope: "tutor-turn",
    key: verified.sessionId,
    limit: 12,
    windowMs: 60_000
  });
  const verifiedActivity = getPageActivity(
    verified.bookId,
    verified.page
  );
  if (!verifiedActivity.tutorAvailable) {
    const current = recordLearningTurn({
      token: input.sessionToken,
      attempt: input.attempt
    });
    return {
      message:
        verifiedActivity.stage === "assessment" &&
        verifiedActivity.unitId !== null
          ? "Estás en la etapa Evaluamos. Aquí AImauta guarda silencio para que puedas demostrar lo que aprendiste por tu cuenta."
          : "En esta página AImauta no da pistas ni consulta el cuaderno.",
      citations: [],
      mode: "assessment-locked",
      sessionToken: current.token,
      session: current.state,
      activity: current.activity,
      policy: {
        hintLevel: 0,
        canRevealSolution: false
      }
    };
  }

  if (
    verified.exerciseId === null ||
    verified.exerciseRevision === null
  ) {
    const current = recordLearningTurn({
      token: input.sessionToken,
      attempt: input.attempt
    });
    return {
      message:
        "Selecciona primero uno de los ejercicios marcados sobre el cuaderno. Hasta entonces, AImauta no consulta el material ni da pistas.",
      citations: [],
      mode: "exercise-locked",
      sessionToken: current.token,
      session: current.state,
      activity: current.activity,
      policy: {
        hintLevel: 0,
        canRevealSolution: false
      }
    };
  }

  const exercise = await getPublishedExercise(
    verified.bookId,
    verified.exerciseId
  );
  if (
    !exercise ||
    exercise.revision !== verified.exerciseRevision ||
    !exercise.regions.some(
      (region) => region.page === verified.page
    )
  ) {
    throw new LearningSessionError(
      "El ejercicio seleccionado ya no está disponible.",
      "exercise"
    );
  }
  const exercisePages = [
    ...new Set(exercise.regions.map((region) => region.page))
  ].sort((left, right) => left - right);
  const reviewedSolution = await getReviewedExerciseSolution({
    bookId: verified.bookId,
    exerciseId: exercise.id,
    revision: exercise.revision
  });

  const evidence = retrieveExerciseEvidence(exercise)
    .filter(
      (item) =>
        item.exerciseId === exercise.id &&
        exercisePages.includes(item.page) &&
        getPageActivity(verified.bookId, item.page).stage !== "assessment"
    )
    .map((item, index) => ({ ...item, sourceId: `S${index + 1}` }));
  if (evidence.length === 0) {
    throw new LearningSessionError(
      "El ejercicio seleccionado no tiene material de referencia disponible.",
      "exercise"
    );
  }
  const current = recordLearningTurn({
    token: input.sessionToken,
    attempt: input.attempt,
    attemptReference: [
      ...reviewedSolution.pedagogicalSteps,
      ...reviewedSolution.hints.map((hint) => hint.text),
      ...reviewedSolution.rubric.flatMap((item) => [
        item.criterion,
        item.expectedEvidence
      ])
    ].join("\n")
  });
  const policy = getTurnPolicy({
    hintLevel: current.state.hintLevel,
    stage: current.state.stage,
    attemptCount: current.state.attemptCount,
    turnCount: current.state.turnCount
  });
  const citations = evidence.map((item) => ({
    sourceId: item.sourceId,
    page: item.page
  }));

  if (policy.canRevealSolution) {
    return {
      message:
        "Ya recorriste las tres pistas e intentaste más de una estrategia. " +
        `Respuesta revisada: ${reviewedSolution.finalAnswer.slice(0, 2_000)}`,
      citations,
      mode: "reviewed-answer",
      sessionToken: current.token,
      session: current.state,
      activity: current.activity,
      policy: {
        hintLevel: policy.hintLevel,
        canRevealSolution: true
      }
    };
  }
  const systemPrompt = buildTutorSystemPrompt({
    page: current.state.page,
    policy,
    evidence,
    attemptCount: current.state.attemptCount
  });

  let tutorMessage: string | null = null;
  let mode: TutorTurnResult["mode"] = "guided-fallback";
  try {
    const rawMove = await askOllama({
      systemPrompt,
      studentMessage: input.message,
      attempt: input.attempt,
      policy
    });
    const move = rawMove ? parseGuidanceMove(rawMove) : null;
    if (move) {
      tutorMessage = renderGuidanceMove({
        move,
        attempted: input.attempt.trim().length >= 3
      });
    }
    if (tutorMessage && isSafeTutorMessage(tutorMessage)) {
      mode = "gemma";
    } else {
      tutorMessage = null;
    }
  } catch (error) {
    console.error("Tutor inference unavailable", error);
  }

  tutorMessage ??= fallbackGuide({
    page: current.state.page,
    attempt: input.attempt,
    evidence,
    policy
  });
  const approvedHint = reviewedSolution.hints.find(
    (hint) => hint.level === policy.hintLevel
  );
  if (approvedHint) {
    tutorMessage =
      `Pista ${approvedHint.level} de 3: ${approvedHint.text.slice(0, 1_000)} ` +
      tutorMessage;
  }

  return {
    message: tutorMessage,
    citations,
    mode,
    sessionToken: current.token,
    session: current.state,
    activity: current.activity,
    policy: {
      hintLevel: policy.hintLevel,
      canRevealSolution: policy.canRevealSolution
    }
  };
}
