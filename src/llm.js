import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "./config.js";

let claude, grok;

/**
 * Ask the selected AI for JSON that matches `schema`.
 * `context` is the large shared part (transcript), `task` is the agent-specific instruction.
 */
export async function generateJSON({ name, system, context, task, schema, mock }) {
  if (config.provider === "mock") return mock();
  if (config.provider === "grok") return grokJSON({ name, system, context, task, schema });
  return claudeJSON({ system, context, task, schema });
}

async function claudeJSON({ system, context, task, schema }) {
  claude ??= new Anthropic();
  const stream = claude.beta.messages.stream({
    model: config.claudeModel,
    max_tokens: 64000,
    // If a safety classifier declines, the API retries on a recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: config.claudeEffort,
      format: { type: "json_schema", schema },
    },
    // Transcript is identical for every agent, so cache it.
    system: [{ type: "text", text: `${system}\n\n${context}`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: task }],
  });
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (err) {
    if (/authentication/i.test(err.message)) {
      throw new Error("No Claude API key. Add ANTHROPIC_API_KEY to the .env file (get one at console.anthropic.com).");
    }
    throw err;
  }
  if (msg.stop_reason === "refusal") {
    throw new Error(`Claude declined this request (${msg.stop_details?.category ?? "no category"}).`);
  }
  if (msg.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

async function grokJSON({ name, system, context, task, schema }) {
  if (!process.env.XAI_API_KEY) throw new Error("AI_PROVIDER=grok but XAI_API_KEY is not set in .env");
  grok ??= new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
  const res = await grok.chat.completions.create({
    model: config.grokModel,
    messages: [
      { role: "system", content: `${system}\n\n${context}` },
      { role: "user", content: task },
    ],
    response_format: { type: "json_schema", json_schema: { name, schema, strict: true } },
  });
  return JSON.parse(res.choices[0].message.content);
}
