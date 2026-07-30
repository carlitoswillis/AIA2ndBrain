import { GoogleGenAI, Type } from "@google/genai";

// Gemini provider — the backstop behind the Claude CLI (see lib/llm.ts).
// Structured output via responseSchema; returns the raw JSON text for llm.ts
// to validate.

const MODEL = "gemini-2.5-flash";

let client: GoogleGenAI | undefined;

export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export async function runGemini(prompt: string): Promise<string> {
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: "~120 word read/skip decision summary, plain prose.",
          },
          suggested_title: {
            type: Type.STRING,
            description: "Clean human-readable title.",
          },
        },
        required: ["summary", "suggested_title"],
      },
    },
  });

  const text = res.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}
