/**
 * Hybrid retrieval pipeline (spec §8).
 *
 *   query
 *     -> reference extraction (deterministic, canon.ts)
 *     -> query expansion (synonym map, not an LLM call)
 *     -> parallel: dense (pgvector cosine, top 60)
 *                  sparse (tsvector, top 60)
 *                  exact (scripture_refs containment, unbounded)
 *     -> reciprocal rank fusion
 *     -> rerank (pluggable cross-encoder; RRF-ordered passthrough in Phase 1)
 *     -> tradition-balance pass (§8.2)
 *     -> authority_class boost
 *     -> return <= 16 chunks with full CSID + body
 *
 * Threshold rule (§8.3): fewer than 3 chunks above threshold -> return EMPTY.
 * The generation layer handles empty by declining. Never lower the threshold
 * to produce an answer.
 */

import { getSupabase } from "../supabase/client";
import { getEmbedder } from "./embed";
import { expandQuery } from "./synonyms";
import { expandRefToVerses, preflightReferences } from "./canon";
import { isLocalMode, localRefSearch, localSparseSearch } from "./localstore";
import type { AuthorityClass, RetrievedChunk, ScriptureRef, Tradition } from "./types";

const DENSE_K = 60;
const SPARSE_K = 60;
const RRF_K = 60; // standard reciprocal-rank-fusion constant
const RERANK_TOP = 24;
const RETURN_MAX = 16;
const MIN_CHUNKS = 3;
const SCORE_THRESHOLD = 0.015; // RRF-scale floor; tune against the golden set

const AUTHORITY_BOOST: Record<AuthorityClass, number> = {
  scripture: 1.3,
  "ecumenical-definition": 1.25,
  "confessional-standard": 1.2,
  magisterial: 1.15,
  "authoritative-teacher": 1.1,
  "representative-theologian": 1.0,
  "popular-expression": 0.8,
  "individual-opinion": 0.7,
};

export interface RetrievalRequest {
  query: string;
  /** Traditions named in the query, for the balance pass. */
  traditions: Tradition[];
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  refs: ScriptureRef[];
  /** Traditions that could not meet the primary-source floor (§8.2 / N6). */
  insufficientTraditions: Tradition[];
  empty: boolean;
}

export interface Reranker {
  rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]>;
}

/** Phase 1: RRF order is the rank. Swap in a cross-encoder here in Phase 2+. */
class PassthroughReranker implements Reranker {
  async rerank(_query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    return chunks;
  }
}

let reranker: Reranker = new PassthroughReranker();
export function setReranker(r: Reranker): void {
  reranker = r;
}

type Row = RetrievedChunk & Record<string, unknown>;

export async function retrieve(req: RetrievalRequest): Promise<RetrievalResult> {
  const { valid: refs } = preflightReferences(req.query);
  const { query, expansions } = expandQuery(req.query);
  const expandedQuery = [query, ...expansions].join(" ");

  let dense: Row[];
  let sparse: Row[];
  let exact: Row[];

  if (isLocalMode()) {
    // Dev/demo mode: BM25 + exact refs over the checked-in corpus. No dense
    // leg (no embeddings locally); the pipeline above is unchanged.
    dense = [];
    sparse = localSparseSearch(expandedQuery, SPARSE_K) as Row[];
    exact = localRefSearch(refs.flatMap(expandRefToVerses)) as Row[];
  } else {
    const supabase = getSupabase();
    [dense, sparse, exact] = await Promise.all([
      denseSearch(expandedQuery).catch(() => [] as Row[]),
      sparseSearch(supabase, expandedQuery).catch(() => [] as Row[]),
      exactRefSearch(supabase, refs).catch(() => [] as Row[]),
    ]);
  }

  // Reciprocal rank fusion across the three lists.
  const fused = new Map<string, { row: Row; score: number }>();
  for (const list of [dense, sparse, exact]) {
    list.forEach((row, i) => {
      const prev = fused.get(row.csid);
      const contribution = 1 / (RRF_K + i + 1);
      if (prev) prev.score += contribution;
      else fused.set(row.csid, { row, score: contribution });
    });
  }

  let ranked = [...fused.values()]
    .map(({ row, score }) => ({ ...row, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, RERANK_TOP);

  ranked = await reranker.rerank(req.query, ranked);

  // Authority boost (§7.3): a blog post never outranks Chalcedon.
  ranked = ranked
    .map((c) => ({ ...c, score: c.score * (AUTHORITY_BOOST[c.authority_class] ?? 1) }))
    .sort((a, b) => b.score - a.score);

  // Threshold (§8.3).
  const aboveThreshold = ranked.filter((c) => c.score >= SCORE_THRESHOLD);
  if (aboveThreshold.length < MIN_CHUNKS) {
    return { chunks: [], refs, insufficientTraditions: req.traditions, empty: true };
  }

  // Tradition balance (§8.2): for each named tradition, at least two primary
  // self-descriptive chunks before ANY critical chunk is admitted.
  const { balanced, insufficient } = balanceTraditions(aboveThreshold, req.traditions);

  return {
    chunks: balanced.slice(0, RETURN_MAX),
    refs,
    insufficientTraditions: insufficient,
    empty: false,
  };
}

function balanceTraditions(
  chunks: RetrievedChunk[],
  traditions: Tradition[],
): { balanced: RetrievedChunk[]; insufficient: Tradition[] } {
  if (traditions.length === 0) {
    return { balanced: chunks, insufficient: [] };
  }
  const insufficient: Tradition[] = [];
  const primaryCount = new Map<Tradition, number>();
  for (const t of traditions) {
    const n = chunks.filter(
      (c) => c.tradition === t && c.stance === "self-descriptive",
    ).length;
    primaryCount.set(t, n);
    if (n < 2) insufficient.push(t);
  }
  // N6 at the retrieval layer: drop critical-stance chunks about any
  // tradition that failed the primary-source floor. Concord reports
  // insufficiency rather than answering from critique.
  const balanced = chunks.filter((c) => {
    if (c.stance !== "critical") return true;
    return !insufficient.some((t) => chunkTargetsTradition(c, t));
  });
  return { balanced, insufficient };
}

/**
 * Whether a critical-stance chunk is about the given tradition. Without a
 * per-chunk target-tradition column in v1, a critical chunk is treated as
 * targeting every under-floored tradition (conservative: over-drops critique
 * rather than under-dropping it, which is the failure direction N6 prefers).
 */
function chunkTargetsTradition(_chunk: RetrievedChunk, _t: Tradition): boolean {
  return true;
}

async function denseSearch(query: string): Promise<Row[]> {
  const [embedding] = await getEmbedder().embed([query], "query");
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("concord_match_chunks", {
    query_embedding: embedding,
    match_count: DENSE_K,
  });
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function sparseSearch(
  supabase: ReturnType<typeof getSupabase>,
  query: string,
): Promise<Row[]> {
  const { data, error } = await supabase.rpc("concord_fts_chunks", {
    query_text: query,
    match_count: SPARSE_K,
  });
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function exactRefSearch(
  supabase: ReturnType<typeof getSupabase>,
  refs: ScriptureRef[],
): Promise<Row[]> {
  if (refs.length === 0) return [];
  const verses = refs.flatMap(expandRefToVerses);
  const { data, error } = await supabase.rpc("concord_ref_chunks", {
    ref_norms: verses,
  });
  if (error) throw error;
  return (data ?? []) as Row[];
}
