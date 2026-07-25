/**
 * GET /api/concord/find?q=<free text>
 *
 * Discovery layer: "what passage should I study?" answered deterministically —
 * BM25 over the 31,102-verse KJV corpus, contiguous hits merged into passage
 * suggestions, plus the extra-biblical sayings check ("God helps those who
 * help themselves" → verdict + documented origin + nearest real verses).
 * No LLM, no external API: every query costs nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { preflightReferences } from "@/lib/concord/canon";
import { localSparseSearch, localGetChunk } from "@/lib/concord/localstore";
import { suggestPassages } from "@/lib/concord/discover";
import { matchSaying, matchDoctrine } from "@/lib/concord/curated";
import { corsHeaders, preflightResponse } from "@/lib/concord/cors";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 3) {
    return NextResponse.json({ error: "query too short" }, { status: 400, headers: cors });
  }

  // 1. A saying? Answer the real question ("is that in the Bible?") first.
  const saying = matchSaying(q);
  const sayingOut = saying
    ? {
        saying: saying.saying,
        verdict: saying.verdict,
        origin: saying.origin,
        nearest: saying.nearest
          .map((refNorm) => {
            const chunk = localGetChunk(`scripture:kjv:${refNorm}`);
            return chunk ? { refNorm, text: chunk.body_norm } : null;
          })
          .filter(Boolean),
      }
    : null;

  // 2. Direct references typed into the query resolve immediately.
  const pre = preflightReferences(q);
  const direct = pre.valid.map((r) => ({
    label:
      `${r.bookName} ${r.chapter}` +
      (r.verse !== null ? `:${r.verse}` : "") +
      (r.endVerse !== null ? `-${r.endVerse}` : ""),
    reason: "You referenced this passage directly.",
  }));

  // 3. BM25 over the corpus; scripture hits merge into passage suggestions.
  const hits = localSparseSearch(q, 80);
  const passages = suggestPassages(hits, 6);

  // 4. A doctrine alias signals the comparative question — point the user at
  //    the free Across Traditions tab of whichever passage they pick.
  const doctrine = matchDoctrine(q);

  return NextResponse.json(
    {
      query: q,
      saying: sayingOut,
      direct,
      invalid: pre.invalid,
      passages,
      doctrineLabel: doctrine?.label ?? null,
    },
    { headers: { ...cors, "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
