/**
 * Core types for Concord — the Comparative Traditions Layer.
 *
 * Constitutional rules (spec §1) these types encode:
 *  - Every claim carries at least one CSID (N2). The renderer has no code
 *    path for uncited text (Gate 4).
 *  - Quotations are byte-verified strings, never paraphrase (N3).
 *  - Critique is structurally separate from position (N7).
 */

export type LicenseTier = "A" | "B" | "C" | "D";

export type Tradition =
  | "catholic-roman"
  | "catholic-eastern"
  | "orthodox-eastern"
  | "orthodox-oriental"
  | "lutheran"
  | "reformed"
  | "anglican"
  | "anabaptist"
  | "baptist"
  | "methodist-wesleyan"
  | "pentecostal"
  | "holiness"
  | "restoration-movement"
  | "dispensational"
  | "patristic-undivided"
  | "judaism-second-temple"
  | "judaism-rabbinic"
  | "judaism-orthodox"
  | "judaism-conservative"
  | "judaism-reform"
  | "islam-sunni"
  | "islam-shia"
  | "nrm-lds"
  | "nrm-jw"
  | "nrm-christian-science"
  | "nrm-adventist"
  | "nrm-other"
  | "scholarly-critical"
  | "comparative-religion";

export type ComposedEra =
  | "second-temple"
  | "apostolic"
  | "ante-nicene"
  | "nicene"
  | "post-nicene"
  | "medieval"
  | "reformation"
  | "post-reformation"
  | "modern"
  | "contemporary";

/** How binding a source is within its own tradition. Drives retrieval ranking. */
export type AuthorityClass =
  | "scripture"
  | "ecumenical-definition"
  | "confessional-standard"
  | "magisterial"
  | "authoritative-teacher"
  | "representative-theologian"
  | "popular-expression"
  | "individual-opinion";

export type SourceType = "primary" | "secondary" | "scholarly" | "polemic" | "irenic";
export type Stance = "self-descriptive" | "critical" | "neutral";

export type CanonSet = "protestant" | "catholic" | "orthodox" | "tanakh";

/** A parsed Canonical Source ID (spec §4). */
export interface ParsedCSID {
  raw: string;
  domain: string;
  parts: string[];
}

export interface Chunk {
  csid: string;
  work_id: string;
  locator: string;
  body: string;
  body_norm: string;
  token_count: number;
  source_type: SourceType;
  stance: Stance;
  parent_csid: string | null;
  prev_csid: string | null;
  next_csid: string | null;
  scripture_refs: string[];
}

export interface Work {
  id: string;
  title: string;
  author: string | null;
  author_died_year: number | null;
  composed_year: number | null;
  composed_era: ComposedEra;
  tradition: Tradition;
  language_original: string | null;
  translator: string | null;
  license_tier: LicenseTier;
  license_note: string | null;
  source_url: string | null;
  embeddable: boolean;
  authority_class: AuthorityClass;
}

/** A retrieved chunk with the work metadata needed for prompt assembly. */
export interface RetrievedChunk extends Chunk {
  tradition: Tradition;
  authority_class: AuthorityClass;
  composed_era: ComposedEra;
  work_title: string;
  score: number;
}

/** Result of resolveCSID(): stored text, or an explicit tier C/D handle. */
export type ResolvedCSID =
  | { kind: "chunk"; chunk: Chunk; work: Work }
  | { kind: "proxy"; csid: string; translation: string; refNorm: string }
  | { kind: "describe-only"; csid: string; note: string }
  | { kind: "unresolved"; csid: string; reason: string };

// ---------- Generation contract (spec §9.3) ----------

/**
 * "sources" is emitted only by the deterministic standalone mode (no model
 * configured): verbatim excerpts grouped by tradition. The generation
 * contract never produces it.
 */
export type SectionType =
  | "consensus"
  | "position"
  | "divergence"
  | "critique"
  | "historical"
  | "sources";

export interface Quotation {
  csid: string;
  /** Verbatim, unmodified. Byte-verified by Gate 2 before render. */
  text: string;
}

export interface Claim {
  text: string;
  csids: string[];
  quotation: Quotation | null;
}

export interface Section {
  type: SectionType;
  tradition: Tradition | null;
  claims: Claim[];
}

export interface GenerationOutput {
  sufficient: boolean;
  sections: Section[];
  insufficient_for: string[];
}

// ---------- Firewall (spec §10) ----------

export interface StrippedClaim {
  claim: Claim;
  gate: number;
  reason: string;
}

export interface VerifiedClaim extends Claim {
  /** Gate 3 verdict; "pass" until Gate 3 lands in Phase 2. */
  entailment: "pass" | "partial";
}

export interface VerifiedSection {
  type: SectionType;
  tradition: Tradition | null;
  claims: VerifiedClaim[];
}

export interface FirewallResult {
  rendered: VerifiedSection[];
  stripped: StrippedClaim[];
  regenerations: number;
  /** rendered / (rendered + stripped). Below 1.0 on the golden set blocks release. */
  citationIntegrity: number;
}

// ---------- References ----------

export interface ScriptureRef {
  /** normalized: 'john:3.16' or 'rom:3.21-3.26' */
  refNorm: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number | null;
  endChapter: number | null;
  endVerse: number | null;
  canonSets: CanonSet[];
}

export type RefValidation =
  | { ok: true; ref: ScriptureRef; canonNote: string | null }
  | { ok: false; input: string; reason: string };
