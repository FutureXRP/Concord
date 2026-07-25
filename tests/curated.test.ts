import { describe, expect, it } from "vitest";
import { DOCTRINES, SAYINGS, matchDoctrine, matchSaying, buildDoctrineResult, buildSayingResult } from "../lib/concord/curated";
import { localGetChunk, localCitedBy } from "../lib/concord/localstore";
import { runConcordQuery } from "../lib/concord/pipeline";
import { quoteIsVerbatim } from "../lib/concord/normalize";

describe("curated data integrity", () => {
  it("every doctrine locus CSID resolves to a real corpus chunk", () => {
    for (const d of DOCTRINES) {
      for (const csid of d.consensus) {
        expect(localGetChunk(csid), `${d.id} consensus ${csid}`).not.toBeNull();
      }
      for (const locus of d.loci) {
        for (const csid of locus.csids) {
          expect(localGetChunk(csid), `${d.id}/${locus.tradition} ${csid}`).not.toBeNull();
        }
      }
    }
  });

  it("every saying nearest-ref resolves to a KJV verse chunk", () => {
    for (const s of SAYINGS) {
      for (const ref of s.nearest) {
        expect(localGetChunk(`scripture:kjv:${ref}`), `${s.id} ${ref}`).not.toBeNull();
      }
    }
  });
});

describe("matching", () => {
  it("matches sayings inside natural questions", () => {
    expect(matchSaying("Where does the Bible say God helps those who help themselves?")?.id).toBe("god-helps");
    expect(matchSaying("Which verse says cleanliness is next to godliness?")?.id).toBe("cleanliness");
    expect(matchSaying("Show me where Augustine said 'in essentials unity, in non-essentials liberty'")?.id).toBe("essentials-unity");
    expect(matchSaying("What does Romans teach about grace?")).toBeNull();
  });

  it("matches doctrines by alias", () => {
    expect(matchDoctrine("What do the traditions teach about baptism?")?.id).toBe("baptism");
    expect(matchDoctrine("Compare views of the eucharist")?.id).toBe("lords-supper");
    expect(matchDoctrine("predestination and election across churches")?.id).toBe("predestination");
    expect(matchDoctrine("What is the church according to the traditions?")?.id).toBe("church");
    // Casual mentions without the alias phrase do not hijack the query.
    expect(matchDoctrine("Tell me about church potlucks")).toBeNull();
  });
});

describe("doctrine answers", () => {
  it("builds a multi-tradition comparison with consensus first", () => {
    const d = DOCTRINES.find((x) => x.id === "baptism")!;
    const result = buildDoctrineResult(d, localGetChunk)!;
    expect(result.citationIntegrity).toBe(1);
    expect(result.rendered[0].type).toBe("consensus");
    const traditions = result.rendered.filter((s) => s.type === "sources").map((s) => s.tradition);
    expect(traditions).toContain("catholic-roman");
    expect(traditions).toContain("lutheran");
    expect(traditions).toContain("reformed");
    expect(traditions).toContain("anglican");
    expect(traditions).toContain("baptist");
    // Every quotation byte-verifies against its own chunk.
    for (const s of result.rendered) {
      for (const c of s.claims) {
        const chunk = localGetChunk(c.quotation!.csid)!;
        expect(quoteIsVerbatim(c.quotation!.text, chunk.body_norm)).toBe(true);
      }
    }
  });

  it("pipeline answers doctrine queries in curated mode", async () => {
    const res = await runConcordQuery({ query: "What do the traditions teach about justification?", traditions: [] });
    expect(res.status).toBe("answered");
    if (res.status !== "answered") return;
    expect(res.mode).toBe("curated");
    expect(res.doctrineLabel).toBe("Justification");
    expect(res.result.rendered.length).toBeGreaterThanOrEqual(4);
  });
});

describe("saying answers (spec 14.3 - the best demo)", () => {
  it("answers with verdict, documented origin, and cited nearest scripture", async () => {
    const res = await runConcordQuery({
      query: "Where does the Bible say God helps those who help themselves?",
      traditions: [],
    });
    expect(res.status).toBe("answered");
    if (res.status !== "answered") return;
    expect(res.mode).toBe("curated");
    expect(res.sayingNote?.verdict).toBe("not-in-scripture");
    expect(res.sayingNote?.origin).toContain("Sidney");
    const csids = res.result.rendered.flatMap((s) => s.claims.flatMap((c) => c.csids));
    expect(csids).toContain("scripture:kjv:rom:5.6");
  });

  it("corrects the wolf/lamb conflation", () => {
    const s = matchSaying("Doesn't Isaiah say the lion shall lie down with the lamb?");
    expect(s?.verdict).toBe("paraphrase");
    const { note, result } = buildSayingResult(s!, localGetChunk);
    expect(note.origin).toContain("WOLF");
    expect(result.rendered[0].claims.map((c) => c.csids[0])).toContain("scripture:kjv:isa:11.6");
  });
});

describe("cited-by reverse index", () => {
  it("finds confession chunks citing a verse", () => {
    // The Small Catechism cites Exodus 20:3 inline.
    const hits = localCitedBy(["exod:20.3"]);
    expect(hits.some((c) => c.work_id === "confession:luther-small-catechism")).toBe(true);
    // Never returns scripture chunks (those ARE the verse).
    expect(hits.every((c) => c.authority_class !== "scripture")).toBe(true);
  });
});
