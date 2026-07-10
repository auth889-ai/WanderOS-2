import { HumanMessage, SystemMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { getModel } from "@/lib/ai/llm";
import { invokeStructured } from "@/lib/ai/structured";
import { pricingTools, pricingToolMap } from "./tools";
import { PRICING_SYSTEM_PROMPT, buildPricingTask, buildPricingFinalPrompt } from "./prompt";
import { PricingSchema, Pricing, PricingInput } from "./schema";

/**
 * pricing-analyst agent — a TRUE action-taking (tool-calling) agent.
 *
 * The LLM is given comp-search tools and DECIDES which to call: it searches same-category comps,
 * observes the result, and if there are too few it calls broadenSearch itself — a real ReAct loop.
 * Once it has enough real data it stops acting, and a final structured pass produces the grounded
 * price (cited comp ids + confidence). Uses the "reasoning" tier (OpenAI — reliable tool-calling).
 */
export async function pricingAnalyst(input: PricingInput): Promise<Pricing> {
  const model = getModel("reasoning").bindTools!(pricingTools);
  const messages: BaseMessage[] = [new SystemMessage(PRICING_SYSTEM_PROMPT), new HumanMessage(buildPricingTask(input))];

  const gathered: string[] = [];
  // ReAct loop: the LLM chooses and calls tools (internal comps + external intel) until done (max 6 steps)
  for (let step = 0; step < 6; step++) {
    const res = await model.invoke(messages);
    messages.push(res);
    const toolCalls = res.tool_calls ?? [];
    if (toolCalls.length === 0) break; // the agent decided it's done acting

    for (const call of toolCalls) {
      const t = pricingToolMap[call.name] as { invoke: (a: unknown) => Promise<unknown> } | undefined;
      const out = t ? await t.invoke(call.args) : `unknown tool: ${call.name}`;
      gathered.push(`${call.name}(${JSON.stringify(call.args)}) -> ${out}`);
      messages.push(new ToolMessage({ content: String(out), tool_call_id: call.id ?? call.name }));
    }
  }

  const agentNotes = messages
    .filter((m) => m.getType() === "ai")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n")
    .slice(0, 800);

  // final structured pass → grounded Pricing. Gemini "pro" is more reliable than gpt-4o-mini at
  // emitting the full strict schema from a long tool-gathered context (OpenAI did the tool loop).
  return invokeStructured(PricingSchema, buildPricingFinalPrompt(input, gathered.join("\n\n"), agentNotes), {
    tier: "pro"
  });
}
