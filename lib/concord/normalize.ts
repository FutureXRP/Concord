/**
 * Quotation normalization for Gate 2 byte-verification (spec §10, Gate 2).
 *
 * Rules: collapse whitespace, normalize Unicode quotes and dashes, strip
 * editorial brackets. Nothing else — no case folding on original-language
 * text, no stemming.
 */

const QUOTE_MAP: Record<string, string> = {
  "‘": "'", // left single
  "’": "'", // right single
  "‚": "'",
  "‛": "'",
  "“": '"', // left double
  "”": '"', // right double
  "„": '"',
  "‟": '"',
  "«": '"', // guillemets
  "»": '"',
  "‹": "'",
  "›": "'",
};

const DASH_RE = /[‐‑‒–—―−]/g;

/** Strip editorial brackets and their contents: [1], [sic], [Gr. logos]. */
const EDITORIAL_BRACKETS_RE = /\[[^\]]*\]/g;

export function normalizeQuote(text: string): string {
  let s = text.normalize("NFC");
  s = s.replace(/[‘’‚‛“”„‟«»‹›]/g, (c) => QUOTE_MAP[c] ?? c);
  s = s.replace(DASH_RE, "-");
  s = s.replace(EDITORIAL_BRACKETS_RE, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Gate 2 check: is the quotation a contiguous substring of the source body,
 * after normalization on both sides?
 */
export function quoteIsVerbatim(quotation: string, sourceBodyNorm: string): boolean {
  const q = normalizeQuote(quotation);
  if (q.length === 0) return false;
  return sourceBodyNorm.includes(q);
}

/** Normalization applied at ingest to produce chunks.body_norm. */
export function normalizeBodyForStorage(body: string): string {
  return normalizeQuote(body);
}
