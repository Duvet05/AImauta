import { getPageActivity } from "@/lib/curriculum";
import { recordAssignmentLearningProgress } from "@/lib/assignment-service";
import {
  LearningSessionError,
  recordLearningTurn,
  verifyLearningSession
} from "@/lib/learning-session";
import { getReviewedExerciseSolution } from "@/lib/exercise-solution-store";
import { getPublishedExercise } from "@/lib/exercise-store";
import { askTutorModel } from "@/lib/llm";
import {
  buildTutorSystemPrompt,
  fallbackGuide,
  getTurnPolicy,
  isSafeTutorMessage,
  parseGuidanceMove,
  renderGuidanceMove,
  type TurnPolicy
} from "@/lib/pedagogy";
import { retrieveRagServiceEvidence } from "@/lib/rag-service";
import {
  retrieveExerciseEvidence,
  type Evidence
} from "@/lib/retrieval";
import { consumeRateLimit } from "@/lib/rate-limit";

export type TutorTurnResult = {
  message: string;
  citations: Array<{
    sourceId: string;
    page: number;
    chunkId: string;
  }>;
  mode:
    | "openai"
    | "xai"
    | "gemini"
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

type GuidedMode = Extract<
  TutorTurnResult["mode"],
  "openai" | "xai" | "gemini" | "guided-fallback"
>;

async function createGuidedMessage(input: {
  sessionId: string;
  page: number;
  attemptCount: number;
  message: string;
  attempt: string;
  evidence: readonly Evidence[];
  policy: TurnPolicy;
}): Promise<{ message: string; mode: GuidedMode }> {
  const systemPrompt = buildTutorSystemPrompt({
    page: input.page,
    policy: input.policy,
    evidence: input.evidence,
    attemptCount: input.attemptCount
  });

  let tutorMessage: string | null = null;
  let mode: GuidedMode = "guided-fallback";
  try {
    const inference = await askTutorModel({
      sessionId: input.sessionId,
      systemPrompt,
      studentMessage: input.message,
      attempt: input.attempt,
      policy: input.policy
    });
    const rawMove = inference?.content ?? null;
    const move = rawMove ? parseGuidanceMove(rawMove) : null;
    if (move) {
      tutorMessage = renderGuidanceMove({
        move,
        attempted: input.attempt.trim().length >= 3
      });
    }
    if (tutorMessage && isSafeTutorMessage(tutorMessage)) {
      mode = inference?.provider ?? "guided-fallback";
    } else {
      tutorMessage = null;
    }
  } catch {
    // Provider, quota and budget failures use the deterministic guide.
  }

  return {
    message:
      tutorMessage ??
      fallbackGuide({
        page: input.page,
        attempt: input.attempt,
        evidence: input.evidence,
        policy: input.policy
      }),
    mode
  };
}

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
    await recordAssignmentLearningProgress(current.state);
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
    return {
      message:
        "Selecciona primero uno de los ejercicios marcados sobre el cuaderno. Hasta entonces, AImauta no consulta el material ni da pistas.",
      citations: [],
      mode: "exercise-locked",
      sessionToken: input.sessionToken,
      session: verified,
      activity: verifiedActivity,
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
  const localEvidence = (
    await retrieveExerciseEvidence({
      bookId: verified.bookId,
      exercise,
      question: input.message,
      attempt: input.attempt,
      page: verified.page
    })
  )
    .filter(
      (item) =>
        item.exerciseId === exercise.id &&
        exercisePages.includes(item.page) &&
        (!verified.assignment ||
          verified.assignment.allowedPages.includes(item.page)) &&
        getPageActivity(verified.bookId, item.page).stage !== "assessment"
    )
    .map((item, index) => ({ ...item, sourceId: `S${index + 1}` }));
  if (localEvidence.length === 0) {
    return {
      message:
        "El material de referencia de este ejercicio no está disponible. AImauta no dará pistas hasta que el cuaderno validado esté listo.",
      citations: [],
      mode: "exercise-locked",
      sessionToken: input.sessionToken,
      session: verified,
      activity: verifiedActivity,
      policy: {
        hintLevel: 0,
        canRevealSolution: false
      }
    };
  }
  const reviewedSolution = await getReviewedExerciseSolution({
    bookId: verified.bookId,
    exerciseId: exercise.id,
    revision: exercise.revision
  });
  const allowedPages = verified.assignment
    ? exercisePages.filter((page) =>
        verified.assignment?.allowedPages.includes(page)
      )
    : exercisePages;
  const remoteEvidence = await retrieveRagServiceEvidence({
    bookId: verified.bookId,
    exercise,
    requiredAnchor: exercise.prompt,
    question: input.message,
    attempt: input.attempt,
    page: verified.page,
    allowedPages
  });
  const seenChunkIds = new Set(localEvidence.map((item) => item.id));
  const evidence = [
    ...localEvidence,
    ...(remoteEvidence ?? []).filter((item) => {
      if (
        item.exerciseId !== exercise.id ||
        !allowedPages.includes(item.page) ||
        seenChunkIds.has(item.id)
      ) {
        return false;
      }
      seenChunkIds.add(item.id);
      return true;
    })
  ].map((item, index) => ({ ...item, sourceId: `S${index + 1}` }));
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
  await recordAssignmentLearningProgress(current.state);
  const policy = getTurnPolicy({
    hintLevel: current.state.hintLevel,
    stage: current.state.stage,
    attemptCount: current.state.attemptCount,
    turnCount: current.state.turnCount
  });
  const citations = evidence.map((item) => ({
    sourceId: item.sourceId,
    page: item.page,
    chunkId: item.id
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
  const guided = await createGuidedMessage({
    sessionId: current.state.sessionId,
    page: current.state.page,
    attemptCount: current.state.attemptCount,
    message: input.message,
    attempt: input.attempt,
    evidence,
    policy
  });
  let tutorMessage = guided.message;
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
    mode: guided.mode,
    sessionToken: current.token,
    session: current.state,
    activity: current.activity,
    policy: {
      hintLevel: policy.hintLevel,
      canRevealSolution: policy.canRevealSolution
    }
  };
}
