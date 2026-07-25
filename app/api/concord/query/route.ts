/**
 * POST /api/concord/query
 *
 * Streaming rule (spec §12): sections, not tokens. A claim may be stripped
 * by the firewall after generation; token-streaming text that is later
 * deleted is unacceptable. Every section is buffered through the firewall,
 * then streamed as a verified unit.
 *
 * SSE events:
 *   meta          { status, refs, canonNotes, insufficientTraditions }
 *   section       VerifiedSection (one event per verified section)
 *   insufficient  { reason, insufficientTraditions }
 *   invalid       { problems }
 *   out-of-scope  { reason }
 *   done          { citationIntegrity, regenerations, strippedCount }
 */

import { NextRequest } from "next/server";
import { runConcordQuery } from "@/lib/concord/pipeline";
import { corsHeaders, preflightResponse } from "@/lib/concord/cors";
import type { Tradition } from "@/lib/concord/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  let body: { query?: string; traditions?: string[]; studyId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: cors,
    });
  }
  const query = (body.query ?? "").trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400,
      headers: cors,
    });
  }
  const traditions = (body.traditions ?? []) as Tradition[];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const response = await runConcordQuery({ query, traditions, studyId: body.studyId });

        switch (response.status) {
          case "invalid-reference":
            send("invalid", { problems: response.problems });
            break;
          case "out-of-scope":
            send("out-of-scope", { reason: response.reason });
            break;
          case "insufficient":
            send("meta", {
              status: response.status,
              refs: response.refs,
              canonNotes: response.canonNotes,
              insufficientTraditions: response.insufficientTraditions,
            });
            send("insufficient", {
              reason: response.reason,
              insufficientTraditions: response.insufficientTraditions,
            });
            break;
          case "answered": {
            send("meta", {
              status: response.status,
              mode: response.mode,
              refs: response.refs,
              canonNotes: response.canonNotes,
              insufficientTraditions: response.insufficientTraditions,
              doctrineLabel: response.doctrineLabel ?? null,
              sayingNote: response.sayingNote ?? null,
            });
            // Consensus first (§11: the "agree" view leads).
            const order = ["consensus", "sources", "position", "divergence", "historical", "critique"];
            const sections = [...response.result.rendered].sort(
              (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
            );
            for (const section of sections) {
              send("section", section);
            }
            send("done", {
              citationIntegrity: response.result.citationIntegrity,
              regenerations: response.result.regenerations,
              strippedCount: response.result.stripped.length,
            });
            break;
          }
        }
      } catch (e) {
        send("error", { message: e instanceof Error ? e.message : "internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...cors,
    },
  });
}
