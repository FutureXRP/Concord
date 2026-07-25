/**
 * Standalone sources mode - the zero-cost answer path.
 *
 * With no model configured, Concord renders the retrieved sources
 * themselves: deterministic labels, verbatim excerpts that pass the same
 * Gate 2 byte-verification a model quotation would, every entry cited.
 * Nothing synthesized, nothing fabricable, no per-query spend.
 *
 * Pure module: used by the server pipeline (pipeline.ts) and the browser
 * engine (browser/engine.ts) that powers the static GitHub Pages build.
 */

import { lookupBook } from "./canon";
import { quoteIsVerbatim } from "./normalize";
import type {
  FirewallResult,
  RetrievedChunk,
  Tradition,
  VerifiedClaim,
  VerifiedSection,
} from "./types";

const EXCERPT_MAX = 550;

/** A leading slice of the chunk body that survives Gate 2 verification. */
function excerptOf(chunk: RetrievedChunk): string {
  let slice = chunk.body;
  if (slice.length > EXCERPT_MAX) {
    const cut = slice.slice(0, EXCERPT_MAX);
    const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(" "));
    slice = cut.slice(0, boundary > 100 ? boundary + 1 : EXCERPT_MAX).trimEnd();
  }
  return quoteIsVerbatim(slice, chunk.body_norm) ? slice : chunk.body;
}

export function scriptureLabel(chunk: RetrievedChunk): string {
  // scripture:{translation}:{book}:{ch}.{v}
  const parts = chunk.csid.split(":");
  const book = lookupBook(parts[2]);
  const [ch, v] = chunk.locator.split(".");
  return `${book?.name ?? parts[2]} ${ch}:${v} (${parts[1].toUpperCase()})`;
}

/** A deterministic, fully cited claim wrapping one source chunk. */
export function buildSourceClaim(chunk: RetrievedChunk, label: string): VerifiedClaim {
  return {
    text: `${label}.`,
    csids: [chunk.csid],
    quotation: { csid: chunk.csid, text: excerptOf(chunk) },
    entailment: "pass",
  };
}

/**
 * Deterministic answer: one "sources" section for scripture, one per
 * tradition for everything else.
 */
export function buildSourcesResult(chunks: RetrievedChunk[]): FirewallResult {
  const toClaim = buildSourceClaim;

  const sections: VerifiedSection[] = [];

  const scripture = chunks.filter((c) => c.authority_class === "scripture");
  if (scripture.length > 0) {
    sections.push({
      type: "sources",
      tradition: null,
      claims: scripture.map((c) => toClaim(c, scriptureLabel(c))),
    });
  }

  const byTradition = new Map<Tradition, RetrievedChunk[]>();
  for (const c of chunks) {
    if (c.authority_class === "scripture") continue;
    const list = byTradition.get(c.tradition);
    if (list) list.push(c);
    else byTradition.set(c.tradition, [c]);
  }
  for (const [tradition, list] of byTradition) {
    sections.push({
      type: "sources",
      tradition,
      claims: list.map((c) => toClaim(c, `${c.work_title}, ${c.locator}`)),
    });
  }

  return {
    rendered: sections,
    stripped: [],
    regenerations: 0,
    // Nothing synthesized, nothing strippable: integrity is 1 by construction.
    citationIntegrity: 1,
  };
}
