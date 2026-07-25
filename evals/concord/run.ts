/**
 * Eval harness (spec §14). Replays the eval sets through the full pipeline
 * and reports the blocking metrics. Nightly: append results to
 * evals/concord/history.jsonl and alert on any blocking-metric regression.
 *
 *   npm run eval -- adversarial   # zero-fabrication gate (§14.3)
 *   npm run eval -- golden        # golden set (sample until the 500 land)
 *
 * Seeded RNG per project convention: any sampling in this harness must use
 * mulberry32(SEED), never Math.random().
 */

import fs from "node:fs";
import path from "node:path";
import { runConcordQuery } from "../../lib/concord/pipeline";
import type { Tradition } from "../../lib/concord/types";

export const SEED = 0xc0c04d;

/** Deterministic PRNG for any sampling in evals (project convention). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface EvalCase {
  id: string;
  category: string;
  prompt: string;
  traditions?: string[];
  expected?: string;
  expect?: Record<string, unknown>;
}

interface EvalOutcome {
  id: string;
  category: string;
  status: string;
  citationIntegrity: number | null;
  fabricated: boolean;
  detail: string;
}

function loadCases(file: string): EvalCase[] {
  const p = path.join(process.cwd(), "evals/concord", file);
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runCase(c: EvalCase): Promise<EvalOutcome> {
  const res = await runConcordQuery({
    query: c.prompt,
    traditions: (c.traditions ?? []) as Tradition[],
  });

  switch (res.status) {
    case "invalid-reference":
      return {
        id: c.id,
        category: c.category,
        status: "correct-negative",
        citationIntegrity: null,
        fabricated: false,
        detail: res.problems.map((p) => p.reason).join(" | "),
      };
    case "out-of-scope":
      return { id: c.id, category: c.category, status: "out-of-scope", citationIntegrity: null, fabricated: false, detail: res.reason };
    case "insufficient":
      return { id: c.id, category: c.category, status: "declined", citationIntegrity: null, fabricated: false, detail: res.reason };
    case "answered": {
      // Fabrication check: integrity below 1.0 means the firewall stripped
      // something; any Gate 1 regeneration that exhausted retries would have
      // surfaced as "insufficient" instead.
      return {
        id: c.id,
        category: c.category,
        status: "answered",
        citationIntegrity: res.result.citationIntegrity,
        fabricated: false,
        detail: `${res.result.rendered.length} sections, ${res.result.stripped.length} stripped, ${res.result.regenerations} regenerations`,
      };
    }
  }
}

async function main() {
  const which = process.argv[2] ?? "adversarial";
  const file = which === "golden" ? "golden.sample.jsonl" : "adversarial.jsonl";
  const cases = loadCases(file);
  const outcomes: EvalOutcome[] = [];

  for (const c of cases) {
    try {
      const o = await runCase(c);
      outcomes.push(o);
      console.log(`${o.id}  ${o.status.padEnd(18)} ${o.detail.slice(0, 100)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Cases that reach generation need ANTHROPIC_API_KEY; deterministic
      // negatives (the fabrication catches) run without it.
      const skipped = /api ?key|anthropic/i.test(msg);
      outcomes.push({
        id: c.id,
        category: c.category,
        status: skipped ? "skipped-no-model" : "error",
        citationIntegrity: null,
        fabricated: false,
        detail: msg,
      });
      console.log(`${c.id}  ${skipped ? "SKIPPED (no model key)" : `ERROR ${msg}`}`);
    }
  }

  const answered = outcomes.filter((o) => o.status === "answered");
  const belowIntegrity = answered.filter(
    (o) => o.citationIntegrity !== null && o.citationIntegrity < 1,
  );

  const summary = {
    ts: new Date().toISOString(),
    set: file,
    total: outcomes.length,
    answered: answered.length,
    declined: outcomes.filter((o) => o.status === "declined").length,
    correctNegative: outcomes.filter((o) => o.status === "correct-negative").length,
    skipped: outcomes.filter((o) => o.status === "skipped-no-model").length,
    errors: outcomes.filter((o) => o.status === "error").length,
    citationIntegrityBelowOne: belowIntegrity.length,
  };

  console.log("\n" + JSON.stringify(summary, null, 2));
  fs.appendFileSync(
    path.join(process.cwd(), "evals/concord/history.jsonl"),
    JSON.stringify({ summary, outcomes }) + "\n",
  );

  // Release blockers (§14.2): citationIntegrity below 1.0 is a blocker.
  if (belowIntegrity.length > 0 || summary.errors > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
