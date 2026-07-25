/**
 * Language-model provider abstraction.
 *
 * Concord's citation guarantee lives in deterministic code (canon.ts,
 * firewall.ts) - the model only turns retrieved sources into neutral prose.
 * That makes the model swappable, including "no model at all":
 *
 *   none      - standalone sources mode. No API, no key, no network.
 *               Retrieval + verbatim excerpts render directly (pipeline.ts).
 *   local     - any OpenAI-compatible local runtime (Ollama, llama.cpp
 *               server, LM Studio). Runs entirely on the user's machine.
 *   anthropic - hosted Claude (optional, best synthesis quality).
 *
 * Selection: CONCORD_LLM=none|local|anthropic wins; otherwise local when
 * CONCORD_LLM_BASE_URL is set, anthropic when ANTHROPIC_API_KEY is set,
 * else none.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export interface LLMProvider {
  kind: "anthropic" | "local";
  /** Generate output conforming to a zod schema. Throws on failure. */
  generateStructured<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
  ): Promise<T>;
  /** Short single-completion call (Gate 3 entailment verdicts). */
  completeShort(prompt: string): Promise<string>;
}

// ---------- Anthropic ----------

const ANTHROPIC_GENERATION_MODEL = "claude-opus-5";
const ANTHROPIC_ENTAILMENT_MODEL = "claude-haiku-4-5";

let _anthropic: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

class AnthropicProvider implements LLMProvider {
  kind = "anthropic" as const;

  async generateStructured<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await getAnthropic().messages.parse({
      model: ANTHROPIC_GENERATION_MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("Generation returned unparseable output");
    return parsed;
  }

  async completeShort(prompt: string): Promise<string> {
    const response = await getAnthropic().messages.create({
      model: ANTHROPIC_ENTAILMENT_MODEL,
      max_tokens: 8,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  }
}

// ---------- Local (OpenAI-compatible: Ollama, llama.cpp, LM Studio) ----------

/** Pull the first JSON object out of a completion (handles code fences). */
export function extractJSON(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

class LocalProvider implements LLMProvider {
  kind = "local" as const;
  constructor(
    private baseUrl: string,
    private model: string,
  ) {}

  private async chat(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, stream: false }),
    });
    if (!res.ok) {
      throw new Error(`local LLM request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  async generateStructured<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const jsonInstruction =
      "\n\nRespond with ONLY a single JSON object matching the required structure. No prose before or after it.";
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = [
        { role: "system", content: system + jsonInstruction },
        {
          role: "user",
          content:
            attempt === 0
              ? user
              : `${user}\n\nYour previous output was invalid (${lastError}). Return ONLY the corrected JSON object.`,
        },
      ];
      const text = await this.chat(messages, 8192);
      try {
        return schema.parse(extractJSON(text));
      } catch (e) {
        lastError = e instanceof Error ? e.message.slice(0, 300) : String(e);
      }
    }
    throw new Error(`local LLM produced invalid structured output: ${lastError}`);
  }

  async completeShort(prompt: string): Promise<string> {
    return (await this.chat([{ role: "user", content: prompt }], 8)).trim();
  }
}

// ---------- Selection ----------

let cached: LLMProvider | null | undefined;

export function getLLMProvider(): LLMProvider | null {
  if (cached !== undefined) return cached;

  const explicit = process.env.CONCORD_LLM;
  const baseUrl = process.env.CONCORD_LLM_BASE_URL;
  const localModel = process.env.CONCORD_LLM_MODEL ?? "llama3.1";

  if (explicit === "none") cached = null;
  else if (explicit === "local") {
    cached = new LocalProvider(baseUrl ?? "http://localhost:11434/v1", localModel);
  } else if (explicit === "anthropic") cached = new AnthropicProvider();
  else if (baseUrl) cached = new LocalProvider(baseUrl, localModel);
  else if (process.env.ANTHROPIC_API_KEY) cached = new AnthropicProvider();
  else cached = null;

  return cached;
}

/** Test seam. */
export function _setLLMProvider(p: LLMProvider | null | undefined): void {
  cached = p;
}
