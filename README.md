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
  └─ generation (lib/concord/generate.ts)      Claude Opus 5, structured JSON only,
  │                                            citations selected from injected
  │                                            <source> blocks
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

```bash
npm install
cp .env.example .env.local     # fill in Supabase + Anthropic + embeddings keys

# Database (Supabase with pgvector):
#   apply supabase/migrations/*.sql in order, then:
npm run build:canon            # seed concord_canon (31,102 verse rows)
npm run ingest -- kjv          # Phase 1 scripture corpus
npm run ingest -- westminster  # Westminster Shorter Catechism

npm run dev                    # http://localhost:3000
```

Without env configuration the app still runs; queries return the
insufficiency state (which is itself a first-class, honest UI state — spec
§11).

## Verification

```bash
npm run typecheck
npm test                       # canon validator, CSID grammar, Gate 1–5 firewall tests
npm run eval -- adversarial    # zero-fabrication gate (needs full env)
```

## Licensing invariants

- Public-domain / open-license text (Tier A/B): stored, embedded, quotable.
- Copyrighted translations (Tier C): **never stored** — proxied at render via
  `lib/youversion/proxy.ts` (Phase 5), with graceful public-domain fallback.
- Tier D (`data/corpus/tier-d.json`): described via secondary scholarship
  only; additions are a legal decision.
- A database trigger rejects any chunk whose work is not Tier A/B, and
  `concord_audit_restricted_text()` backs the scheduled compliance audit.
