/**
 * GET /api/concord/resolve?csid=...
 *
 * Gate 6 (spec §10): every rendered citation chip performs a live
 * resolveCSID() on click. A CSID reaching render without resolving is an
 * alert-worthy event - it should never happen; instrument it so we know
 * if it ever does.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveCSID } from "@/lib/concord/csid";
import { corsHeaders, preflightResponse } from "@/lib/concord/cors";
import { isLocalMode, localCitedBy, localGetChunk } from "@/lib/concord/localstore";
import { fetchVerse } from "@/lib/youversion/proxy";

const CITED_BY_MAX = 12;

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  const csid = req.nextUrl.searchParams.get("csid");
  const translation = req.nextUrl.searchParams.get("translation");
  if (!csid) {
    return NextResponse.json({ error: "csid is required" }, { status: 400, headers: cors });
  }

  const resolved = await resolveCSID(csid);

  switch (resolved.kind) {
    case "chunk": {
      // Scripture chips may re-render through the proxy in the user's chosen
      // translation (display preference; reasoning stays on public domain).
      let proxied = null;
      if (translation && resolved.work.id.startsWith("scripture:")) {
        const refNorm = `${resolved.chunk.csid.split(":")[2]}:${resolved.chunk.locator}`;
        proxied = await fetchVerse(refNorm, translation);
      }
      // "Rests on" / "Cited by" chip rows (local corpus mode).
      let restsOn: string[] | undefined;
      let citedBy: Array<{ csid: string; label: string }> | undefined;
      if (isLocalMode()) {
        const isScripture = resolved.work.authority_class === "scripture";
        if (isScripture) {
          citedBy = localCitedBy(resolved.chunk.scripture_refs)
            .slice(0, CITED_BY_MAX)
            .map((c) => ({ csid: c.csid, label: `${c.work_title}, ${c.locator}` }));
        } else {
          restsOn = resolved.chunk.scripture_refs
            .map((ref: string) => `scripture:kjv:${ref.split("-")[0]}`)
            .filter((c: string) => localGetChunk(c) !== null)
            .slice(0, CITED_BY_MAX);
        }
      }
      return NextResponse.json(
        {
        kind: "chunk",
        csid,
        restsOn,
        citedBy,
        body: proxied?.text || resolved.chunk.body,
        locator: resolved.chunk.locator,
        work: {
          id: resolved.work.id,
          title: resolved.work.title,
          author: resolved.work.author,
          translator: resolved.work.translator,
          composed_era: resolved.work.composed_era,
          composed_year: resolved.work.composed_year,
          tradition: resolved.work.tradition,
          authority_class: resolved.work.authority_class,
          license_tier: resolved.work.license_tier,
          source_url: resolved.work.source_url,
        },
        attribution: proxied?.attribution ?? null,
        degradationNotice: proxied?.degradationNotice ?? null,
        },
        { headers: cors },
      );
    }
    case "proxy": {
      const verse = await fetchVerse(resolved.refNorm, resolved.translation);
      return NextResponse.json(
        {
          kind: "proxy",
          csid,
          body: verse.text,
          attribution: verse.attribution,
          degradationNotice: verse.degradationNotice,
        },
        { headers: cors },
      );
    }
    case "describe-only":
      return NextResponse.json(
        { kind: "describe-only", csid, note: resolved.note },
        { headers: cors },
      );
    case "unresolved":
      // This should never trigger. Fire the alert path.
      console.error(`[GATE-6-ALERT] unresolved CSID reached render: ${csid} (${resolved.reason})`);
      return NextResponse.json(
        { kind: "unresolved", csid, reason: resolved.reason },
        { status: 404, headers: cors },
      );
  }
}
