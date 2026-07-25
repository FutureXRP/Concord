/**
 * Ingest entrypoint (Phase 1 corpus, spec §15).
 *
 *   npm run ingest -- kjv          # KJV scripture, verse-level chunks
 *   npm run ingest -- westminster  # Westminster Shorter Catechism
 *
 * Every ingester enforces the licensing invariant: only manifest entries
 * with tier A or B are ever stored (the DB trigger backstops this).
 */

import manifest from "../../data/corpus/manifest.json";
import { ingestKJV } from "./scripture-kjv";
import { ingestWestminsterShorter } from "./westminster";

export function manifestEntry(workId: string) {
  const entry = (manifest.entries as Array<{ work_id: string; tier: string }>).find(
    (e) => e.work_id === workId || workId.startsWith(e.work_id + ":") || workId.startsWith(e.work_id),
  );
  if (!entry) throw new Error(`No manifest entry for ${workId}; record license tier before ingest (spec §5).`);
  if (entry.tier !== "A" && entry.tier !== "B") {
    throw new Error(`${workId} is tier ${entry.tier}; tier C/D text is never stored (N5).`);
  }
  return entry;
}

const targets: Record<string, () => Promise<void>> = {
  kjv: ingestKJV,
  westminster: ingestWestminsterShorter,
};

async function main() {
  const which = process.argv[2];
  const run = targets[which];
  if (!run) {
    console.error(`Usage: npm run ingest -- <${Object.keys(targets).join("|")}>`);
    process.exit(1);
  }
  await run();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
