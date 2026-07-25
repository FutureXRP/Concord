/**
 * End-to-end Concord pipeline:
 *
 *   deterministic pre-flight (§9.1)
 *     -> retrieval (§8)
 *     -> generation (§9)
 *     -> firewall (§10) with the regeneration loop:
 *        Gate 1/5 hard fail -> regenerate with the offending IDs named;
 *        two consecutive hard fails -> insufficient-sources response.
 *     -> citation audit log (§6)
 */

import { randomUUID } from "node:crypto";
import { preflightReferences } from "./canon";
import { retrieve } from "./retrieve";
import { generateSections } from "./generate";
import { runFirewall } from "./firewall";
import { getEntailmentChecker } from "./entailment";
import { getSupabase } from "../supabase/client";
import type { FirewallResult, ScriptureRef, Tradition } from "./types";

const MAX_HARD_FAILS = 2;

export interface ConcordQuery {
  query: string;
  traditions: Tradition[];
  studyId?: string;
}

export type ConcordResponse =
  | {
      status: "answered";
      result: FirewallResult;
      refs: ScriptureRef[];
      canonNotes: string[];
      insufficientTraditions: Tradition[];
    }
  | {
      /** N1: zero retrieval -> zero claim. Insufficiency is a first-class state. */
      status: "insufficient";
      reason: string;
      refs: ScriptureRef[];
      canonNotes: string[];
      insufficientTraditions: Tradition[];
    }
  | {
      /** Pre-flight rejection: fabricated or invalid reference. */
      status: "invalid-reference";
      problems: Array<{ input: string; reason: string }>;
    }
  | { status: "out-of-scope"; reason: string };

/** Route pastoral/devotional intent back to core PassageLab (§9.1.4). */
const PASTORAL_RE =
  /\b(pray for me|comfort me|i feel|i am struggling|devotional for|encourage me|help me forgive|my marriage|my grief)\b/i;

export async function runConcordQuery(q: ConcordQuery): Promise<ConcordResponse> {
  // 1-3. Reference extraction + validation + canon-set awareness. Pure code.
  const pre = preflightReferences(q.query);
  if (pre.invalid.length > 0) {
    return { status: "invalid-reference", problems: pre.invalid };
  }

  // 4. Scope check.
  if (PASTORAL_RE.test(q.query)) {
    return {
      status: "out-of-scope",
      reason:
        "This question asks for pastoral or devotional counsel, which is PassageLab's core surface. Concord reports what traditions teach, with sources.",
    };
  }

  // Retrieval (§8). Empty means decline - never lower the threshold.
  const retrieval = await retrieve({ query: q.query, traditions: q.traditions });
  if (retrieval.empty) {
    return {
      status: "insufficient",
      reason:
        "Concord has no sourced material above threshold for this question. It does not answer from memory.",
      refs: retrieval.refs,
      canonNotes: pre.canonNotes,
      insufficientTraditions: retrieval.insufficientTraditions,
    };
  }

  // Generation + firewall with the regeneration loop.
  const entailment = getEntailmentChecker();
  let retryNote: string | undefined;
  let hardFails = 0;
  let regenerations = 0;

  while (true) {
    const output = await generateSections(q.query, retrieval.chunks, { retryNote });

    if (!output.sufficient) {
      // Returning false is a success, not a failure (§9.3).
      return {
        status: "insufficient",
        reason:
          "The retrieved sources do not support an answer to this question.",
        refs: retrieval.refs,
        canonNotes: pre.canonNotes,
        insufficientTraditions: [
          ...new Set([
            ...retrieval.insufficientTraditions,
            ...(output.insufficient_for as Tradition[]),
          ]),
        ],
      };
    }

    const outcome = await runFirewall(output, retrieval.chunks, { entailment });

    if (outcome.status === "hard-fail") {
      hardFails += 1;
      regenerations += 1;
      if (hardFails >= MAX_HARD_FAILS) {
        return {
          status: "insufficient",
          reason:
            "Concord could not produce a fully verified answer from the available sources.",
          refs: retrieval.refs,
          canonNotes: pre.canonNotes,
          insufficientTraditions: retrieval.insufficientTraditions,
        };
      }
      retryNote = outcome.retryNote;
      continue;
    }

    const result: FirewallResult = { ...outcome.result, regenerations };
    await logCitations(q, result, retrieval.chunks.map((c) => c.csid)).catch(() => {
      // The audit log is evidence, not a render dependency; a logging outage
      // must not fail the study. Alerting on log gaps happens in ops (§14).
    });

    return {
      status: "answered",
      result,
      refs: retrieval.refs,
      canonNotes: pre.canonNotes,
      insufficientTraditions: [
        ...new Set([
          ...retrieval.insufficientTraditions,
          ...(output.insufficient_for as Tradition[]),
        ]),
      ],
    };
  }
}

/** concord_citation_log is the evidence that the 100% claim is true (§6). */
async function logCitations(
  q: ConcordQuery,
  result: FirewallResult,
  retrievedSet: string[],
): Promise<void> {
  const supabase = getSupabase();
  const studyId = q.studyId ?? randomUUID();
  const turnId = randomUUID();
  const rows = [];

  for (const section of result.rendered) {
    for (const claim of section.claims) {
      for (const csid of claim.csids) {
        rows.push({
          study_id: studyId,
          turn_id: turnId,
          csid,
          claim_text: claim.text,
          retrieved: retrievedSet.includes(csid),
          entailment: claim.entailment === "pass" ? "pass" : "partial",
          quote_verified: claim.quotation ? true : null,
          action: "rendered",
        });
      }
    }
  }
  for (const s of result.stripped) {
    for (const csid of s.claim.csids.length > 0 ? s.claim.csids : ["(none)"]) {
      rows.push({
        study_id: studyId,
        turn_id: turnId,
        csid,
        claim_text: s.claim.text,
        retrieved: retrievedSet.includes(csid),
        entailment: s.gate === 3 ? "fail" : "pass",
        quote_verified: s.gate === 2 ? false : null,
        action: s.gate === 1 || s.gate === 5 ? "regenerated" : "stripped",
      });
    }
  }

  if (rows.length > 0) {
    await supabase.from("concord_citation_log").insert(rows);
  }
}
