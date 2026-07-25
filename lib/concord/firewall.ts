/**
 * The Citation Fabrication Firewall (spec §10).
 *
 * Runs on every generated response before anything reaches the renderer.
 * No bypass flag. No dev override that ships.
 *
 *   Gate 1 - CSID resolution against the injected set (deterministic)
 *   Gate 2 - Quotation byte-verification (deterministic)
 *   Gate 3 - Entailment verification (model-assisted, strict; Phase 2 -
 *            enabled when an EntailmentChecker is configured)
 *   Gate 4 - Uncited assertion sweep (deterministic)
 *   Gate 5 - Stance integrity (deterministic)
 *   Gate 6 - Render-time resolution (renderer + /api/concord/resolve)
 */

import type {
  Claim,
  FirewallResult,
  GenerationOutput,
  RetrievedChunk,
  StrippedClaim,
  VerifiedClaim,
  VerifiedSection,
} from "./types";
import { quoteIsVerbatim } from "./normalize";

export type EntailmentVerdict = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED";

export interface EntailmentChecker {
  check(claimText: string, chunkBody: string): Promise<EntailmentVerdict>;
}

export interface FirewallOptions {
  /** Gate 3. Absent in Phase 1: claims pass entailment by default. */
  entailment?: EntailmentChecker;
}

export type FirewallOutcome =
  | { status: "ok"; result: FirewallResult }
  | {
      /** Gate 1 or Gate 5 violation: full regeneration required (spec §10). */
      status: "hard-fail";
      gate: 1 | 5;
      retryNote: string;
      stripped: StrippedClaim[];
    };

export async function runFirewall(
  output: GenerationOutput,
  injected: RetrievedChunk[],
  opts: FirewallOptions = {},
): Promise<FirewallOutcome> {
  const injectedByCSID = new Map(injected.map((c) => [c.csid, c]));
  const stripped: StrippedClaim[] = [];

  // ---- Gate 1: every cited CSID must be in the injected set. Hard fail. ----
  const fabricated = new Set<string>();
  for (const section of output.sections) {
    for (const claim of section.claims) {
      for (const csid of claim.csids) {
        if (!injectedByCSID.has(csid)) fabricated.add(csid);
      }
      if (claim.quotation && !injectedByCSID.has(claim.quotation.csid)) {
        fabricated.add(claim.quotation.csid);
      }
    }
  }
  if (fabricated.size > 0) {
    return {
      status: "hard-fail",
      gate: 1,
      retryNote: `The following csids do NOT exist in the injected source set and must not be cited: ${[...fabricated].join(", ")}. Cite only csids from the provided list, or return {"sufficient": false} if the sources do not support the answer.`,
      stripped,
    };
  }

  // ---- Gate 5: stance integrity. Hard fail -> regenerate. ----
  for (const section of output.sections) {
    if (section.type === "position") {
      const bad = section.claims.flatMap((cl) =>
        cl.csids.filter((id) => injectedByCSID.get(id)!.stance !== "self-descriptive"),
      );
      if (bad.length > 0) {
        return {
          status: "hard-fail",
          gate: 5,
          retryNote: `A "position" section may cite only stance="self-descriptive" sources. These citations violate that: ${[...new Set(bad)].join(", ")}. Move critique into a separate "critique" section or drop it.`,
          stripped,
        };
      }
    }
    if (section.type === "critique") {
      const hasCritical = section.claims.some((cl) =>
        cl.csids.some((id) => injectedByCSID.get(id)!.stance === "critical"),
      );
      if (!hasCritical && section.claims.length > 0) {
        return {
          status: "hard-fail",
          gate: 5,
          retryNote: `A "critique" section must cite at least one stance="critical" source. Re-classify the section or return it as "divergence"/"historical" if no critical source supports it.`,
          stripped,
        };
      }
    }
  }

  // ---- Gates 4, 2, 3: per-claim. ----
  const rendered: VerifiedSection[] = [];
  for (const section of output.sections) {
    const keptClaims: VerifiedClaim[] = [];
    for (const claim of section.claims) {
      // Gate 4: uncited assertions are dropped at parse time. The renderer
      // has no code path that emits text without an attached, verified CSID.
      if (claim.csids.length === 0) {
        stripped.push({ claim, gate: 4, reason: "claim has no citations" });
        continue;
      }

      // Gate 2: quotation byte-verification. Fail -> strip the quotation,
      // keep the claim if it survives Gate 3.
      let workingClaim: Claim = claim;
      if (claim.quotation) {
        const source = injectedByCSID.get(claim.quotation.csid)!;
        if (!quoteIsVerbatim(claim.quotation.text, source.body_norm)) {
          stripped.push({
            claim,
            gate: 2,
            reason: `quotation is not a contiguous substring of ${claim.quotation.csid}`,
          });
          workingClaim = { ...claim, quotation: null };
        }
      }

      // Gate 3: entailment (strict, isolated: only the claim and its cited
      // chunk - no conversation history, no study context, no query).
      let entailment: VerifiedClaim["entailment"] = "pass";
      if (opts.entailment) {
        const verdicts = await Promise.all(
          workingClaim.csids.map((id) =>
            opts.entailment!.check(workingClaim.text, injectedByCSID.get(id)!.body),
          ),
        );
        if (verdicts.every((v) => v === "UNSUPPORTED")) {
          stripped.push({
            claim: workingClaim,
            gate: 3,
            reason: "no cited source supports the claim (UNSUPPORTED)",
          });
          continue;
        }
        entailment = verdicts.some((v) => v === "SUPPORTED") ? "pass" : "partial";
      }

      keptClaims.push({ ...workingClaim, entailment });
    }
    if (keptClaims.length > 0) {
      rendered.push({ type: section.type, tradition: section.tradition, claims: keptClaims });
    }
  }

  const renderedCount = rendered.reduce((n, s) => n + s.claims.length, 0);
  const total = renderedCount + stripped.length;
  return {
    status: "ok",
    result: {
      rendered,
      stripped,
      regenerations: 0,
      citationIntegrity: total === 0 ? 1 : renderedCount / total,
    },
  };
}
