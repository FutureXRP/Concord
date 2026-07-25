import { describe, expect, it } from "vitest";
import {
  localSparseSearch,
  localRefSearch,
  localGetChunk,
  localGetWork,
} from "../lib/concord/localstore";
import { resolveCSID } from "../lib/concord/csid";
import { retrieve } from "../lib/concord/retrieve";

// These tests exercise the checked-in public-domain corpus
// (data/sources/*), which is what dev/demo mode serves.

describe("local corpus store", () => {
  it("loads the Westminster Shorter Catechism", () => {
    const q1 = localGetChunk("confession:westminster-shorter:q1");
    expect(q1).not.toBeNull();
    expect(q1!.body).toContain("chief end");
    expect(q1!.stance).toBe("self-descriptive");
    expect(q1!.tradition).toBe("reformed");
  });

  it("loads the full KJV", () => {
    const jn316 = localGetChunk("scripture:kjv:john:3.16");
    expect(jn316).not.toBeNull();
    expect(jn316!.body).toContain("For God so loved the world");
    expect(localGetChunk("scripture:kjv:rev:22.21")).not.toBeNull();
  });

  it("loads work metadata with license tiers", () => {
    expect(localGetWork("confession:westminster")?.license_tier).toBe("A");
    expect(localGetWork("council:chalcedon:definition")?.authority_class).toBe(
      "ecumenical-definition",
    );
  });

  it("BM25 finds the chief-end question", () => {
    const hits = localSparseSearch("What is the chief end of man?", 10);
    expect(hits.map((h) => h.csid)).toContain("confession:westminster-shorter:q1");
  });

  it("exact ref search returns verse chunks", () => {
    const hits = localRefSearch(["rom:3.24", "john:3.16"]);
    const csids = hits.map((h) => h.csid);
    expect(csids).toContain("scripture:kjv:rom:3.24");
    expect(csids).toContain("scripture:kjv:john:3.16");
  });
});

describe("local-mode resolveCSID (Gate 6 backing)", () => {
  it("resolves stored chunks with work metadata", async () => {
    const r = await resolveCSID("confession:heidelberg:q1");
    expect(r.kind).toBe("chunk");
    if (r.kind === "chunk") {
      expect(r.chunk.body).toContain("comfort");
      expect(r.work.title).toBe("Heidelberg Catechism");
    }
  });

  it("reports unresolved CSIDs instead of inventing them", async () => {
    const r = await resolveCSID("confession:westminster-shorter:q999");
    expect(r.kind).toBe("unresolved");
  });
});

describe("local-mode retrieval pipeline", () => {
  it("retrieves scripture + confessional chunks for a passage query", async () => {
    const result = await retrieve({
      query: "What does Romans 3:21-26 teach about justification?",
      traditions: [],
    });
    expect(result.empty).toBe(false);
    const csids = result.chunks.map((c) => c.csid);
    expect(csids.some((c) => c.startsWith("scripture:kjv:rom:3."))).toBe(true);
    expect(result.chunks.length).toBeLessThanOrEqual(16);
  });

  it("returns empty (declines) when nothing in the corpus matches", async () => {
    // Fully out-of-vocabulary query: zero retrieval -> zero claim (N1).
    // Queries built of common words that merely lack topical support are
    // handled downstream: the generation contract returns sufficient:false
    // and Gate 3 strips unsupported claims. Sharper relevance thresholding
    // at this layer arrives with the Phase 2 cross-encoder reranker.
    const result = await retrieve({
      query: "zqxv flombuggle grelnak vorpal snicker-snack",
      traditions: [],
    });
    expect(result.empty).toBe(true);
    expect(result.chunks).toHaveLength(0);
  });

  it("enforces the tradition-balance floor (N6)", async () => {
    const result = await retrieve({
      query: "What does the Oriental Orthodox tradition teach about the eucharist?",
      traditions: ["orthodox-oriental"],
    });
    // No Oriental Orthodox primary sources in the local corpus:
    // the tradition must be reported insufficient, never answered from critique.
    if (!result.empty) {
      expect(result.insufficientTraditions).toContain("orthodox-oriental");
    }
  });
});
