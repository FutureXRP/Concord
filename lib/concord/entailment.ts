/**
 * Gate 3 entailment verification (spec §10, Gate 3).
 *
 * A separate model call with ONLY the claim and its cited chunk. No
 * conversation history. No study context. No access to the original query.
 * Runs on whichever provider is configured (hosted fast model, or the same
 * local model). Fails closed: an unparseable verdict never renders.
 */

import { getLLMProvider } from "./llm";
import type { EntailmentChecker, EntailmentVerdict } from "./firewall";

export class ProviderEntailmentChecker implements EntailmentChecker {
  async check(claimText: string, chunkBody: string): Promise<EntailmentVerdict> {
    const provider = getLLMProvider();
    if (!provider) return "UNSUPPORTED"; // fail closed; unreachable in sources mode
    const text = (
      await provider.completeShort(
        `Passage:\n${chunkBody}\n\nStatement:\n${claimText}\n\nIs the statement directly supported by this passage alone?\nAnswer with exactly one word: SUPPORTED, PARTIAL, or UNSUPPORTED.`,
      )
    ).toUpperCase();
    if (text.includes("UNSUPPORTED")) return "UNSUPPORTED";
    if (text.includes("PARTIAL")) return "PARTIAL";
    if (text.includes("SUPPORTED")) return "SUPPORTED";
    return "UNSUPPORTED";
  }
}

/** Entailment runs whenever a model is configured; CONCORD_ENTAILMENT=0 disables. */
export function getEntailmentChecker(): EntailmentChecker | undefined {
  if (process.env.CONCORD_ENTAILMENT === "0") return undefined;
  if (!getLLMProvider()) return undefined;
  return new ProviderEntailmentChecker();
}
