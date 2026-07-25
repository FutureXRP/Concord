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
import { fetchVerse } from "@/lib/youversion/proxy";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const csid = req.nextUrl.searchParams.get("csid");
  const translation = req.nextUrl.searchParams.get("translation");
  if (!csid) {
    return NextResponse.json({ error: "csid is required" }, { status: 400 });
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
      return NextResponse.json({
        kind: "chunk",
        csid,
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
      });
    }
    case "proxy": {
      const verse = await fetchVerse(resolved.refNorm, resolved.translation);
      return NextResponse.json({
        kind: "proxy",
        csid,
        body: verse.text,
        attribution: verse.attribution,
        degradationNotice: verse.degradationNotice,
      });
    }
    case "describe-only":
      return NextResponse.json({ kind: "describe-only", csid, note: resolved.note });
    case "unresolved":
      // This should never trigger. Fire the alert path.
      console.error(`[GATE-6-ALERT] unresolved CSID reached render: ${csid} (${resolved.reason})`);
      return NextResponse.json(
        { kind: "unresolved", csid, reason: resolved.reason },
        { status: 404 },
      );
  }
}
