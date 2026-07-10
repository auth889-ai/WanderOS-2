import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { getModel, ModelTier } from "./llm";

/**
 * invokeStructured: ask Gemini for JSON that MUST match a Zod schema.
 *
 * This is the Quality-Gate primitive (docs/MASTER_ARCHITECTURE.md §4): every agent uses it
 * so the rest of the system always receives validated, typed data — never a raw string that
 * might be malformed. On parse failure it retries with the validation error fed back to the
 * model (genuine self-correction), then throws if still invalid.
 */
export type InvokeOptions = {
  tier?: ModelTier;
  /** extra retries beyond the first attempt (default 1 => up to 2 total tries) */
  retries?: number;
  /** optional system instruction prepended to the prompt */
  system?: string;
};

function stripCodeFences(text: string): string {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractJson(text: string): string {
  const cleaned = stripCodeFences(text);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return cleaned.slice(first, last + 1);
  }
  return cleaned;
}

/**
 * Last-resort repair: models occasionally omit a required NARRATIVE string field (e.g. "reasoning").
 * Rather than fail a whole multi-agent run on that, fill missing top-level required strings with "".
 * Real structural problems (wrong types, missing numbers/enums) are left to fail and retry.
 */
function repairMissingStrings(value: unknown, error: z.ZodError): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const issue of error.issues) {
    const i = issue as { code?: string; expected?: string; received?: string; path: (string | number)[] };
    const missingString = i.code === "invalid_type" && i.expected === "string" && i.received === "undefined";
    if (missingString && i.path.length === 1 && typeof i.path[0] === "string") {
      clone[i.path[0]] = "";
    }
  }
  return clone;
}

export async function invokeStructured<T>(
  schema: z.ZodType<T>,
  prompt: string,
  options: InvokeOptions = {}
): Promise<T> {
  const { tier = "flash", retries = 2, system } = options;
  const model = getModel(tier);

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const correction = lastError
      ? `\n\nYour previous response failed validation with: ${lastError}\nReturn ONLY valid JSON that fixes this — include EVERY field.`
      : "";
    const full = `${system ? system + "\n\n" : ""}${prompt}\n\nReturn ONLY valid JSON. No markdown, no commentary.${correction}`;

    const response = await model.invoke(full);
    const raw = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    let parsedObj: unknown;
    try {
      parsedObj = JSON.parse(extractJson(raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    const result = schema.safeParse(parsedObj);
    if (result.success) return result.data;
    // tolerate an omitted narrative string (e.g. reasoning) instead of failing the whole run
    const repaired = schema.safeParse(repairMissingStrings(parsedObj, result.error));
    if (repaired.success) return repaired.data;
    lastError = result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
  }

  throw new Error(`invokeStructured failed after ${retries + 1} attempts. Last error: ${lastError}`);
}

/** Convert an image (http url or data URI) into a base64 data URI Gemini can read inline. */
async function toDataUri(image: string): Promise<string> {
  if (image.startsWith("data:")) return image;
  const res = await fetch(image);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${image}`);
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * invokeStructuredVision: same as invokeStructured but MULTIMODAL — passes one or more images
 * (urls or data URIs) plus the prompt to a vision model, and returns validated JSON.
 * Used by vision agents (e.g. property-vision) to analyze the host's real photos.
 */
export async function invokeStructuredVision<T>(
  schema: z.ZodType<T>,
  prompt: string,
  images: string[],
  options: InvokeOptions = {}
): Promise<T> {
  const { tier = "flash", retries = 2, system } = options;
  const model = getModel(tier);
  const dataUris = await Promise.all(images.map(toDataUri));

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const correction = lastError
      ? `\n\nYour previous response failed validation with: ${lastError}\nReturn ONLY valid JSON that fixes this — include EVERY field.`
      : "";
    const text = `${system ? system + "\n\n" : ""}${prompt}\n\nReturn ONLY valid JSON. No markdown, no commentary.${correction}`;
    const content = [
      { type: "text", text },
      ...dataUris.map((uri) => ({ type: "image_url", image_url: uri }))
    ];

    const response = await model.invoke([new HumanMessage({ content })]);
    const raw = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    let parsedObj: unknown;
    try {
      parsedObj = JSON.parse(extractJson(raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    const result = schema.safeParse(parsedObj);
    if (result.success) return result.data;
    const repaired = schema.safeParse(repairMissingStrings(parsedObj, result.error));
    if (repaired.success) return repaired.data;
    lastError = result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
  }

  throw new Error(`invokeStructuredVision failed after ${retries + 1} attempts. Last error: ${lastError}`);
}
