import { describe, expect, it } from "vitest";
import { isValidCSID, parseCSID, workIdOf, locatorOf } from "../lib/concord/csid";

describe("CSID grammar (spec 4)", () => {
  it("accepts spec examples", () => {
    const valid = [
      "scripture:web:john:3.16",
      "scripture:wlc:gen:1.1-1.3",
      "scripture:sblgnt:rom:3.21-3.26",
      "father:athanasius:de-incarnatione:54.3",
      "father:augustine:confessions:8.12.29",
      "council:nicaea-i:creed:1",
      "council:chalcedon:definition:2",
      "confession:westminster-shorter:q1",
      "confession:augsburg:art4",
      "confession:trent:session6.canon9",
      "magisterium:ccc:460",
      "systematic:calvin:institutes:3.11.2",
      "systematic:aquinas:summa:st-i-q2-a3",
      "rabbinic:mishnah-berakhot:1.1",
      "rabbinic:rashi-genesis:1.1",
      "nrm:lds:2-nephi:2.25",
      "quran:pickthall:2.255",
      "lexicon:strongs-h:h430",
      "lexicon:thayer:g26",
    ];
    for (const csid of valid) {
      expect(isValidCSID(csid), csid).toBe(true);
    }
  });

  it("rejects malformed CSIDs", () => {
    const invalid = [
      "Scripture:web:john:3.16", // uppercase
      "scripture:web:john 3:16", // space
      "unknown:foo:bar:1", // unknown domain
      "scripture:web", // too few segments
      "confession::q1", // empty segment
      "scripture:web:john:3.16é", // non-ASCII
    ];
    for (const csid of invalid) {
      expect(isValidCSID(csid), csid).toBe(false);
    }
  });

  it("parses domain and splits work id from locator", () => {
    const p = parseCSID("confession:westminster-shorter:q33");
    expect(p?.domain).toBe("confession");
    expect(workIdOf("confession:westminster-shorter:q33")).toBe(
      "confession:westminster-shorter",
    );
    expect(locatorOf("systematic:calvin:institutes:3.11.2")).toBe("3.11.2");
  });
});
