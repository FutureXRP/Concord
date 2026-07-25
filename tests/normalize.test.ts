import { describe, expect, it } from "vitest";
import { normalizeQuote, quoteIsVerbatim } from "../lib/concord/normalize";

describe("Gate 2 normalization (spec 10)", () => {
  it("collapses whitespace", () => {
    expect(normalizeQuote("man's  chief\n end")).toBe("man's chief end");
  });

  it("normalizes unicode quotes and dashes", () => {
    expect(normalizeQuote("“God’s glory” — forever")).toBe(
      "\"God's glory\" - forever",
    );
  });

  it("strips editorial brackets", () => {
    expect(normalizeQuote("to glorify God [1] and enjoy him")).toBe(
      "to glorify God and enjoy him",
    );
  });

  it("does NOT case-fold (original-language safety)", () => {
    expect(normalizeQuote("Logos")).toBe("Logos");
    expect(normalizeQuote("LOGOS")).not.toBe("logos");
  });
});

describe("quoteIsVerbatim", () => {
  const bodyNorm = normalizeQuote(
    "Man's chief end is to glorify God, and to enjoy him for ever.",
  );

  it("accepts contiguous substrings (with quote/space differences)", () => {
    expect(quoteIsVerbatim("to glorify God, and to enjoy him", bodyNorm)).toBe(true);
    expect(quoteIsVerbatim("Man’s  chief end", bodyNorm)).toBe(true);
  });

  it("rejects paraphrase and stitched quotes", () => {
    expect(quoteIsVerbatim("to glorify and enjoy God", bodyNorm)).toBe(false);
    expect(quoteIsVerbatim("chief end ... for ever", bodyNorm)).toBe(false);
  });

  it("rejects empty quotations", () => {
    expect(quoteIsVerbatim("", bodyNorm)).toBe(false);
  });
});
