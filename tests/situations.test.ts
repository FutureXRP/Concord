import { describe, expect, it } from "vitest";
import { SITUATIONS, matchSituation, contentTerms } from "../lib/concord/situations";
import { validateReference } from "../lib/concord/canon";
import { localGetChunk } from "../lib/concord/localstore";
import { expandRefToVerses } from "../lib/concord/canon";

describe("situations data integrity", () => {
  it("every curated passage validates against the canon", () => {
    for (const s of SITUATIONS) {
      expect(s.passages.length).toBeGreaterThanOrEqual(5);
      for (const p of s.passages) {
        const v = validateReference(p.ref);
        expect(v.ok, `${s.id}: "${p.ref}" — ${v.ok ? "" : (v as { reason: string }).reason}`).toBe(true);
      }
    }
  });

  it("every curated passage's verses exist in the KJV corpus", () => {
    for (const s of SITUATIONS) {
      for (const p of s.passages) {
        const v = validateReference(p.ref);
        if (!v.ok) continue; // covered above
        const verses = expandRefToVerses(v.ref);
        expect(verses.length).toBeGreaterThan(0);
        // Spot-check first and last verse resolve to real chunks.
        expect(localGetChunk(`scripture:kjv:${verses[0]}`), `${s.id} ${p.ref} first`).not.toBeNull();
        expect(
          localGetChunk(`scripture:kjv:${verses[verses.length - 1]}`),
          `${s.id} ${p.ref} last`,
        ).not.toBeNull();
      }
    }
  });
});

describe("situation matching (the queries people actually type)", () => {
  it("understands intent, not keywords", () => {
    expect(matchSituation("help with scripture to preach a funeral")?.id).toBe("funeral");
    expect(matchSituation("I need verses for my mom's memorial service")?.id).toBe("funeral");
    expect(matchSituation("a reading for my daughter's wedding")?.id).toBe("wedding");
    expect(matchSituation("I'm so anxious I can't sleep")?.id).toBe("anxiety");
    expect(matchSituation("verses about forgiving someone who hurt me")?.id).toBe("forgiving-others");
    expect(matchSituation("scripture for someone dying in hospice")?.id).toBe("facing-death");
    expect(matchSituation("what should I read before getting baptized")?.id).toBe("baptism-prep");
    expect(matchSituation("sermon for good friday")?.id).toBe("good-friday");
  });

  it("does not hijack unrelated queries", () => {
    expect(matchSituation("What does Romans 3 teach about righteousness?")).toBeNull();
    expect(matchSituation("history of the westminster confession composition details")).toBeNull();
  });

  it("strips intent words so BM25 searches content", () => {
    expect(contentTerms("help with scripture to preach a funeral")).toEqual(["funeral"]);
    expect(contentTerms("good verses about shepherds watching sheep")).toEqual([
      "shepherds",
      "watching",
      "sheep",
    ]);
  });
});
