/**
 * Gate 3 entailment verification (spec §10, Gate 3). Phase 2.
 *
 * A separate Claude call with ONLY the claim and its cited chunk. No
 * conversation history. No study context. No access to the original query.
 * Batched, on a fast model - this is the cost center; budget for it and do
 * not optimize it away.
 */

import { getAnthropic } from "./generate";
import type { EntailmentChecker, EntailmentVerdict } from "./firewall";

const ENTAILMENT_MODEL = "claude-haiku-4-5";

export class ClaudeEntailmentChecker implements EntailmentChecker {
  async check(claimText: string, chunkBody: string): Promise<EntailmentVerdict> {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: ENTAILMENT_MODEL,
      max_tokens: 8,
      messages: [
        {
          role: "user",
          content: `Passage:\n${chunkBody}\n\nStatement:\n${claimText}\n\nIs the statement directly supported by this passage alone?\nAnswer with exactly one word: SUPPORTED, PARTIAL, or UNSUPPORTED.`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .toUpperCase();
    if (text.includes("UNSUPPORTED")) return "UNSUPPORTED";
    if (text.includes("PARTIAL")) return "PARTIAL";
    if (text.includes("SUPPORTED")) return "SUPPORTED";
    // Unparseable verdict: fail closed. A claim never renders on an
    // ambiguous entailment result.
    return "UNSUPPORTED";
  }
}

/** Entailment is enabled by env flag until Phase 2 makes it unconditional. */
export function getEntailmentChecker(): EntailmentChecker | undefined {
  if (process.env.CONCORD_ENTAILMENT === "0") return undefined;
  if (process.env.ANTHROPIC_API_KEY) return new ClaudeEntailmentChecker();
  return undefined;
}
