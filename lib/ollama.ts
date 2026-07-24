import type { TurnPolicy } from "@/lib/pedagogy";

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaChatResponse = {
  message?: {
    content?: unknown;
  };
};

export async function askOllama(input: {
  systemPrompt: string;
  studentMessage: string;
  attempt: string;
  policy: TurnPolicy;
}): Promise<string | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL?.replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL;
  if (!baseUrl || !model) {
    return null;
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: input.systemPrompt },
    {
      role: "user",
      content: input.attempt.trim()
        ? `Mi pregunta: ${input.studentMessage}\nMi intento: ${input.attempt}`
        : input.studentMessage
    }
  ];

  const timeout = Number(process.env.OLLAMA_TIMEOUT_MS ?? "45000");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      // Reasoning-capable Gemma variants otherwise spend the entire short
      // generation budget in `message.thinking` and return no student-facing
      // content. The pedagogical prompt already asks for one concise turn.
      think: false,
      keep_alive: "30m",
      messages,
      options: {
        temperature: 0.2,
        num_ctx: 4096,
        num_predict: input.policy.maxOutputTokens
      }
    }),
    signal: AbortSignal.timeout(
      Number.isFinite(timeout) ? Math.max(1_000, timeout) : 45_000
    )
  });

  if (!response.ok) {
    throw new Error(`Ollama respondió HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OllamaChatResponse;
  const content = payload.message?.content;
  return typeof content === "string" && content.trim()
    ? content.trim()
    : null;
}
