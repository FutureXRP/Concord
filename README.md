# Concord

**Comparative Traditions Layer for PassageLab.** Mid-study, ask what any
tradition teaches about the passage or doctrine in front of you — and receive
an answer where **every single claim resolves to a real, retrievable,
verifiable source**.

The differentiator is not model quality. It is that **Concord cannot
fabricate a citation** — structurally:

> The model never writes a citation. The model selects from citations that
> were handed to it, and a deterministic validator destroys any output where
> that selection cannot be re-verified against source text.

Full spec: [`build.md`](./build.md). This repository implements **Phase 1
(Spine)** plus the Phase 2 firewall gates: CSID resolver, deterministic canon
validator, Supabase schema, hybrid retrieval, generation contract, the
Citation Fabrication Firewall (Gates 1–6), and the minimal "Across
Traditions" tab.

## Architecture

```
query
  └─ pre-flight (lib/concord/canon.ts)         deterministic: ref extraction,
  │                                            verse existence, canon-set notes,
  │                                            scope check — no LLM
  └─ retrieval (lib/concord/retrieve.ts)       dense (pgvector) + sparse (FTS)
  │                                            + exact scripture-ref containment,
  │                                            RRF fusion, tradition balance,
  │                                            authority boost; <3 chunks ⇒ EMPTY
  └─ generation (lib/concord/generate.ts)      structured JSON only, citations
  │                                            selected from injected <source>
  │                                            blocks; pluggable model backend
  │                                            (none / local LLM / Claude) via
  │                                            lib/concord/llm.ts - with no
  │                                            model, sources mode renders
  │                                            verbatim excerpts instead
  └─ firewall (lib/concord/firewall.ts)        Gate 1 CSID-set check (hard fail ⇒
  │                                            regenerate; 2 fails ⇒ decline)
  │                                            Gate 2 quotation byte-verification
  │                                            Gate 3 entailment (Haiku, isolated)
  │                                            Gate 4 uncited-claim sweep
  │                                            Gate 5 stance integrity
  └─ render (app/, components/concord/)        sections streamed as verified
                                               units (never tokens); every claim
                                               ends in citation chips that
                                               live-resolve on click (Gate 6)
```

## Getting started

Concord is **standalone by default** — no API, no keys, no database:

```bash
npm install
npm run dev        # http://localhost:3000
```

Out of the box it runs in **sources mode**: deterministic reference
validation, BM25 + exact-verse retrieval over the **checked-in public-domain
corpus** (`data/sources/` — the full KJV's 31,102 verses, the Westminster
Confession and both catechisms, the Heidelberg Catechism, Belgic Confession,
Canons of Dort, the 1689 London Baptist Confession, and the ecumenical
creeds: Apostles', Nicene 381, Athanasian, Chalcedonian Definition, Orange
529 — about 32,000 chunks), rendered as verbatim, byte-verified excerpts
with citation chips. Nothing is synthesized, so nothing can be fabricated.

### Optional: add a language model for synthesized comparisons

The model's only job is turning retrieved sources into neutral prose — the
citation guarantee lives in deterministic code either way.

**Local LLM (stays standalone — runs on your machine):**

```bash
ollama serve && ollama pull llama3.1   # or llama.cpp server / LM Studio
export CONCORD_LLM_BASE_URL=http://localhost:11434/v1
export CONCORD_LLM_MODEL=llama3.1
npm run dev
```

**Hosted Claude (best synthesis quality):**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Selection order: `CONCORD_LLM=none|local|anthropic` wins; otherwise local
when `CONCORD_LLM_BASE_URL` is set, Anthropic when `ANTHROPIC_API_KEY` is
set, else sources mode. Gate 3 entailment runs on whichever model is
configured.

### Production mode (Supabase + pgvector)

```bash
cp .env.example .env.local     # fill in Supabase + Anthropic + embeddings keys

# apply supabase/migrations/*.sql in order, then:
npm run build:canon            # seed concord_canon (31,102 verse rows)
npm run ingest -- kjv          # scripture corpus with embeddings
npm run ingest -- confessions  # confessional corpus with embeddings

npm run dev
```

## Verification

```bash
npm run typecheck
npm test                       # canon validator, CSID grammar, Gate 1–5 firewall,
                               # local corpus + retrieval tests
npm run eval -- adversarial    # zero-fabrication gate; deterministic cases run
                               # with no keys at all, model cases need
                               # ANTHROPIC_API_KEY
```

## Licensing invariants

- Public-domain / open-license text (Tier A/B): stored, embedded, quotable.
- Copyrighted translations (Tier C): **never stored** — proxied at render via
  `lib/youversion/proxy.ts` (Phase 5), with graceful public-domain fallback.
- Tier D (`data/corpus/tier-d.json`): described via secondary scholarship
  only; additions are a legal decision.
- A database trigger rejects any chunk whose work is not Tier A/B, and
  `concord_audit_restricted_text()` backs the scheduled compliance audit.
