import { describe, expect, it } from "vitest";
import { runFirewall, type EntailmentChecker } from "../lib/concord/firewall";
import { normalizeBodyForStorage } from "../lib/concord/normalize";
import type { GenerationOutput, RetrievedChunk } from "../lib/concord/types";

const WSC_Q1_BODY =
  "Q1. What is the chief end of man?\nA. Man's chief end is to glorify God, and to enjoy him for ever.";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    csid: "confession:westminster-shorter:q1",
    work_id: "confession:westminster-shorter",
    locator: "q1",
    body: WSC_Q1_BODY,
    body_norm: normalizeBodyForStorage(WSC_Q1_BODY),
    token_count: 30,
    source_type: "primary",
    stance: "self-descriptive",
    parent_csid: null,
    prev_csid: null,
    next_csid: null,
    scripture_refs: [],
    tradition: "reformed",
    authority_class: "confessional-standard",
    composed_era: "post-reformation",
    work_title: "Westminster Shorter Catechism",
    score: 1,
    ...overrides,
  };
}

function output(overrides: Partial<GenerationOutput> = {}): GenerationOutput {
  return {
    sufficient: true,
    sections: [
      {
        type: "position",
        tradition: "reformed",
        claims: [
          {
            text: "The Westminster Shorter Catechism teaches that humanity's purpose is to glorify God and enjoy him forever.",
            csids: ["confession:westminster-shorter:q1"],
            quotation: {
              csid: "confession:westminster-shorter:q1",
              text: "to glorify God, and to enjoy him for ever",
            },
          },
        ],
      },
    ],
    insufficient_for: [],
    ...overrides,
  };
}

describe("Gate 1 - CSID resolution", () => {
  it("hard-fails on a fabricated CSID and names it in the retry note", async () => {
    const bad = output();
    bad.sections[0].claims[0].csids = ["confession:westminster-shorter:q999"];
    bad.sections[0].claims[0].quotation = null;
    const outcome = await runFirewall(bad, [chunk()]);
    expect(outcome.status).toBe("hard-fail");
    if (outcome.status === "hard-fail") {
      expect(outcome.gate).toBe(1);
      expect(outcome.retryNote).toContain("confession:westminster-shorter:q999");
    }
  });

  it("a model cannot cite what it was not given, even a real CSID", async () => {
    const bad = output();
    bad.sections[0].claims[0].csids = ["confession:westminster:ch11.1"]; // real work, not injected
    bad.sections[0].claims[0].quotation = null;
    const outcome = await runFirewall(bad, [chunk()]);
    expect(outcome.status).toBe("hard-fail");
  });
});

describe("Gate 2 - quotation byte-verification", () => {
  it("passes verbatim quotations", async () => {
    const outcome = await runFirewall(output(), [chunk()]);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.rendered[0].claims[0].quotation).not.toBeNull();
      expect(outcome.result.citationIntegrity).toBe(1);
    }
  });

  it("strips a doctored quotation but keeps the cited claim", async () => {
    const doctored = output();
    doctored.sections[0].claims[0].quotation = {
      csid: "confession:westminster-shorter:q1",
      text: "to glorify God by keeping his commandments for ever",
    };
    const outcome = await runFirewall(doctored, [chunk()]);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.rendered[0].claims[0].quotation).toBeNull();
      expect(outcome.result.stripped).toHaveLength(1);
      expect(outcome.result.stripped[0].gate).toBe(2);
      expect(outcome.result.citationIntegrity).toBeLessThan(1);
    }
  });
});

describe("Gate 3 - entailment (when a checker is configured)", () => {
  const failingChecker: EntailmentChecker = {
    async check() {
      return "UNSUPPORTED";
    },
  };

  it("strips UNSUPPORTED claims entirely", async () => {
    const outcome = await runFirewall(output(), [chunk()], { entailment: failingChecker });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.rendered).toHaveLength(0);
      expect(outcome.result.stripped.some((s) => s.gate === 3)).toBe(true);
    }
  });

  it("renders PARTIAL claims with the hedge marker", async () => {
    const partialChecker: EntailmentChecker = {
      async check() {
        return "PARTIAL";
      },
    };
    const outcome = await runFirewall(output(), [chunk()], { entailment: partialChecker });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.rendered[0].claims[0].entailment).toBe("partial");
    }
  });
});

describe("Gate 4 - uncited assertion sweep", () => {
  it("drops claims with empty csids at parse time", async () => {
    const bad = output();
    bad.sections[0].claims.push({
      text: "All traditions secretly agree on this.",
      csids: [],
      quotation: null,
    });
    const outcome = await runFirewall(bad, [chunk()]);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.rendered[0].claims).toHaveLength(1);
      expect(outcome.result.stripped[0].gate).toBe(4);
    }
  });
});

describe("Gate 5 - stance integrity", () => {
  it("regenerates when a position cites a critical source", async () => {
    const critical = chunk({
      csid: "critique:hodge:systematic:3.1",
      stance: "critical",
      work_id: "critique:hodge:systematic",
    });
    const bad = output();
    bad.sections[0].claims[0].csids = ["critique:hodge:systematic:3.1"];
    bad.sections[0].claims[0].quotation = null;
    const outcome = await runFirewall(bad, [chunk(), critical]);
    expect(outcome.status).toBe("hard-fail");
    if (outcome.status === "hard-fail") expect(outcome.gate).toBe(5);
  });

  it("requires a critique section to cite at least one critical source", async () => {
    const bad = output({
      sections: [
        {
          type: "critique",
          tradition: "reformed",
          claims: [
            {
              text: "Critics object to this formulation.",
              csids: ["confession:westminster-shorter:q1"],
              quotation: null,
            },
          ],
        },
      ],
    });
    const outcome = await runFirewall(bad, [chunk()]);
    expect(outcome.status).toBe("hard-fail");
    if (outcome.status === "hard-fail") expect(outcome.gate).toBe(5);
  });
});
