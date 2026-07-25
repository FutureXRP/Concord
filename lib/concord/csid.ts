/**
 * Canonical Source ID (CSID) — the atom of the citation guarantee (spec §4).
 *
 * Grammar: csid := <domain> ":" <namespace> ":" <work> ":" <locator>
 * Invariants: immutable, lowercase, ASCII, colon-delimited, no spaces.
 */

import type { ParsedCSID, ResolvedCSID } from "./types";
import { getSupabase } from "../supabase/client";
import { isLocalMode, localGetChunk, localGetWork } from "./localstore";

/** Domains with their minimum segment counts (domain segment included). */
const DOMAIN_ARITY: Record<string, number> = {
  scripture: 4, // scripture:{translation}:{book}:{ch}.{v}
  father: 4, // father:{author}:{work}:{locator}
  council: 4, // council:{council}:{instrument}:{locator}
  confession: 3, // confession:{document}:{locator}
  magisterium: 3, // magisterium:{document}:{locator}
  systematic: 4, // systematic:{author}:{work}:{locator}
  rabbinic: 3, // rabbinic:{work}:{locator}
  nrm: 4, // nrm:{tradition}:{work}:{locator}
  quran: 3, // quran:{translation}:{surah}.{ayah}
  lexicon: 3, // lexicon:{resource}:{entry}
  scholarly: 4,
  critique: 4,
};

const SEGMENT_RE = /^[a-z0-9][a-z0-9.\-]*$/;

export function isValidCSID(csid: string): boolean {
  if (csid !== csid.toLowerCase()) return false;
  // eslint-disable-next-line no-control-regex
  if (!/^[\x21-\x7e]+$/.test(csid)) return false; // printable ASCII, no spaces
  const parts = csid.split(":");
  if (parts.length < 3) return false;
  const arity = DOMAIN_ARITY[parts[0]];
  if (arity === undefined) return false;
  if (parts.length < arity) return false;
  return parts.every((p) => SEGMENT_RE.test(p));
}

export function parseCSID(csid: string): ParsedCSID | null {
  if (!isValidCSID(csid)) return null;
  const parts = csid.split(":");
  return { raw: csid, domain: parts[0], parts };
}

/** The work id is every segment except the final locator. */
export function workIdOf(csid: string): string {
  const parts = csid.split(":");
  return parts.slice(0, -1).join(":");
}

export function locatorOf(csid: string): string {
  const parts = csid.split(":");
  return parts[parts.length - 1];
}

/**
 * Resolve a CSID to stored text or an explicit Tier C/D handle (spec §4.3).
 * A CSID that does not resolve is a build-breaking error at ingest and an
 * alert-firing error at render (Gate 6).
 */
export async function resolveCSID(csid: string): Promise<ResolvedCSID> {
  if (!isValidCSID(csid)) {
    return { kind: "unresolved", csid, reason: "malformed CSID" };
  }

  if (isLocalMode()) {
    const chunk = localGetChunk(csid);
    if (chunk) {
      const work = localGetWork(chunk.work_id);
      if (!work) return { kind: "unresolved", csid, reason: "chunk found but work record missing" };
      return { kind: "chunk", chunk, work };
    }
    return { kind: "unresolved", csid, reason: "not in the local corpus" };
  }

  const supabase = getSupabase();

  const { data: chunk, error } = await supabase
    .from("concord_chunks")
    .select("*")
    .eq("csid", csid)
    .maybeSingle();

  if (error) {
    return { kind: "unresolved", csid, reason: `lookup failed: ${error.message}` };
  }

  if (chunk) {
    const { data: work } = await supabase
      .from("concord_works")
      .select("*")
      .eq("id", chunk.work_id)
      .maybeSingle();
    if (!work) {
      return { kind: "unresolved", csid, reason: "chunk found but work record missing" };
    }
    return { kind: "chunk", chunk, work };
  }

  // No stored chunk: check for a Tier C (proxy) or Tier D (describe-only)
  // work handle covering this CSID.
  const workId = workIdOf(csid);
  const { data: work } = await supabase
    .from("concord_works")
    .select("*")
    .eq("id", workId)
    .maybeSingle();

  if (work?.license_tier === "C") {
    const parsed = parseCSID(csid)!;
    if (parsed.domain === "scripture") {
      // scripture:{translation}:{book}:{ch}.{v} -> proxy handle
      return {
        kind: "proxy",
        csid,
        translation: parsed.parts[1],
        refNorm: `${parsed.parts[2]}:${parsed.parts[3]}`,
      };
    }
    return { kind: "proxy", csid, translation: workId, refNorm: locatorOf(csid) };
  }

  if (work?.license_tier === "D") {
    return {
      kind: "describe-only",
      csid,
      note: work.license_note ?? "Tier D: described via secondary scholarly sources only; primary text never quoted.",
    };
  }

  return { kind: "unresolved", csid, reason: "no chunk or tier C/D handle found" };
}
