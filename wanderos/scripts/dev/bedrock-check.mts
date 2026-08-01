/** Does the tier abstraction reach AWS Bedrock? */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.LLM_EXTRACT_PROVIDER = "bedrock";
process.env.LLM_EXTRACT_MODEL = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

const { getModel } = await import("../../lib/ai/llm.ts");
const model = getModel("extract");
console.log(`  provider routed to: ${model.constructor.name}`);
console.log(`  region: ${process.env.BEDROCK_REGION || process.env.AWS_REGION}`);

const res = await model.invoke(
  'Extract the flight as JSON with keys carrier, number, from, to. ' +
  'Text: "Your Emirates flight EK582 departs Dubai (DXB) 18:35 arriving London Heathrow (LHR) 21:10." ' +
  'Return ONLY JSON.'
);
console.log(`\n  Bedrock replied:\n  ${String(res.content).trim().replace(/\n/g, "\n  ")}`);
