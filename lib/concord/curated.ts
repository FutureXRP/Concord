/**
 * Curated deterministic answers - the zero-cost layer that makes common
 * questions excellent without any model:
 *
 *  - Parallel-doctrine map (data/curated/doctrines.json): for doctrine
 *    queries, each tradition's own confessional locus side by side, with
 *    ecumenical-creed loci as the Shared ground section.
 *  - Extra-biblical sayings (data/curated/sayings.json, spec §14.3):
 *    famous non-verses and misattributions answered with their documented
 *    origin and the scripture they are usually conflated with.
 *
 * The origin note is editorial reference data (like canon notes), rendered
 * as information. Every *claim* still cites resolvable corpus chunks (N2).
 *
 * Pure module: runs identically server-side and in the browser build.
 */

import doctrinesData from "../../data/curated/doctrines.json";
import sayingsData from "../../data/curated/sayings.json";
import { buildSourceClaim, scriptureLabel } from "./sources";
import type {
  FirewallResult,
  RetrievedChunk,
  Tradition,
  VerifiedSection,
} from "./types";

export interface DoctrineLocus {
  tradition: Tradition;
  csids: string[];
}

export interface Doctrine {
  id: string;
  label: string;
  aliases: string[];
  consensus: string[];
  loci: DoctrineLocus[];
}

export interface Saying {
  id: string;
  match: string[];
  saying: string;
  verdict: "not-in-scripture" | "misattributed" | "paraphrase";
  origin: string;
  nearest: string[];
}

export const DOCTRINES: Doctrine[] = (doctrinesData as { doctrines: Doctrine[] }).doctrines;
export const SAYINGS: Saying[] = (sayingsData as { sayings: Saying[] }).sayings;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Longest matching saying wins; substring match over normalized text. */
export function matchSaying(query: string): Saying | null {
  const q = normalize(query);
  let best: { saying: Saying; len: number } | null = null;
  for (const s of SAYINGS) {
    for (const phrase of s.match) {
      const p = normalize(phrase);
      if (q.includes(p) && (!best || p.length > best.len)) {
        best = { saying: s, len: p.length };
      }
    }
  }
  return best?.saying ?? null;
}

/** Longest matching doctrine alias wins. */
export function matchDoctrine(query: string): Doctrine | null {
  const q = ` ${normalize(query)} `;
  let best: { doctrine: Doctrine; len: number } | null = null;
  for (const d of DOCTRINES) {
    for (const alias of d.aliases) {
      const a = normalize(alias);
      if (q.includes(` ${a} `) && (!best || a.length > best.len)) {
        best = { doctrine: d, len: a.length };
      }
    }
  }
  return best?.doctrine ?? null;
}

export type ChunkResolver = (csid: string) => RetrievedChunk | null;

/**
 * Side-by-side doctrine answer: consensus (ecumenical creeds) first, then
 * each tradition's own locus. Deterministic; integrity 1 by construction.
 */
export function buildDoctrineResult(
  doctrine: Doctrine,
  resolve: ChunkResolver,
): FirewallResult | null {
  const sections: VerifiedSection[] = [];

  const consensusChunks = doctrine.consensus
    .map(resolve)
    .filter((c): c is RetrievedChunk => c !== null);
  if (consensusChunks.length > 0) {
    sections.push({
      type: "consensus",
      tradition: null,
      claims: consensusChunks.map((c) =>
        buildSourceClaim(c, `${c.work_title}, ${c.locator}`),
      ),
    });
  }

  for (const locus of doctrine.loci) {
    const chunks = locus.csids
      .map(resolve)
      .filter((c): c is RetrievedChunk => c !== null);
    if (chunks.length === 0) continue;
    sections.push({
      type: "sources",
      tradition: locus.tradition,
      claims: chunks.map((c) => buildSourceClaim(c, `${c.work_title}, ${c.locator}`)),
    });
  }

  if (sections.length === 0) return null;
  return { rendered: sections, stripped: [], regenerations: 0, citationIntegrity: 1 };
}

export interface SayingNote {
  saying: string;
  verdict: Saying["verdict"];
  origin: string;
}

/**
 * Saying answer: the informational note plus a sources section for the
 * scripture the phrase is usually conflated with (real, cited chunks).
 */
export function buildSayingResult(
  saying: Saying,
  resolve: ChunkResolver,
): { note: SayingNote; result: FirewallResult } {
  const nearestChunks = saying.nearest
    .map((ref) => resolve(`scripture:kjv:${ref}`))
    .filter((c): c is RetrievedChunk => c !== null);

  const sections: VerifiedSection[] =
    nearestChunks.length > 0
      ? [
          {
            type: "sources" as const,
            tradition: null,
            claims: nearestChunks.map((c) => buildSourceClaim(c, scriptureLabel(c))),
          },
        ]
      : [];

  return {
    note: { saying: saying.saying, verdict: saying.verdict, origin: saying.origin },
    result: { rendered: sections, stripped: [], regenerations: 0, citationIntegrity: 1 },
  };
}
