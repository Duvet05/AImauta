import { getBook } from "@/lib/catalog";
import { askOllama } from "@/lib/ollama";
import {
  buildTutorSystemPrompt,
  fallbackGuide,
  getTurnPolicy,
  isSafeTutorMessage,
  type TutorHistoryItem
} from "@/lib/pedagogy";
import { retrieveEvidence } from "@/lib/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TutorRequest = {
  bookId?: unknown;
  page?: unknown;
  message?: unknown;
  attempt?: unknown;
  history?: unknown;
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanHistory(value: unknown): TutorHistoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(-6)
    .flatMap((item): TutorHistoryItem[] => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const role =
        "role" in item && (item.role === "student" || item.role === "tutor")
          ? item.role
          : null;
      const content =
        "content" in item ? cleanText(item.content, 1_000) : "";
      return role && content ? [{ role, content }] : [];
    });
}

export async function POST(request: Request): Promise<Response> {
  let body: TutorRequest;
  try {
    body = (await request.json()) as TutorRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON inválida." }, { status: 400 });
  }

  const bookId = cleanText(body.bookId, 100);
  const book = getBook(bookId);
  const page = Number(body.page);
  const message = cleanText(body.message, 1_500);
  const attempt = cleanText(body.attempt, 2_000);
  const history = cleanHistory(body.history);

  if (!book || !Number.isInteger(page) || page < 1 || page > book.pages) {
    return Response.json(
      { error: "Libro o página inválidos." },
      { status: 400 }
    );
  }
  if (!message) {
    return Response.json(
      { error: "Escribe una pregunta o cuéntame dónde te atascaste." },
      { status: 400 }
    );
  }

  const evidence = await retrieveEvidence({ bookId, page, query: message });
  const policy = getTurnPolicy({ attempt, history });
  const systemPrompt = buildTutorSystemPrompt({ page, policy, evidence });

  let tutorMessage: string | null = null;
  let mode: "gemma" | "guided-fallback" = "guided-fallback";
  try {
    tutorMessage = await askOllama({
      systemPrompt,
      studentMessage: message,
      attempt,
      history,
      policy
    });
    if (tutorMessage && isSafeTutorMessage(tutorMessage)) {
      mode = "gemma";
    } else {
      tutorMessage = null;
    }
  } catch (error) {
    console.error("Tutor inference unavailable", error);
  }

  tutorMessage ??= fallbackGuide({ page, attempt, evidence, policy });

  return Response.json({
    message: tutorMessage,
    citations: evidence.map((item) => ({
      sourceId: item.sourceId,
      page: item.page
    })),
    mode,
    policy: {
      hintLevel: policy.hintLevel,
      canRevealSolution: policy.canRevealSolution
    }
  });
}
