/**
 * Local corpus store — dev/demo mode (Node side).
 *
 * When Supabase is not configured (or CONCORD_LOCAL=1), retrieval and CSID
 * resolution run against the checked-in public-domain corpus:
 *
 *   data/sources/confessions-corpus.json  (Westminster standards, Heidelberg,
 *     Belgic, Dort, 1689, ecumenical creeds - 931 chunks)
 *   data/sources/kjv-corpus.json.gz       (full KJV, 31,102 verse chunks)
 *
 * The index itself is pure (lib/concord/engine-core.ts) and shared with the
 * browser engine that powers the static GitHub Pages build. This module is
 * only the filesystem loader plus the mode switch.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { CorpusIndex, type CorpusInput } from "./engine-core";
import type { RetrievedChunk, Work } from "./types";

export function isLocalMode(): boolean {
  if (process.env.CONCORD_LOCAL === "1") return true;
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

let index: CorpusIndex | null = null;

function loadIndex(): CorpusIndex {
  if (index) return index;
  const root = process.cwd();

  const conf = JSON.parse(
    fs.readFileSync(path.join(root, "data/sources/confessions-corpus.json"), "utf8"),
  ) as { works: Work[]; chunks: CorpusInput["chunks"] };

  const kjv = JSON.parse(
    zlib
      .gunzipSync(fs.readFileSync(path.join(root, "data/sources/kjv-corpus.json.gz")))
      .toString("utf8"),
  ) as NonNullable<CorpusInput["kjv"]>;

  index = CorpusIndex.build({ works: conf.works, chunks: conf.chunks, kjv });
  return index;
}

export function localSparseSearch(query: string, k: number): RetrievedChunk[] {
  return loadIndex().sparse(query, k);
}

export function localRefSearch(refNorms: string[]): RetrievedChunk[] {
  return loadIndex().byRefs(refNorms);
}

export function localGetChunk(csid: string): RetrievedChunk | null {
  return loadIndex().getChunk(csid);
}

export function localGetWork(id: string): Work | null {
  return loadIndex().getWork(id);
}

/** Test seam / memory release. */
export function _resetLocalIndex(): void {
  index = null;
}
