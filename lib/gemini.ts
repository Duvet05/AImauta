import { GoogleGenAI } from "@google/genai";

export type GeminiImageInput = {
  data: string;
  mimeType?: "image/webp";
};

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GENAI_API_KEY no está configurada.");
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

function getModel(): string {
  const model = process.env.GOOGLE_GENAI_MODEL;
  if (!model) {
    throw new Error("GOOGLE_GENAI_MODEL no está configurada.");
  }
  return model;
}

export async function sendPrompt(prompt: string): Promise<string | null> {
  const interaction = await getClient().interactions.create({
    model: getModel(),
    input: prompt,
    generation_config: {
      thinking_level: "low"
    }
  });
  return interaction.output_text ?? null;
}

export async function sendPromptWithImages(
  prompt: string,
  images: GeminiImageInput[]
): Promise<string | null> {
  const interaction = await getClient().interactions.create({
    model: getModel(),
    input: [
      { type: "text", text: prompt },
      ...images.map((image) => ({
        type: "image" as const,
        data: image.data,
        mime_type: image.mimeType ?? "image/webp"
      }))
    ]
  });
  return interaction.output_text ?? null;
}
