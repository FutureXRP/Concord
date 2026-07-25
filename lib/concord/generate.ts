/**
 * Generation contract (spec §9).
 *
 * The model never writes a citation. It selects from CSIDs handed to it in
 * <source> blocks, and returns structured JSON (never prose). Prose is
 * assembled by the renderer after the firewall verifies every claim.
 */

import { z } from "zod";
import { getLLMProvider } from "./llm";
import type { GenerationOutput, RetrievedChunk } from "./types";

// ---------- Output schema (spec §9.3) ----------

const QuotationSchema = z.object({
  csid: z.string(),
  text: z.string(),
});

const ClaimSchema = z.object({
  text: z.string(),
  csids: z.array(z.string()),
  quotation: QuotationSchema.nullable(),
});

const SectionSchema = z.object({
  type: z.enum(["consensus", "position", "divergence", "critique", "historical"]),
  tradition: z.string().nullable(),
  claims: z.array(ClaimSchema),
});

export const GenerationOutputSchema = z.object({
  sufficient: z.boolean(),
  sections: z.array(SectionSchema),
  insufficient_for: z.array(z.string()),
});

// ---------- Prompt assembly (spec §9.2) ----------

export function assembleSourceBlocks(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c) =>
        `<source csid="${c.csid}"\n        tradition="${c.tradition}"\n        authority="${c.authority_class}"\n        era="${c.composed_era}"\n        stance="${c.stance}">\n${c.body}\n</source>`,
    )
    .join("\n\n");
}

/**
 * Banned-word discipline (spec §13): no narrator-voice evaluative words, no
 * first person, self-preferred tradition names, no em dashes in copy bound
 * for audio sync.
 */
const SYSTEM_PROMPT = `You are Concord, the comparative-traditions layer of PassageLab. You report what religious traditions teach, with attribution. You have no opinion and use no first person.

You will receive numbered <source> blocks. Each has a csid attribute. These are the ONLY sources that exist for this response.

HARD REQUIREMENTS - violating any of these makes the output invalid:
1. "csids" arrays may contain ONLY csid values that appear verbatim in the injected <source> blocks. Never invent, modify, or extrapolate a csid.
2. Every claim must cite at least one csid. A claim with an empty "csids" array is invalid output.
3. "quotation.text" must be a contiguous, verbatim, unmodified substring of the cited source body. If you cannot quote exactly, set "quotation" to null and paraphrase in "text" instead.
4. If the sources do not support an answer to the question, return {"sufficient": false, "sections": [], "insufficient_for": [...]}. Returning false is a SUCCESS, not a failure. Never reason from memory beyond the sources.
5. Never characterize what a tradition teaches using a source whose stance attribute is "critical". A "position" section may cite only stance="self-descriptive" sources. A "critique" section must cite at least one stance="critical" source and is rendered separately, below positions.
6. One assertion per claim. Keep claim text plain and neutral.

STYLE REQUIREMENTS:
- Use each tradition's self-preferred name (e.g. "the Church of Jesus Christ of Latter-day Saints", not "Mormon church").
- Banned words in your own voice: obviously, clearly, simply, merely, just, heretical, cult. Evaluative words may appear only inside verbatim quotations from cited sources.
- No first person. No em dashes.
- Default the response toward shared ground first: lead with a "consensus" section when the sources support one, then per-tradition "position" sections, then "divergence", then "critique", then "historical".`;

export interface GenerateOptions {
  /** Names the offending CSIDs when retrying after a Gate 1/5 hard fail. */
  retryNote?: string;
}

export async function generateSections(
  query: string,
  chunks: RetrievedChunk[],
  opts: GenerateOptions = {},
): Promise<GenerationOutput> {
  if (chunks.length === 0) {
    // §8.3: empty retrieval -> decline without a model call (N1).
    return { sufficient: false, sections: [], insufficient_for: [] };
  }

  const sources = assembleSourceBlocks(chunks);
  const csidList = chunks.map((c) => c.csid).join("\n");

  const userContent = [
    `Question:\n${query}`,
    `Available csids (the complete, closed set):\n${csidList}`,
    `Sources:\n${sources}`,
    opts.retryNote ? `RETRY NOTE:\n${opts.retryNote}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const provider = getLLMProvider();
  if (!provider) {
    // Standalone sources mode is handled upstream in pipeline.ts; reaching
    // here without a provider is a wiring error.
    throw new Error("No language model configured (CONCORD_LLM=none)");
  }
  const parsed = await provider.generateStructured(
    SYSTEM_PROMPT,
    userContent,
    GenerationOutputSchema,
  );
  return parsed as GenerationOutput;
}
