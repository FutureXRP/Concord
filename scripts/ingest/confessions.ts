/**
 * Confessions / creeds ingest (Tier A, Phases 1+3). Pushes the checked-in
 * public-domain corpus (data/sources/confessions-corpus.json — Westminster
 * standards, Heidelberg, Belgic, Dort, 1689, ecumenical creeds) into
 * Supabase with embeddings. The same file backs local/demo mode.
 */

import fs from "node:fs";
import path from "node:path";
import { extractReferences, buildRefNorm } from "../../lib/concord/canon";
import { insertChunks, upsertWork } from "./common";
import { manifestEntry } from "./index";
import type { Work } from "../../lib/concord/types";

const SOURCE_FILE = path.join(process.cwd(), "data/sources/confessions-corpus.json");

export async function ingestConfessions(): Promise<void> {
  const { works, chunks } = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8")) as {
    works: Work[];
    chunks: Array<{ csid: string; work_id: string; locator: string; body: string }>;
  };

  for (const work of works) {
    manifestEntry(work.id);
    await upsertWork(work);
  }

  const rows = chunks.map((c, i) => {
    const refs = extractReferences(c.body).map((r) =>
      buildRefNorm(r.book.id, r.chapter, r.verse, r.endChapter, r.endVerse),
    );
    const prev = i > 0 && chunks[i - 1].work_id === c.work_id ? chunks[i - 1].csid : null;
    const next =
      i < chunks.length - 1 && chunks[i + 1].work_id === c.work_id ? chunks[i + 1].csid : null;
    return {
      csid: c.csid,
      work_id: c.work_id,
      locator: c.locator,
      body: c.body,
      source_type: "primary",
      stance: "self-descriptive",
      prev_csid: prev,
      next_csid: next,
      scripture_refs: refs,
    };
  });

  console.log(`Confessions corpus: ${works.length} works, ${rows.length} chunks`);
  await insertChunks(rows);
  console.log("done");
}
