/**
 * Deterministic scripture reference extraction and validation (spec §9.1).
 *
 * Per project convention: the LLM handles language only. Reference validity,
 * canon membership, and verse existence are all deterministic code, backed by
 * data/canon/books.json (the single source of truth for abbreviations) and
 * data/canon/verse-counts.json (every real verse). The concord_canon table is
 * seeded from the same data (scripts/build-canon.ts) for SQL-side checks.
 */

import booksData from "../../data/canon/books.json";
import verseCounts from "../../data/canon/verse-counts.json";
import type { CanonSet, RefValidation, ScriptureRef } from "./types";

interface BookEntry {
  id: string;
  name: string;
  order: number;
  canon_set: string[];
  aliases: string[];
  chapters: number | null;
}

const CANONICAL: BookEntry[] = (booksData as { books: BookEntry[] }).books;
const DEUTERO: BookEntry[] = (booksData as { deuterocanon: BookEntry[] }).deuterocanon;
const COUNTS: Record<string, number[]> = verseCounts as Record<string, number[]>;

const aliasIndex = new Map<string, BookEntry>();
for (const b of [...CANONICAL, ...DEUTERO]) {
  for (const a of b.aliases) aliasIndex.set(a, b);
}

// Aliases sorted longest-first so "song of solomon" wins over "song".
const ALIASES_BY_LENGTH = [...aliasIndex.keys()].sort((a, b) => b.length - a.length);
const ALIAS_PATTERN = ALIASES_BY_LENGTH.map((a) =>
  a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ .]?"),
).join("|");

// book (from alias table) + chapter[:verse[-end]] with common separators.
const REF_RE = new RegExp(
  `\\b(${ALIAS_PATTERN})\\.?\\s+(\\d{1,3})(?:\\s*[:.]\\s*(\\d{1,3}))?(?:\\s*[-–—]\\s*(?:(\\d{1,3})\\s*[:.]\\s*)?(\\d{1,3}))?`,
  "gi",
);

const normAlias = (s: string) =>
  s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();

export function lookupBook(nameOrAlias: string): BookEntry | null {
  return aliasIndex.get(normAlias(nameOrAlias)) ?? null;
}

/**
 * Comma-continued verse lists: "John 3:16,18" / "John 3:16, 18". The
 * lookahead only refuses a chapter:verse continuation ("John 3:16, 4:2"),
 * not a sentence period after the verse number.
 */
const COMMA_VERSE_RE = /^\s*,\s*(\d{1,3})(?!\s*[:.]\s*\d)/;

/**
 * Extract every scripture-reference-shaped span from free text.
 * Extraction is permissive; validation (below) is strict.
 *
 * Shapes: "John 3:16" · "Rom. 3:21-26" · "1 Cor 15:3" · "John 3:16,18"
 * (comma verse lists) · "John 3-4" (chapter ranges, endChapter set with
 * verse null) · semicolon lists fall out of global matching.
 */
export function extractReferences(text: string): Array<{
  match: string;
  book: BookEntry;
  chapter: number;
  verse: number | null;
  endChapter: number | null;
  endVerse: number | null;
}> {
  const out = [];
  for (const m of text.matchAll(REF_RE)) {
    const book = lookupBook(m[1]);
    if (!book) continue;
    const chapter = parseInt(m[2], 10);
    const verse = m[3] ? parseInt(m[3], 10) : null;
    let endChapter = m[4] ? parseInt(m[4], 10) : null;
    let endVerse = m[5] ? parseInt(m[5], 10) : null;

    if (verse === null && endVerse !== null && endChapter === null) {
      // "John 3-4": a chapter range, not a verse range.
      endChapter = endVerse;
      endVerse = null;
    }

    out.push({ match: m[0].trim(), book, chapter, verse, endChapter, endVerse });

    // Comma-continued single verses share the book and chapter.
    if (verse !== null) {
      let rest = text.slice((m.index ?? 0) + m[0].length);
      let cm;
      while ((cm = rest.match(COMMA_VERSE_RE)) !== null) {
        const v = parseInt(cm[1], 10);
        out.push({
          match: `${book.name} ${chapter}:${v}`,
          book,
          chapter,
          verse: v,
          endChapter: null,
          endVerse: null,
        });
        rest = rest.slice(cm[0].length);
      }
    }
  }
  return out;
}

function verseExists(bookId: string, chapter: number, verse: number): boolean {
  const chapters = COUNTS[bookId];
  if (!chapters) return false;
  if (chapter < 1 || chapter > chapters.length) return false;
  return verse >= 1 && verse <= chapters[chapter - 1];
}

/**
 * Validate one extracted reference. A ref that does not exist (John 3:99,
 * 2 Hezekiah 4:1) is rejected before retrieval with a precise message —
 * this alone kills a large class of fabrication (spec §9.1.2).
 */
