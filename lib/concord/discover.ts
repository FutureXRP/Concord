/**
 * Passage discovery — deterministic "find my passage" (Discovery layer).
 *
 * Takes ranked corpus hits from the existing BM25 sparse index, keeps the
 * scripture chunks, and merges verse-level hits into contiguous passage
 * suggestions ("Romans 8:26-28") a user can open as a study. Pure code over
 * retrieved chunks: no LLM, no network, reusable from the Node API route and
 * the browser engine alike.
 */

import { lookupBook } from "./canon";
import type { RetrievedChunk } from "./types";

export interface PassageSuggestion {
  /** Human label, e.g. "Romans 8:26-28" */
  label: string;
  /** Path segment for /study/<studyRef> */
  studyRef: string;
  refNorm: string;
  score: number;
  /** Verbatim KJV text of the strongest verse in the run (trimmed). */
  preview: string;
  verseCount: number;
}

interface VerseHit {
  bookId: string;
  chapter: number;
  verse: number;
  score: number;
  text: string;
}

const PREVIEW_CHARS = 200;

/** Merge verse hits ≤ maxGap apart (same book+chapter) into passage runs. */
export function suggestPassages(
  hits: RetrievedChunk[],
  max = 6,
  maxGap = 2,
): PassageSuggestion[] {
  const verses: VerseHit[] = [];
  for (const h of hits) {
    if (h.authority_class !== "scripture") continue;
    // scripture:kjv:<book>:<ch>.<v>
    const m = h.csid.match(/^scripture:kjv:([a-z0-9]+):(\d+)\.(\d+)$/);
    if (!m) continue;
    verses.push({
      bookId: m[1],
      chapter: parseInt(m[2], 10),
      verse: parseInt(m[3], 10),
      score: h.score,
      text: h.body_norm,
    });
  }
  if (verses.length === 0) return [];

  verses.sort((a, b) =>
    a.bookId !== b.bookId
      ? a.bookId.localeCompare(b.bookId)
      : a.chapter !== b.chapter
        ? a.chapter - b.chapter
        : a.verse - b.verse,
  );

  const runs: VerseHit[][] = [];
  let run: VerseHit[] = [];
  for (const v of verses) {
    const prev = run[run.length - 1];
    if (
      prev &&
      prev.bookId === v.bookId &&
      prev.chapter === v.chapter &&
      v.verse - prev.verse <= maxGap
    ) {
      run.push(v);
    } else {
      if (run.length) runs.push(run);
      run = [v];
    }
  }
  if (run.length) runs.push(run);

  const out: PassageSuggestion[] = runs.map((r) => {
    const first = r[0];
    const last = r[r.length - 1];
    const best = r.reduce((a, b) => (b.score > a.score ? b : a));
    const bookName = lookupBook(first.bookId)?.name ?? first.bookId;
    const span =
      first.verse === last.verse
        ? `${first.chapter}:${first.verse}`
        : `${first.chapter}:${first.verse}-${last.verse}`;
    const label = `${bookName} ${span}`;
    const preview =
      best.text.length > PREVIEW_CHARS
        ? best.text.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, "") + "…"
        : best.text;
    return {
      label,
      studyRef: label,
      refNorm:
        first.verse === last.verse
          ? `${first.bookId}:${first.chapter}.${first.verse}`
          : `${first.bookId}:${first.chapter}.${first.verse}-${first.chapter}.${last.verse}`,
      // Sum rewards runs of several matching verses over one lucky verse.
      score: r.reduce((s, v) => s + v.score, 0),
      preview,
      verseCount: r.length,
    };
  });

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}
