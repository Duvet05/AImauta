import { getPageActivity } from "@/lib/curriculum";
import {
  recordLearningTurn,
  verifyLearningSession
} from "@/lib/learning-session";
import { askOllama } from "@/lib/ollama";
import {
  buildTutorSystemPrompt,
  fallbackGuide,
  getTurnPolicy,
  isSafeTutorMessage,
  parseGuidanceMove,
  renderGuidanceMove
} from "@/lib/pedagogy";
import { retrieveEvidence } from "@/lib/retrieval";
import { consumeRateLimit } from "@/lib/rate-limit";

export type TutorTurnResult = {
  message: string;
  citations: Array<{ sourceId: string; page: number }>;
  mode: "gemma" | "guided-fallback" | "assessment-locked";
  sessionToken: string;
  session: ReturnType<typeof recordLearningTurn>["state"];
  activity: ReturnType<typeof recordLearningTurn>["activity"];
  policy: {
    hintLevel: 0 | 1 | 2 | 3;
    canRevealSolution: false;
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
        "Estás en la etapa Evaluamos. Aquí AImauta guarda silencio para que puedas demostrar lo que aprendiste por tu cuenta.",
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

  const retrievedEvidence = await retrieveEvidence({
    bookId: verified.bookId,
    page: verified.page,
    query: input.message
  });
  const evidence = retrievedEvidence
    .filter(
      (item) =>
        getPageActivity(verified.bookId, item.page).stage !== "assessment"
    )
    .map((item, index) => ({ ...item, sourceId: `S${index + 1}` }));
  const current = recordLearningTurn({
    token: input.sessionToken,
    attempt: input.attempt
  });
  const policy = getTurnPolicy({
    hintLevel: current.state.hintLevel,
    stage: current.state.stage
  });
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

  return {
    message: tutorMessage,
    citations: evidence.map((item) => ({
      sourceId: item.sourceId,
      page: item.page
    })),
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
