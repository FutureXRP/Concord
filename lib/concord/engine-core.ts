/**
 * Pure retrieval engine over corpus data — no filesystem, no network, no
 * framework. Runs identically in Node (lib/concord/localstore.ts feeds it
 * from data/sources/) and in the browser (lib/concord/browser/engine.ts
 * feeds it from fetched static assets), which is what makes the zero-cost
 * GitHub Pages build possible.
 */

import { normalizeBodyForStorage } from "./normalize";
import { extractReferences, buildRefNorm } from "./canon";
import type { RetrievedChunk, Work } from "./types";

export interface ConfessionChunkInput {
  csid: string;
  work_id: string;
  locator: string;
  body: string;
}

export interface CorpusInput {
  works: Work[];
  chunks: ConfessionChunkInput[];
  kjv: { books: Array<{ id: string; chapters: string[][] }> } | null;
}

const K1 = 1.2;
const B = 0.75;

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1);

export class CorpusIndex {
  chunks = new Map<string, RetrievedChunk>();
  works = new Map<string, Work>();
  private refIndex = new Map<string, string[]>();
  private docTokens = new Map<string, string[]>();
  private df = new Map<string, number>();
  private avgLen = 1;

  static build(input: CorpusInput): CorpusIndex {
    const idx = new CorpusIndex();
    const addRef = (ref: string, csid: string) => {
      const list = idx.refIndex.get(ref);
      if (list) list.push(csid);
      else idx.refIndex.set(ref, [csid]);
    };

    for (const w of input.works) idx.works.set(w.id, w);

    for (const c of input.chunks) {
      const work = idx.works.get(c.work_id);
      if (!work) throw new Error(`chunk ${c.csid}: no work ${c.work_id}`);
      const refs = extractReferences(c.body).map((r) =>
        buildRefNorm(r.book.id, r.chapter, r.verse, r.endChapter, r.endVerse),
      );
      for (const r of refs) addRef(r, c.csid);
      idx.chunks.set(c.csid, {
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

    if (input.kjv) {
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
      idx.works.set(kjvWork.id, kjvWork);

      for (const book of input.kjv.books) {
        book.chapters.forEach((verses, chIdx) => {
          verses.forEach((text, vIdx) => {
            const locator = `${chIdx + 1}.${vIdx + 1}`;
            const refNorm = `${book.id}:${locator}`;
            const csid = `scripture:kjv:${book.id}:${locator}`;
            addRef(refNorm, csid);
            idx.chunks.set(csid, {
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
    }

    let totalLen = 0;
    for (const [csid, chunk] of idx.chunks) {
      const tokens = tokenize(chunk.body);
      idx.docTokens.set(csid, tokens);
      totalLen += tokens.length;
      for (const t of new Set(tokens)) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
    }
    idx.avgLen = totalLen / Math.max(1, idx.chunks.size);
    return idx;
  }

  sparse(query: string, k: number): RetrievedChunk[] {
    const qTokens = [...new Set(tokenize(query))];
    const n = this.chunks.size;
    const scores = new Map<string, number>();
    for (const term of qTokens) {
      const dfT = this.df.get(term);
      if (!dfT) continue;
      const idf = Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5));
      for (const [csid, tokens] of this.docTokens) {
        let tf = 0;
        for (const t of tokens) if (t === term) tf++;
        if (tf === 0) continue;
        const norm = tf / (tf + K1 * (1 - B + (B * tokens.length) / this.avgLen));
        scores.set(csid, (scores.get(csid) ?? 0) + idf * norm);
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([csid, score]) => ({ ...this.chunks.get(csid)!, score }));
  }

  byRefs(refNorms: string[]): RetrievedChunk[] {
    const out: RetrievedChunk[] = [];
    const seen = new Set<string>();
    for (const ref of refNorms) {
      for (const csid of this.refIndex.get(ref) ?? []) {
        if (seen.has(csid)) continue;
        seen.add(csid);
        out.push({ ...this.chunks.get(csid)!, score: 1 });
      }
    }
    return out;
  }

  getChunk(csid: string): RetrievedChunk | null {
    return this.chunks.get(csid) ?? null;
  }

  getWork(id: string): Work | null {
    return this.works.get(id) ?? null;
  }
}

/**
 * Fuse sparse + exact result lists with reciprocal rank fusion, apply the
 * empty threshold, cap the return. Shared by the Node local store path and
 * the browser engine so both modes rank identically.
 */
export function fuseAndCap(
  lists: RetrievedChunk[][],
  {
    rrfK = 60,
    threshold = 0.015,
    minChunks = 3,
    cap = 16,
  }: { rrfK?: number; threshold?: number; minChunks?: number; cap?: number } = {},
): RetrievedChunk[] {
  const fused = new Map<string, { row: RetrievedChunk; score: number }>();
  for (const list of lists) {
    list.forEach((row, i) => {
      const contribution = 1 / (rrfK + i + 1);
      const prev = fused.get(row.csid);
      if (prev) prev.score += contribution;
      else fused.set(row.csid, { row, score: contribution });
    });
  }
  const ranked = [...fused.values()]
    .map(({ row, score }) => ({ ...row, score }))
    .sort((a, b) => b.score - a.score)
    .filter((c) => c.score >= threshold);
  if (ranked.length < minChunks) return [];
  return ranked.slice(0, cap);
}
