# Integrating Concord into PassageLab

Concord is designed to live **inside a PassageLab study** — an "Across
Traditions" tab alongside the existing study tabs (spec §11), free at every
tier. There are two supported integration paths. Path A matches the spec's
intent; Path B gets you live fastest without touching PassageLab's build.

---

## Path A — Module drop-in (recommended)

Concord becomes part of the PassageLab Next.js app. One deployment, no CORS,
shared styling.

**1. Copy these directories into the PassageLab repo** (they have no
dependencies on anything outside themselves):

```
lib/concord/            # the whole pipeline (canon -> retrieve -> generate -> firewall)
lib/supabase/           # server-side client (only used if Supabase is configured)
lib/youversion/         # proxy scaffold
components/concord/     # the tab UI
app/api/concord/        # the two route handlers (query, resolve)
data/canon/             # book table + verse counts (deterministic validator)
data/sources/           # checked-in public-domain corpus (~32k chunks)
data/corpus/ data/terms/
```

**2. Dependencies** — add to PassageLab's `package.json` if not present:
`@anthropic-ai/sdk` (optional, only for hosted-Claude mode),
`@supabase/supabase-js` (optional), `zod@^4`.

**3. Mount the tab** in the study screen:

```tsx
import { AcrossTraditions } from "@/components/concord";

// inside the study tab panel, when the "Across Traditions" tab is active:
<AcrossTraditions passage={study.passageDisplay} autoRun />
```

`passage` ("Romans 3:21-26") composes the default question; `autoRun` fires
it on mount so the tab is instantly populated. Users can then ask their own
questions.

**4. Environment** — nothing required. With no env vars Concord runs in
standalone sources mode (deterministic, verbatim excerpts). Add
`CONCORD_LLM_BASE_URL` (local LLM) or `ANTHROPIC_API_KEY` (hosted Claude)
to turn on synthesized comparisons. See `.env.example`.

**5. Styling** — `app/globals.css` sections under `.section-card`, `.chip`,
`.slide-over`, `.insufficiency` are the Concord styles; move them into
PassageLab's stylesheet (or convert to your utility classes). Class names
are stable and self-contained.

---

## Path B — Service mode (Concord deployed separately)

Deploy this repo as-is (Vercel works out of the box) and let PassageLab call
it cross-origin.

**On the Concord deployment:**

```
CONCORD_ALLOWED_ORIGINS=https://passagelab.app,https://www.passagelab.app
# plus whichever model/database env you want (or none for sources mode)
```

**In PassageLab** — either consume the API directly, or copy just
`components/concord/` and wrap with the provider:

```tsx
import { ConcordProvider, AcrossTraditions } from "@/components/concord";

<ConcordProvider apiBaseUrl="https://concord.your-domain.app">
  <AcrossTraditions passage={study.passageDisplay} autoRun />
</ConcordProvider>
```

Alternative without CORS: proxy through PassageLab's own origin with a
Next.js rewrite, and skip `CONCORD_ALLOWED_ORIGINS` entirely:

```js
// passagelab next.config.js
async rewrites() {
  return [{ source: "/api/concord/:path*",
            destination: "https://concord.your-domain.app/api/concord/:path*" }];
}
```

---

## The API surface (for a custom PassageLab UI)

If PassageLab wants its own rendering instead of the bundled components:

### `POST /api/concord/query`

Body: `{ "query": string, "traditions": string[], "studyId"?: uuid }`

Server-sent events, **sections streamed as verified units** (never tokens):

| event | payload |
|---|---|
| `meta` | `{ status, mode: "synthesized"\|"sources", refs, canonNotes, insufficientTraditions }` |
| `section` | `{ type, tradition, claims: [{ text, csids, quotation, entailment }] }` |
| `insufficient` | `{ reason, insufficientTraditions }` — first-class state, style as information |
| `invalid` | `{ problems: [{ input, reason }] }` — fabricated/nonexistent reference |
| `out-of-scope` | `{ reason }` — pastoral intent, route back to core PassageLab |
| `done` | `{ citationIntegrity, regenerations, strippedCount }` |

### `GET /api/concord/resolve?csid=...&translation=...`

Gate 6: resolves a citation chip to full source text + work metadata (or a
Tier C proxy handle / Tier D describe-only note). Render every claim with
its chips; a chip that fails to resolve must render in an error state.

**Contract for host UIs:** no claim renders without at least one chip. That
invariant is the product.

---

## Deciding between the paths

| | Path A (module) | Path B (service) |
|---|---|---|
| Deploys | one | two |
| CORS | none | needed (or rewrite proxy) |
| Corpus in host repo | yes (~7 MB) | no |
| Version coupling | moves with PassageLab | independent release cadence |
| Spec §11 fidelity | exact | close |

Start with B if you want zero churn in the PassageLab repo this week; land
on A when the tab becomes a first-class study feature.
