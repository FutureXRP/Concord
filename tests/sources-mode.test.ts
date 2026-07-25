import { describe, expect, it } from "vitest";
import { runConcordQuery } from "../lib/concord/pipeline";
import { quoteIsVerbatim } from "../lib/concord/normalize";
import { localGetChunk } from "../lib/concord/localstore";

// No model, no database, no keys: the standalone path end to end.

describe("standalone sources mode (no model configured)", () => {
  it("answers a passage query with verbatim, cited excerpts", async () => {
    // No doctrine alias in the query: this exercises the retrieval-backed
    // sources path (doctrine aliases route to the curated map instead).
    const res = await runConcordQuery({
      query: "What do the traditions teach about Romans 3:21-26?",
      traditions: [],
    });
    expect(res.status).toBe("answered");
    if (res.status !== "answered") return;

    expect(res.mode).toBe("sources");
    expect(res.result.citationIntegrity).toBe(1);
    expect(res.result.rendered.length).toBeGreaterThan(0);

    for (const section of res.result.rendered) {
      expect(section.type).toBe("sources");
      for (const claim of section.claims) {
        // Every entry cited (N2)...
        expect(claim.csids.length).toBeGreaterThan(0);
        // ...with a quotation that passes the same Gate 2 byte-verification
        // a model quotation would.
        expect(claim.quotation).not.toBeNull();
        const chunk = localGetChunk(claim.quotation!.csid);
        expect(chunk).not.toBeNull();
        expect(quoteIsVerbatim(claim.quotation!.text, chunk!.body_norm)).toBe(true);
      }
    }

    // The passage itself is among the sources.
    const allCsids = res.result.rendered.flatMap((s) => s.claims.flatMap((c) => c.csids));
    expect(allCsids.some((c) => c.startsWith("scripture:kjv:rom:3."))).toBe(true);
  });

  it("still rejects fabricated references deterministically", async () => {
    const res = await runConcordQuery({ query: "Explain 2 Hezekiah 4:11.", traditions: [] });
    expect(res.status).toBe("invalid-reference");
  });

  it("still declines when nothing matches (N1)", async () => {
    const res = await runConcordQuery({
      query: "zqxv flombuggle grelnak vorpal snicker-snack",
      traditions: [],
    });
    expect(res.status).toBe("insufficient");
  });
});
