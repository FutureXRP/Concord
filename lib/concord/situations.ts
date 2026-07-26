/**
 * Life-situation matching for the passage finder (Discovery layer).
 *
 * The queries real people type are pastoral, not lexical: "help with
 * scripture to preach a funeral" is about death and comfort, not the word
 * "preach". This module does two deterministic things:
 *
 *  1. matchSituation() — scores the query against a curated index of life
 *     situations (data/curated/situations.json) whose passages are
 *     editorially selected and canon-validated by tests.
 *  2. contentTerms() — strips intent words ("help", "scripture", "preach",
 *     "verses about"…) so the BM25 fallback searches the content of the
 *     request rather than its packaging.
 *
 * Pure code, no LLM, browser-safe.
 */

import situationsData from "../../data/curated/situations.json";

export interface SituationPassage {
  ref: string;
  why: string;
}

export interface Situation {
  id: string;
  label: string;
  match: string[];
  passages: SituationPassage[];
}

export const SITUATIONS: Situation[] = (
  situationsData as { situations: Situation[] }
).situations;

const norm = (s: string) =>
  " " +
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() +
  " ";

/**
 * Words that describe the request rather than its subject. Stripped before
 * BM25 so "help with scripture to preach a funeral" searches "funeral",
 * not "preach".
 */
const META_WORDS = new Set([
  "a", "an", "the", "i", "im", "me", "my", "we", "our", "you", "your",
  "is", "are", "was", "be", "been", "do", "does", "did", "can", "could",
  "will", "would", "should", "need", "needs", "want", "wants", "looking",
  "help", "helps", "give", "show", "find", "get", "with", "for", "to",
  "of", "on", "in", "at", "and", "or", "that", "this", "it", "some",
  "any", "good", "best", "what", "which", "where", "when", "how", "who",
  "scripture", "scriptures", "verse", "verses", "passage", "passages",
  "bible", "biblical", "gods", "word", "text", "texts", "reading",
  "readings", "preach", "preaching", "sermon", "sermons", "teach",
  "teaching", "lesson", "lessons", "study", "studying", "devotional",
  "about", "regarding", "concerning", "says", "say", "said", "am",
]);

export function contentTerms(query: string): string[] {
  return norm(query)
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !META_WORDS.has(w));
}

/**
 * Score every situation against the query: multi-word match phrases count
 * as strong signals (substring match), single words must appear as whole
 * tokens. Highest score wins; ties break toward the longer matched phrase.
 */
export function matchSituation(query: string): Situation | null {
  const q = norm(query);
  const tokens = new Set(q.trim().split(/\s+/));
  let best: { s: Situation; score: number } | null = null;
  for (const s of SITUATIONS) {
    let score = 0;
    for (const phrase of s.match) {
      const p = norm(phrase).trim();
      if (p.includes(" ")) {
        if (q.includes(" " + p + " ")) score += 3 + p.length / 8;
      } else if (tokens.has(p)) {
        score += 2;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { s, score };
  }
  // A single generic one-word hit ("hope", "work") should not hijack a
  // query that is clearly about something else; require either a phrase
  // hit or that the query is short enough to be about that word.
  if (best && best.score < 3 && contentTerms(query).length > 4) return null;
  return best?.s ?? null;
}
