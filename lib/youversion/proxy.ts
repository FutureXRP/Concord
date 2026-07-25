/**
 * YouVersion proxy (spec §3.2). Phase 5 lands the live integration; the
 * rules are enforced in code from day one:
 *
 *  - Fetch on render. No persistence beyond an in-memory request-scoped
 *    cache with an explicit TTL (asserted in tests).
 *  - No verse text in logs, telemetry, error reports, or Supabase rows.
 *    Log references only.
 *  - Attribution ships in the same payload as the text, never separately.
 *  - No modification: no paraphrase, no truncation mid-verse, no emphasis.
 *  - Graceful degradation: proxy failure falls back to public-domain text
 *    with a visible notice. Never fail the study.
 *  - Verify against the actual license terms before ship; these defaults
 *    are defensive.
 */

import { getSupabase } from "../supabase/client";
import { isLocalMode, localGetChunk } from "../concord/localstore";

export const PROXY_CACHE_TTL_MS = 60_000; // request-scoped; asserted in tests

export interface ProxiedVerse {
  refNorm: string;
  translation: string;
  text: string;
  /** Copyright line + publisher attribution. Renders WITH the text. */
  attribution: string;
  /** True when the proxy failed and public-domain text was substituted. */
  degraded: boolean;
  degradationNotice: string | null;
}

interface CacheEntry {
  verse: ProxiedVerse;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Exposed for the TTL assertion test only. */
export function _cacheSize(): number {
  sweepExpired();
  return cache.size;
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

/**
 * Fetch a verse in the user's chosen translation. Copyrighted translations
 * are proxied live (Tier C); reasoning always happens over public-domain
 * text upstream of this call - this is a display preference at the last
 * mile (spec §3.1).
 */
export async function fetchVerse(
  refNorm: string,
  translation: string,
): Promise<ProxiedVerse> {
  sweepExpired();
  const key = `${translation}:${refNorm}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.verse;

  let verse: ProxiedVerse;
  const apiKey = process.env.YOUVERSION_API_KEY;
  if (!apiKey) {
    verse = await publicDomainFallback(
      refNorm,
      translation,
      "Modern translation display is not yet enabled. Showing the World English Bible (public domain).",
    );
  } else {
    try {
      verse = await fetchFromYouVersion(refNorm, translation, apiKey);
    } catch {
      // Availability degradation is graceful. Never fail the study.
      // Note: the error is not logged with any verse text - references only.
      console.warn(`[youversion] proxy fetch failed for ref ${refNorm} (${translation})`);
      verse = await publicDomainFallback(
        refNorm,
        translation,
        `The ${translation.toUpperCase()} text is temporarily unavailable. Showing the World English Bible (public domain).`,
      );
    }
  }

  cache.set(key, { verse, expiresAt: Date.now() + PROXY_CACHE_TTL_MS });
  return verse;
}

async function fetchFromYouVersion(
  refNorm: string,
  translation: string,
  _apiKey: string,
): Promise<ProxiedVerse> {
  // Phase 5: implement against the YouVersion partner API once license
  // terms are verified. Until then this path is unreachable in production
  // because YOUVERSION_API_KEY is unset.
  throw new Error(`YouVersion integration lands in Phase 5 (ref ${refNorm}, ${translation})`);
}

async function publicDomainFallback(
  refNorm: string,
  _requestedTranslation: string,
  notice: string,
): Promise<ProxiedVerse> {
  if (isLocalMode()) {
    const chunk = localGetChunk(`scripture:kjv:${refNorm}`);
    return {
      refNorm,
      translation: "kjv",
      text: chunk?.body ?? "",
      attribution: "King James Version (KJV). Public domain.",
      degraded: true,
      degradationNotice: notice,
    };
  }

  const supabase = getSupabase();
  const csid = `scripture:web:${refNorm}`;
  const { data } = await supabase
    .from("concord_chunks")
    .select("body")
    .eq("csid", csid)
    .maybeSingle();

  return {
    refNorm,
    translation: "web",
    text: data?.body ?? "",
    attribution: "World English Bible (WEB). Public domain.",
    degraded: true,
    degradationNotice: notice,
  };
}
