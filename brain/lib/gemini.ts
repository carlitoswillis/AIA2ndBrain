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

// Callers hold plain JSON Schema (what claude's --json-schema takes); this SDK
// wants its own Type enum and rejects a few JSON Schema keywords outright.
// Translate rather than maintain two copies of every schema.
type JsonSchema = {
  type?: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

const TYPES: Record<string, Type> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
};

function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type) out.type = TYPES[schema.type] ?? Type.STRING;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)])
    );
  }
  if (schema.required) out.required = schema.required;
  // `additionalProperties` is deliberately dropped — the SDK errors on it.
  return out;
}

export async function runGemini(prompt: string, schema: object): Promise<string> {
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(schema as JsonSchema),
    },
  });

  const text = res.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}
