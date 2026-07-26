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
  isSafeGuideMessage,
  isSafeTutorMessage,
  parseGuidanceDecision,
  parseGuideMessage,
  renderGuidanceMove,
  type TurnPolicy
} from "@/lib/pedagogy";
import { retrieveRagServiceEvidence } from "@/lib/rag-service";
import {
  retrieveEvidence,
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
    | "ollama"
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
  "ollama" | "openai" | "xai" | "gemini" | "guided-fallback"
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
    if (input.policy.mode === "socratic") {
      const decision = rawMove ? parseGuidanceDecision(rawMove) : null;
      if (decision) {
        tutorMessage = renderGuidanceMove({
          move: decision.move,
          attempted: input.attempt.trim().length >= 3,
          question: decision.question
        });
      }
      if (!tutorMessage || !isSafeTutorMessage(tutorMessage)) {
        tutorMessage = null;
      }
    } else {
      const guidance = rawMove ? parseGuideMessage(rawMove) : null;
      tutorMessage =
        guidance && isSafeGuideMessage(guidance) ? guidance : null;
    }
    if (tutorMessage) {
      mode = inference?.provider ?? "guided-fallback";
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

async function retrievePageEvidence(input: {
  bookId: string;
  page: number;
  question: string;
  attempt: string;
}): Promise<Evidence[]> {
  const request = {
    bookId: input.bookId,
    question: input.question,
    attempt: input.attempt,
    page: input.page,
    allowedPages: [input.page]
  };
  const remoteEvidence = await retrieveRagServiceEvidence(request);
  if (remoteEvidence !== null) {
    return remoteEvidence;
  }

  try {
    return await retrieveEvidence(request);
  } catch {
    // A malformed or unavailable local index must fail closed.
    return [];
  }
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
    const evidence = await retrievePageEvidence({
      bookId: verified.bookId,
      page: verified.page,
      question: input.message,
      attempt: input.attempt
    });
    const current = recordLearningTurn({
      token: input.sessionToken,
      attempt: input.attempt,
      attemptReference:
        evidence.length > 0
          ? evidence
              .map((item) => item.text.slice(0, 1_200))
              .join("\n")
          : undefined
    });
    await recordAssignmentLearningProgress(current.state);

    if (evidence.length === 0) {
      return {
        message:
          "No encuentro evidencia validada para orientar esta página. Selecciona un ejercicio marcado o avisa a tu docente.",
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

    const basePolicy = getTurnPolicy({
      hintLevel: current.state.hintLevel,
      stage: current.state.stage,
      attemptCount: current.state.attemptCount,
      turnCount: current.state.turnCount
    });
    const policy: TurnPolicy = {
      ...basePolicy,
      // Only a reviewed exercise solution can ever unlock a final answer.
      canRevealSolution: false
    };
    const guided = await createGuidedMessage({
      sessionId: current.state.sessionId,
      page: current.state.page,
      attemptCount: current.state.attemptCount,
      message: input.message,
      attempt: input.attempt,
      evidence,
      policy
    });

    return {
      message: guided.message,
      citations: evidence.map((item) => ({
        sourceId: item.sourceId,
        page: item.page,
        chunkId: item.id
      })),
      mode: guided.mode,
      sessionToken: current.token,
      session: current.state,
      activity: current.activity,
      policy: {
        hintLevel: policy.hintLevel,
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
  const evidence = (
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
  if (evidence.length === 0) {
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
