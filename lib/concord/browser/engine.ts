/**
 * Browser engine — powers the fully static build (GitHub Pages).
 *
 * The corpus is fetched once from /corpus/* static assets, decompressed
 * with the native DecompressionStream, and indexed with the same pure
 * CorpusIndex the Node local store uses. The whole standalone pipeline -
 * deterministic pre-flight, BM25 + exact-ref retrieval, sources-mode answer
 * building, Gate 6 chip resolution - runs in the visitor's browser.
 *
 * Zero servers, zero API keys, zero per-query cost.
 */

import { CorpusIndex, fuseAndCap, type CorpusInput } from "../engine-core";
import { preflightReferences, expandRefToVerses } from "../canon";
import { expandQuery } from "../synonyms";
import { buildSourcesResult } from "../sources";
import {
  buildDoctrineResult,
  buildSayingResult,
  matchDoctrine,
  matchSaying,
  type SayingNote,
} from "../curated";
import type { FirewallResult, ScriptureRef } from "../types";

const SPARSE_K = 60;

function basePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

let indexPromise: Promise<CorpusIndex> | null = null;

async function gunzip(buf: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(new Blob([buf]).stream().pipeThrough(ds));
  return await stream.text();
}

export function loadBrowserIndex(): Promise<CorpusIndex> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const [confRes, kjvRes] = await Promise.all([
      fetch(`${basePath()}/corpus/confessions-corpus.json`),
      fetch(`${basePath()}/corpus/kjv-corpus.json.gz`),
    ]);
    if (!confRes.ok) throw new Error(`corpus fetch failed: ${confRes.status}`);
    if (!kjvRes.ok) throw new Error(`kjv corpus fetch failed: ${kjvRes.status}`);
    const conf = (await confRes.json()) as {
      works: CorpusInput["works"];
      chunks: CorpusInput["chunks"];
    };
    const kjv = JSON.parse(await gunzip(await kjvRes.arrayBuffer())) as NonNullable<
      CorpusInput["kjv"]
    >;
    return CorpusIndex.build({ works: conf.works, chunks: conf.chunks, kjv });
  })();
  return indexPromise;
}

// ---------- Query (mirrors pipeline.ts's standalone path) ----------

export type ClientQueryResult =
  | {
      status: "answered";
      mode: "sources" | "curated";
      result: FirewallResult;
      refs: ScriptureRef[];
      canonNotes: string[];
      insufficientTraditions: string[];
      doctrineLabel?: string;
      sayingNote?: SayingNote;
    }
  | { status: "insufficient"; reason: string; canonNotes: string[] }
  | { status: "invalid-reference"; problems: Array<{ input: string; reason: string }> };

export async function clientQuery(query: string): Promise<ClientQueryResult> {
  const pre = preflightReferences(query);
  if (pre.invalid.length > 0) {
    return { status: "invalid-reference", problems: pre.invalid };
  }

  const idx = await loadBrowserIndex();
  const resolveChunk = (csid: string) => idx.getChunk(csid);

  const saying = matchSaying(query);
  if (saying) {
    const { note, result } = buildSayingResult(saying, resolveChunk);
    return {
      status: "answered",
      mode: "curated",
      sayingNote: note,
      result,
      refs: pre.valid,
      canonNotes: pre.canonNotes,
      insufficientTraditions: [],
    };
  }

  const doctrine = matchDoctrine(query);
  if (doctrine) {
    const result = buildDoctrineResult(doctrine, resolveChunk);
    if (result) {
      return {
        status: "answered",
        mode: "curated",
        doctrineLabel: doctrine.label,
        result,
        refs: pre.valid,
        canonNotes: pre.canonNotes,
        insufficientTraditions: [],
      };
    }
  }

  const { query: q, expansions } = expandQuery(query);
  const expandedQuery = [q, ...expansions].join(" ");

  const sparse = idx.sparse(expandedQuery, SPARSE_K);
  const exact = idx.byRefs(pre.valid.flatMap(expandRefToVerses));
  const chunks = fuseAndCap([sparse, exact]);

  if (chunks.length === 0) {
    return {
      status: "insufficient",
      reason:
        "Concord has no sourced material above threshold for this question. It does not answer from memory.",
      canonNotes: pre.canonNotes,
    };
  }

  return {
    status: "answered",
    mode: "sources",
    result: buildSourcesResult(chunks),
    refs: pre.valid,
    canonNotes: pre.canonNotes,
    insufficientTraditions: [],
  };
}

// ---------- Gate 6 resolution (mirrors /api/concord/resolve) ----------

export interface ClientResolved {
  kind: "chunk" | "unresolved";
  csid: string;
  body?: string;
  locator?: string;
  reason?: string;
  /** Scripture this source cites, as resolvable scripture CSIDs. */
  restsOn?: string[];
  /** For a verse: confession/creed chunks that cite it. */
  citedBy?: Array<{ csid: string; label: string }>;
  work?: {
    id: string;
    title: string;
    author: string | null;
    translator: string | null;
    composed_era: string;
    composed_year: number | null;
    tradition: string;
    authority_class: string;
    license_tier: string;
    source_url: string | null;
  };
}

const CITED_BY_MAX = 12;

export async function clientResolve(csid: string): Promise<ClientResolved> {
  const idx = await loadBrowserIndex();
  const chunk = idx.getChunk(csid);
  if (!chunk) return { kind: "unresolved", csid, reason: "not in the local corpus" };
  const work = idx.getWork(chunk.work_id);
  if (!work) return { kind: "unresolved", csid, reason: "work record missing" };

  const isScripture = chunk.authority_class === "scripture";
  const restsOn = isScripture
    ? undefined
    : chunk.scripture_refs
        .map((ref) => `scripture:kjv:${ref.split("-")[0]}`)
        .filter((c) => idx.getChunk(c) !== null)
        .slice(0, CITED_BY_MAX);
  const citedBy = isScripture
    ? idx
        .citedBy(chunk.scripture_refs)
        .slice(0, CITED_BY_MAX)
        .map((c) => ({ csid: c.csid, label: `${c.work_title}, ${c.locator}` }))
    : undefined;

  return {
    kind: "chunk",
    csid,
    body: chunk.body,
    locator: chunk.locator,
    restsOn,
    citedBy,
    work: {
      id: work.id,
      title: work.title,
      author: work.author,
      translator: work.translator,
      composed_era: work.composed_era,
      composed_year: work.composed_year,
      tradition: work.tradition,
      authority_class: work.authority_class,
      license_tier: work.license_tier,
      source_url: work.source_url,
    },
  };
}
