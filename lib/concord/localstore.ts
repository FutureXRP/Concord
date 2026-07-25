/**
 * Local corpus store — dev/demo mode.
 *
 * When Supabase is not configured (or CONCORD_LOCAL=1), retrieval and CSID
 * resolution run against the checked-in public-domain corpus:
 *
 *   data/sources/confessions-corpus.json  (Westminster standards, Heidelberg,
 *     Belgic, Dort, 1689, ecumenical creeds - 931 chunks)
 *   data/sources/kjv-corpus.json.gz       (full KJV, 31,102 verse chunks)
 *
 * Sparse search is BM25 in-process; dense search is skipped (no embeddings
 * locally); exact scripture-ref search uses the same refNorm scheme as the
 * concord_ref_chunks RPC. The firewall pipeline above this layer is
 * identical in both modes - the citation guarantee does not depend on which
 * store served the chunks.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { normalizeBodyForStorage } from "./normalize";
import { extractReferences, buildRefNorm } from "./canon";
import type { RetrievedChunk, Work } from "./types";

export function isLocalMode(): boolean {
  if (process.env.CONCORD_LOCAL === "1") return true;
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

interface LocalIndex {
  chunks: Map<string, RetrievedChunk>;
  works: Map<string, Work>;
  refIndex: Map<string, string[]>;
  // BM25
  docTokens: Map<string, string[]>;
  df: Map<string, number>;
  avgLen: number;
}

let index: LocalIndex | null = null;

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1);

function loadIndex(): LocalIndex {
  if (index) return index;

  const chunks = new Map<string, RetrievedChunk>();
  const works = new Map<string, Work>();
  const refIndex = new Map<string, string[]>();

  const addRef = (ref: string, csid: string) => {
    const list = refIndex.get(ref);
    if (list) list.push(csid);
    else refIndex.set(ref, [csid]);
  };

  const root = process.cwd();

  // ---- Confessions / creeds ----
  const conf = JSON.parse(
    fs.readFileSync(path.join(root, "data/sources/confessions-corpus.json"), "utf8"),
  ) as {
    works: Work[];
    chunks: Array<{ csid: string; work_id: string; locator: string; body: string }>;
  };
  for (const w of conf.works) works.set(w.id, w);
  for (const c of conf.chunks) {
    const work = works.get(c.work_id)!;
    const refs = extractReferences(c.body).map((r) =>
      buildRefNorm(r.book.id, r.chapter, r.verse, r.endChapter, r.endVerse),
    );
    for (const r of refs) addRef(r, c.csid);
    chunks.set(c.csid, {
      csid: c.csid,
      work_id: c.work_id,
      locator: c.locator,
      body: c.body,
      body_norm: normalizeBodyForStorage(c.body),
      token_count: Math.ceil(c.body.length / 4),
      source_type: "primary",
      stance: "self-descriptive",
      parent_csid: null,
      prev_csid: null,
      next_csid: null,
      scripture_refs: refs,
      tradition: work.tradition,
      authority_class: work.authority_class,
      composed_era: work.composed_era,
      work_title: work.title,
      score: 0,
    });
  }

  // ---- KJV ----
  const kjvWork: Work = {
    id: "scripture:kjv",
    title: "King James Version",
    author: null,
    author_died_year: null,
    composed_year: 1611,
    composed_era: "post-reformation",
    tradition: "patristic-undivided",
    language_original: "en",
    translator: "KJV translation committees",
    license_tier: "A",
    license_note: "Public domain (outside the UK).",
    source_url: "https://github.com/aruljohn/Bible-kjv",
    embeddable: true,
    authority_class: "scripture",
  };
  works.set(kjvWork.id, kjvWork);

  const kjvPath = path.join(root, "data/sources/kjv-corpus.json.gz");
  const kjv = JSON.parse(zlib.gunzipSync(fs.readFileSync(kjvPath)).toString("utf8")) as {
    books: Array<{ id: string; chapters: string[][] }>;
  };
  for (const book of kjv.books) {
    book.chapters.forEach((verses, chIdx) => {
      verses.forEach((text, vIdx) => {
        const locator = `${chIdx + 1}.${vIdx + 1}`;
        const refNorm = `${book.id}:${locator}`;
        const csid = `scripture:kjv:${book.id}:${locator}`;
        addRef(refNorm, csid);
        chunks.set(csid, {
          csid,
          work_id: "scripture:kjv",
          locator,
          body: text,
          body_norm: normalizeBodyForStorage(text),
          token_count: Math.ceil(text.length / 4),
          source_type: "primary",
          stance: "neutral",
          parent_csid: null,
          prev_csid: null,
          next_csid: null,
          scripture_refs: [refNorm],
          tradition: "patristic-undivided",
          authority_class: "scripture",
          composed_era: "post-reformation",
          work_title: "King James Version",
          score: 0,
        });
      });
    });
  }

  // ---- BM25 index ----
  const docTokens = new Map<string, string[]>();
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const [csid, chunk] of chunks) {
    const tokens = tokenize(chunk.body);
    docTokens.set(csid, tokens);
    totalLen += tokens.length;
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  index = {
    chunks,
    works,
    refIndex,
    docTokens,
    df,
    avgLen: totalLen / Math.max(1, chunks.size),
  };
  return index;
}

const K1 = 1.2;
const B = 0.75;

export function localSparseSearch(query: string, k: number): RetrievedChunk[] {
  const idx = loadIndex();
  const qTokens = [...new Set(tokenize(query))];
  const n = idx.chunks.size;
  const scores = new Map<string, number>();

  for (const term of qTokens) {
    const dfT = idx.df.get(term);
    if (!dfT) continue;
    const idf = Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5));
    for (const [csid, tokens] of idx.docTokens) {
      let tf = 0;
      for (const t of tokens) if (t === term) tf++;
      if (tf === 0) continue;
      const norm = tf / (tf + K1 * (1 - B + (B * tokens.length) / idx.avgLen));
      scores.set(csid, (scores.get(csid) ?? 0) + idf * norm);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([csid, score]) => ({ ...idx.chunks.get(csid)!, score }));
}

export function localRefSearch(refNorms: string[]): RetrievedChunk[] {
  const idx = loadIndex();
  const out: RetrievedChunk[] = [];
  const seen = new Set<string>();
  for (const ref of refNorms) {
    for (const csid of idx.refIndex.get(ref) ?? []) {
      if (seen.has(csid)) continue;
      seen.add(csid);
      out.push({ ...idx.chunks.get(csid)!, score: 1 });
    }
  }
  return out;
}

export function localGetChunk(csid: string): RetrievedChunk | null {
  return loadIndex().chunks.get(csid) ?? null;
}

export function localGetWork(id: string): Work | null {
  return loadIndex().works.get(id) ?? null;
}

/** Test seam / memory release. */
export function _resetLocalIndex(): void {
  index = null;
}
