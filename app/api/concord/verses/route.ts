/**
 * GET /api/concord/verses?ref=<free-text reference>
 *
 * Deterministic verse-text endpoint backing the Trust Layer's tappable
 * reference chips. The reference is parsed and validated by the same pure
 * canon code that powers Concord preflight (no LLM, no external API), then
 * the KJV text is served verbatim from the local corpus. A reference that
 * fails validation returns the precise deterministic reason ("John 3 has 36
 * verses; verse 99 does not exist") so the client can surface it.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateReference, expandRefToVerses } from "@/lib/concord/canon";
import { localGetChunk } from "@/lib/concord/localstore";
import { corsHeaders, preflightResponse } from "@/lib/concord/cors";

export const runtime = "nodejs";

const MAX_VERSES = 10;

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  if (!ref) {
    return NextResponse.json({ error: "ref required" }, { status: 400, headers: cors });
  }

  const v = validateReference(ref);
  if (!v.ok) {
    const bad = v as Extract<typeof v, { ok: false }>;
    return NextResponse.json(
      { ok: false, reason: bad.reason },
      { status: 200, headers: cors },
    );
  }

  const label =
    `${v.ref.bookName} ${v.ref.chapter}` +
    (v.ref.verse !== null ? `:${v.ref.verse}` : "") +
    (v.ref.endVerse !== null
      ? `-${v.ref.endChapter && v.ref.endChapter !== v.ref.chapter ? v.ref.endChapter + ":" : ""}${v.ref.endVerse}`
      : v.ref.verse === null && v.ref.endChapter !== null
        ? `-${v.ref.endChapter}`
        : "");

  const all = expandRefToVerses(v.ref);
  const verses: Array<{ refNorm: string; verse: string; text: string }> = [];
  for (const vn of all.slice(0, MAX_VERSES)) {
    const chunk = localGetChunk(`scripture:kjv:${vn}`);
    if (!chunk) continue;
    const [, cv] = vn.split(":");
    verses.push({ refNorm: vn, verse: cv.replace(".", ":"), text: chunk.body_norm });
  }

  return NextResponse.json(
    {
      ok: true,
      label,
      refNorm: v.ref.refNorm,
      canonNote: v.canonNote ?? null,
      verses,
      truncated: all.length > MAX_VERSES ? all.length - MAX_VERSES : 0,
    },
    { headers: { ...cors, "Cache-Control": "public, max-age=86400, s-maxage=86400" } },
  );
}