export function validateReference(input: string): RefValidation {
  const refs = extractReferences(input);
  if (refs.length === 0) {
    return { ok: false, input, reason: `"${input}" is not a recognizable scripture reference. No book by that name exists in any canon Concord indexes.` };
  }
  const r = refs[0];
  const { book } = r;

  // Canon-set awareness (spec §9.1.3): deuterocanonical books are recognized,
  // never silently failed.
  const isDeutero = book.chapters === null;
  const canonNote = !book.canon_set.includes("protestant")
    ? `${book.name} is part of the ${book.canon_set.join("/")} canon only.`
    : null;

  if (isDeutero) {
    return {
      ok: true,
      ref: {
        refNorm: `${book.id}:${r.chapter}${r.verse ? "." + r.verse : ""}`,
        bookId: book.id,
        bookName: book.name,
        chapter: r.chapter,
        verse: r.verse,
        endChapter: r.endChapter,
        endVerse: r.endVerse,
        canonSets: book.canon_set as CanonSet[],
      },
      canonNote:
        (canonNote ?? "") +
        ` Verse-level validation for ${book.name} lands with the deuterocanon ingest (Phase 3).`,
    };
  }

  const chapters = COUNTS[book.id];
  if (r.chapter < 1 || r.chapter > chapters.length) {
    return {
      ok: false,
      input,
      reason: `${book.name} has ${chapters.length} chapters; chapter ${r.chapter} does not exist.`,
    };
  }
  // Chapter range ("John 3-4"): both endpoints must exist.
  if (r.verse === null && r.endChapter !== null) {
    if (r.endChapter < r.chapter || r.endChapter > chapters.length) {
      return {
        ok: false,
        input,
        reason: `${book.name} has ${chapters.length} chapters; range end ${r.endChapter} is invalid.`,
      };
    }
  }
  if (r.verse !== null && !verseExists(book.id, r.chapter, r.verse)) {
    return {
      ok: false,
      input,
      reason: `${book.name} ${r.chapter} has ${chapters[r.chapter - 1]} verses; verse ${r.verse} does not exist.`,
    };
  }
  if (r.endChapter !== null && r.endVerse !== null) {
    if (!verseExists(book.id, r.endChapter, r.endVerse)) {
      return {
        ok: false,
        input,
        reason: `Range end ${book.name} ${r.endChapter}:${r.endVerse} does not exist.`,
      };
    }
  } else if (r.endVerse !== null && r.verse !== null) {
    if (!verseExists(book.id, r.chapter, r.endVerse)) {
      return {
        ok: false,
        input,
        reason: `${book.name} ${r.chapter} has ${chapters[r.chapter - 1]} verses; range end ${r.endVerse} does not exist.`,
      };
    }
  }

  const refNorm = buildRefNorm(book.id, r.chapter, r.verse, r.endChapter, r.endVerse);
  return {
    ok: true,
    ref: {
      refNorm,
      bookId: book.id,
      bookName: book.name,
      chapter: r.chapter,
      verse: r.verse,
      endChapter: r.endChapter,
      endVerse: r.endVerse,
      canonSets: book.canon_set as CanonSet[],
    },
    canonNote,
  };
}

export function buildRefNorm(
  bookId: string,
  chapter: number,
  verse: number | null,
  endChapter: number | null,
  endVerse: number | null,
): string {
  let s = `${bookId}:${chapter}`;
  if (verse !== null) s += `.${verse}`;
  if (endVerse !== null) {
    s += `-${endChapter ?? chapter}.${endVerse}`;
  } else if (verse === null && endChapter !== null) {
    s += `-${endChapter}`; // chapter range
  }
  return s;
}

/** Expand a validated ref into every single-verse refNorm it covers. */
export function expandRefToVerses(ref: ScriptureRef): string[] {
  const chapters = COUNTS[ref.bookId];
  if (!chapters) return [ref.refNorm];
  if (ref.verse === null) {
    // Whole chapter, or a chapter range.
    const lastChapter = ref.endChapter ?? ref.chapter;
    const out: string[] = [];
    for (let ch = ref.chapter; ch <= Math.min(lastChapter, chapters.length); ch++) {
      const n = chapters[ch - 1] ?? 0;
      for (let v = 1; v <= n; v++) out.push(`${ref.bookId}:${ch}.${v}`);
    }
    return out;
  }
  const endCh = ref.endVerse !== null ? (ref.endChapter ?? ref.chapter) : ref.chapter;
  const endV = ref.endVerse ?? ref.verse;
  const out: string[] = [];
  for (let ch = ref.chapter; ch <= endCh; ch++) {
    const first = ch === ref.chapter ? ref.verse : 1;
    const last = ch === endCh ? endV : chapters[ch - 1];
    for (let v = first; v <= last; v++) out.push(`${ref.bookId}:${ch}.${v}`);
  }
  return out;
}

/**
 * Anything shaped like "Book 3:16" whose book is NOT in the abbreviation
 * table — catches fabricated books like "2 Hezekiah 4:11" that the
 * alias-driven extractor would (correctly) never match.
 */
const REF_SHAPE_RE =
  /\b((?:[1-4]\s+)?[A-Z][A-Za-z]+(?:\s+of\s+[A-Z][A-Za-z]+)?)\s+(\d{1,3})\s*[:.]\s*(\d{1,3})/g;

/**
 * Pre-flight (spec §9.1): extract and validate every reference in a query.
 * Pure code, no LLM, no network.
 */
export function preflightReferences(query: string): {
  valid: ScriptureRef[];
  invalid: Array<{ input: string; reason: string }>;
  canonNotes: string[];
} {
  const valid: ScriptureRef[] = [];
  const invalid: Array<{ input: string; reason: string }> = [];
  const canonNotes: string[] = [];
  for (const r of extractReferences(query)) {
    const v = validateReference(r.match);
    if (v.ok) {
      valid.push(v.ref);
      if (v.canonNote) canonNotes.push(v.canonNote);
    } else {
      invalid.push({ input: r.match, reason: v.reason });
    }
  }
  // Sweep for reference-shaped spans naming a book that does not exist.
  for (const m of query.matchAll(REF_SHAPE_RE)) {
    const bookPart = m[1];
    if (lookupBook(bookPart)) continue; // handled above
    invalid.push({
      input: m[0],
      reason: `No book named "${bookPart}" exists in any canon Concord indexes (Protestant, Catholic, Orthodox, or Tanakh). This reference cannot be resolved.`,
    });
  }
  return { valid, invalid, canonNotes };
}
