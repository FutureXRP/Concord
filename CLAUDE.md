# Concord — project conventions

Concord is the Comparative Traditions Layer for PassageLab. The build spec is
`build.md`; read §0–§1 before changing anything.

## Non-negotiables (constitutional — never trade away)

- Zero retrieval → zero claim. Concord never reasons from parametric memory.
- Every factual sentence carries a resolvable CSID; uncited sentences are
  stripped before render, not flagged.
- Quotations are byte-verified against stored source text.
- Tier C/D text is never stored, embedded, or logged (DB trigger enforces it).
- A tradition's teaching is sourced to its own primary literature; critique is
  structurally separate and labeled.
- Concord has no opinion and no first person.

## Engineering conventions

- Complete file replacements over surgical patches.
- One batch commit per session.
- Deterministic code for all validation; the LLM handles language only.
  Reference validity, canon membership, verse existence, and quote matching
  are pure code (`lib/concord/canon.ts`, `lib/concord/normalize.ts`).
- Fabrication firewall discipline: `lib/concord/firewall.ts` (spec §10) is the
  canonical implementation; no bypass flag, no dev override that ships.
- Seeded RNG wherever sampling occurs in evals (`mulberry32` in
  `evals/concord/run.ts`).
- Banned words in generated copy: obviously, clearly, simply, merely, just,
  heretical (narrator voice), cult (narrator voice). See
  `data/terms/preferred.json`.
- No em dashes in audio-synced content.
- Stack: Next.js App Router · Supabase (pgvector) · Vercel · Anthropic API.

## Layout

- `lib/concord/` — pipeline: canon → retrieve → generate → firewall.
- `data/canon/books.json` — the single source of truth for book
  abbreviations. No ad-hoc abbreviations anywhere else.
- `supabase/migrations/` — schema + retrieval RPCs.
- `scripts/` — canon seeding and corpus ingest (license tier checked first).
- `evals/concord/` — eval harness; blocking metrics in spec §14.2.

## Commands

- `npm run typecheck` · `npm test` · `npm run build`
- `npm run build:canon` — seed concord_canon (needs Supabase env)
- `npm run ingest -- kjv|westminster` — Phase 1 corpus
- `npm run eval -- adversarial|golden` — needs full env
