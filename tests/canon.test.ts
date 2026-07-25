import { describe, expect, it } from "vitest";
import {
  extractReferences,
  preflightReferences,
  validateReference,
  expandRefToVerses,
} from "../lib/concord/canon";

describe("reference extraction", () => {
  it("extracts common forms", () => {
    const refs = extractReferences("Compare John 3:16 and Rom. 3:21-26 with 1 Cor 15:3.");
    expect(refs.map((r) => r.book.id)).toEqual(["john", "rom", "1cor"]);
    expect(refs[1].chapter).toBe(3);
    expect(refs[1].verse).toBe(21);
    expect(refs[1].endVerse).toBe(26);
  });

  it("handles Psalm and Song of Solomon aliases", () => {
    expect(extractReferences("Psalm 119:105")[0].book.id).toBe("ps");
    expect(extractReferences("Song of Songs 2:1")[0].book.id).toBe("song");
    expect(extractReferences("Canticles 2:1")[0].book.id).toBe("song");
  });
});

describe("deterministic validation (spec 9.1)", () => {
  it("accepts real verses", () => {
    expect(validateReference("John 3:16").ok).toBe(true);
    expect(validateReference("Psalm 119:176").ok).toBe(true);
    expect(validateReference("Jude 1:25").ok).toBe(true);
  });

  it("rejects nonexistent verses with a precise message", () => {
    const v = validateReference("John 3:99");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/John 3 has 36 verses/);
  });

  it("rejects nonexistent chapters", () => {
    const v = validateReference("Jude 2:1");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/Jude has 1 chapters/);
  });

  it("rejects invalid range ends", () => {
    const v = validateReference("John 3:16-99");
    expect(v.ok).toBe(false);
  });

  it("flags fabricated books in preflight (adversarial: 2 Hezekiah 4:11)", () => {
    const pre = preflightReferences("Explain 2 Hezekiah 4:11.");
    expect(pre.valid).toHaveLength(0);
    expect(pre.invalid.length).toBeGreaterThan(0);
    expect(pre.invalid[0].reason).toMatch(/No book named/);
  });

  it("does not silently fail on Sirach (canon-set awareness)", () => {
    const v = validateReference("Sirach 2:1");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.ref.canonSets).toContain("catholic");
      expect(v.canonNote).toMatch(/catholic\/orthodox canon/);
    }
  });

  it("passes clean queries through preflight", () => {
    const pre = preflightReferences("What does Romans 3:21-26 teach about justification?");
    expect(pre.invalid).toHaveLength(0);
    expect(pre.valid).toHaveLength(1);
    expect(pre.valid[0].refNorm).toBe("rom:3.21-3.26");
  });
});

describe("comma lists and chapter ranges", () => {
  it("extracts comma-continued verses", () => {
    const refs = extractReferences("See John 3:16,18 and Rom 8:1, 28.");
    const norms = refs.map((r) => `${r.book.id}:${r.chapter}.${r.verse}`);
    expect(norms).toEqual(["john:3.16", "john:3.18", "rom:8.1", "rom:8.28"]);
  });

  it("does not swallow chapter:verse after a comma", () => {
    const refs = extractReferences("John 3:16, 4:2 is two refs, not three verses.");
    // "4:2" has no book so it is not extracted; the comma scan must not eat "4".
    expect(refs).toHaveLength(1);
    expect(refs[0].verse).toBe(16);
  });

  it("parses and validates chapter ranges", () => {
    const v = validateReference("John 3-4");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.ref.refNorm).toBe("john:3-4");
      const verses = expandRefToVerses(v.ref);
      expect(verses).toHaveLength(36 + 54); // John 3 + John 4
      expect(verses[0]).toBe("john:3.1");
      expect(verses[verses.length - 1]).toBe("john:4.54");
    }
  });

  it("rejects impossible chapter ranges", () => {
    const v = validateReference("Jude 1-3");
    expect(v.ok).toBe(false);
  });
});

describe("verse expansion", () => {
  it("expands ranges to individual verses", () => {
    const pre = preflightReferences("Romans 3:21-26");
    const verses = expandRefToVerses(pre.valid[0]);
    expect(verses).toEqual([
      "rom:3.21",
      "rom:3.22",
      "rom:3.23",
      "rom:3.24",
      "rom:3.25",
      "rom:3.26",
    ]);
  });
});
