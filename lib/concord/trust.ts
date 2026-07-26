/**
 * Trust Layer core — deterministic reference scanning for generated prose.
 *
 * Pure code over the canon tables (no LLM, no network, browser-safe):
 * locate reference-shaped spans in a string, validate each against the
 * verse-count data, and report exact span positions so the UI can turn
 * real references into tappable chips and flag fabricated ones inline.
 */

import { extractReferences, validateReference } from "./canon";
import type { RefValidation } from "./types";

export interface ScannedRef {
  match: string;
  start: number;
  end: number;
  ok: boolean;
  reason?: string;
  canonNote?: string | null;
}

/**
 * Generated study text capitalizes real references ("Romans 3:21",
 * "1 Cor 15:3"), so spans whose book token starts lowercase are ignored —
 * that single rule removes false positives from ordinary words that double
 * as book aliases ("mark 2 things", "his job 1").
 */
export function scanRefs(text: string): ScannedRef[] {
  if (!text || text.length < 6) return [];
  const out: ScannedRef[] = [];
  let cursor = 0;
  for (const r of extractReferences(text)) {
    const idx = text.indexOf(r.match, cursor);
    if (idx === -1) continue; // synthesized comma-continuation entries
    cursor = idx + r.match.length;
    if (!/^[0-9A-Z]/.test(r.match)) continue;
    const v = validateReference(r.match);
    // tsconfig here is strict:false, which breaks discriminated-union
    // narrowing — the explicit Extract cast recovers the failure branch.
    const bad = v.ok ? null : (v as Extract<RefValidation, { ok: false }>);
    out.push({
      match: r.match,
      start: idx,
      end: idx + r.match.length,
      ok: v.ok,
      reason: bad ? bad.reason : undefined,
      canonNote: v.ok ? (v.canonNote ?? null) : null,
    });
  }
  return out;
}
