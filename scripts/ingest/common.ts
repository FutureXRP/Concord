/**
 * Shared ingest helpers: work upsert, chunk insert with normalization and
 * batched embeddings.
 */

import { getSupabase } from "../../lib/supabase/client";
import { getEmbedder } from "../../lib/concord/embed";
import { normalizeBodyForStorage } from "../../lib/concord/normalize";
import { isValidCSID } from "../../lib/concord/csid";
import type { Work } from "../../lib/concord/types";

/** Cheap token estimate for token_count; replace with a real tokenizer if needed. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export async function upsertWork(work: Work): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("concord_works").upsert(work);
  if (error) throw new Error(`upsert work ${work.id}: ${error.message}`);
}

export interface IngestChunk {
  csid: string;
  work_id: string;
  locator: string;
  body: string;
  source_type: string;
  stance: string;
  parent_csid?: string | null;
  prev_csid?: string | null;
  next_csid?: string | null;
  scripture_refs?: string[];
}

export async function insertChunks(
  chunks: IngestChunk[],
  { embed = true }: { embed?: boolean } = {},
): Promise<void> {
  const supabase = getSupabase();
  const embedder = embed ? getEmbedder() : null;
  const BATCH = 64;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    for (const c of batch) {
      if (!isValidCSID(c.csid)) {
        // A CSID that does not parse is a build-breaking error (§4.3).
        throw new Error(`Invalid CSID at ingest: ${c.csid}`);
      }
    }
    const embeddings = embedder
      ? await embedder.embed(batch.map((c) => c.body), "document")
      : batch.map(() => null);

    const rows = batch.map((c, j) => ({
      csid: c.csid,
      work_id: c.work_id,
      locator: c.locator,
      body: c.body,
      body_norm: normalizeBodyForStorage(c.body),
      token_count: estimateTokens(c.body),
      source_type: c.source_type,
      stance: c.stance,
      parent_csid: c.parent_csid ?? null,
      prev_csid: c.prev_csid ?? null,
      next_csid: c.next_csid ?? null,
      scripture_refs: c.scripture_refs ?? [],
      embedding: embeddings[j],
    }));

    const { error } = await supabase.from("concord_chunks").upsert(rows);
    if (error) throw new Error(`insert chunks batch ${i}: ${error.message}`);
    process.stdout.write(`\r${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }
  console.log();
}
