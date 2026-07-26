"use client";

/**
 * Find — the discovery layer, fully in the browser.
 *
 * Describe what you need ("feeling abandoned", "forgiving someone", a saying
 * you heard) and deterministic BM25 over all 31,102 KJV verses merges the
 * hits into passage suggestions. The sayings database answers "is that
 * actually in the Bible?" with a verdict and documented origin.
 *
 * Below it, the reference checker demos the Trust Layer: paste anything and
 * every scripture reference in it is validated against the canon tables —
 * real ones open to their verbatim text, fabricated ones are flagged with
 * the precise reason.
 */

import React, { useState } from "react";
import { clientFind, clientVerses, type ClientFindResult, type ClientVerses } from "@/lib/concord/browser/engine";
import { scanRefs, type ScannedRef } from "@/lib/concord/trust";
import { lookupBook } from "@/lib/concord/canon";

const VERDICT_LABEL: Record<string, string> = {
  "not-in-scripture": "Not in scripture",
  misattributed: "Misattributed",
  paraphrase: "Popular paraphrase",
};

function prettyRefNorm(refNorm: string): string {
  const m = refNorm.match(/^([a-z0-9]+):(\d+)(?:\.(\d+))?/);
  if (!m) return refNorm;
  const name = lookupBook(m[1])?.name ?? m[1];
  return `${name} ${m[2]}${m[3] ? ":" + m[3] : ""}`;
}

function VerseBlock({ data }: { data: ClientVerses }) {
  if (!data.ok) return <p className="insufficiency">{data.reason}</p>;
  return (
    <blockquote className="verse-block">
      {data.verses.map((v) => (
        <p key={v.refNorm}>
          <sup>{v.verse.split(":")[1] ?? v.verse}</sup> {v.text}
        </p>
      ))}
      {data.verses.length === 0 && <p>{data.canonNote ?? "Text not in the free corpus yet."}</p>}
      {data.truncated > 0 && <p className="atlas-note">…and {data.truncated} more verses.</p>}
    </blockquote>
  );
}

function SuggestionCard({
  s,
  onOpenAtlas,
  onMemorize,
}: {
  s: { label: string; preview: string; verseCount: number };
  onOpenAtlas: (ref: string) => void;
  onMemorize: (ref: string) => void;
}) {
  const [verses, setVerses] = useState<ClientVerses | null>(null);
  const [memorized, setMemorized] = useState(false);

  return (
    <div className="section-card">
      <div className="suggestion-head">
        <h3>{s.label}</h3>
        <span className="atlas-note">
          {s.verseCount} matching verse{s.verseCount === 1 ? "" : "s"}
        </span>
      </div>
      <blockquote className="verse-block">
        <p>{s.preview}</p>
      </blockquote>
      <div className="suggestion-actions">
        <button
          type="button"
          onClick={() => (verses ? setVerses(null) : clientVerses(s.label).then(setVerses))}
        >
          {verses ? "Hide the text" : "Read it"}
        </button>
        <button type="button" onClick={() => onOpenAtlas(s.label)}>
          Places &amp; art →
        </button>
        <button
          type="button"
          onClick={() => {
            onMemorize(s.label);
            setMemorized(true);
          }}
        >
          {memorized ? "✓ In your memory deck" : "Memorize"}
        </button>
      </div>
      {verses && <VerseBlock data={verses} />}
    </div>
  );
}

function RefChecker() {
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<ScannedRef[] | null>(null);
  const [open, setOpen] = useState<{ match: string; data: ClientVerses } | null>(null);

  return (
    <div className="section-card">
      <h3>Reference checker</h3>
      <p className="atlas-note" style={{ marginBottom: 10 }}>
        Paste anything — sermon notes, a quote, an AI answer. Every scripture reference is
        validated against the canon tables; nothing is taken on faith.
      </p>
      <textarea
        className="checker-input"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='e.g. "Compare John 3:16 with John 3:99, Romans 8:28 and 2 Hezekiah 4:11."'
      />
      <div className="suggestion-actions">
        <button type="button" onClick={() => setRefs(scanRefs(text))}>
          Check references
        </button>
      </div>
      {refs && refs.length === 0 && (
        <p className="atlas-note">No scripture references found in that text.</p>
      )}
      {refs && refs.length > 0 && (
        <ul className="checker-results">
          {refs.map((r, i) => (
            <li key={i}>
              {r.ok ? (
                <>
                  <button
                    type="button"
                    className="chip"
                    onClick={() =>
                      open?.match === r.match
                        ? setOpen(null)
                        : clientVerses(r.match).then((data) => setOpen({ match: r.match, data }))
                    }
                  >
                    {r.match}
                  </button>{" "}
                  <span className="checker-ok">verified — tap to read</span>
                </>
              ) : (
                <>
                  <span className="checker-bad">⚠ {r.match}</span>{" "}
                  <span className="atlas-note">{r.reason}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && <VerseBlock data={open.data} />}
    </div>
  );
}

export function FindPassages({
  onOpenAtlas,
  onMemorize,
}: {
  onOpenAtlas: (ref: string) => void;
  onMemorize: (ref: string) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClientFindResult | null>(null);

  const run = async () => {
    const query = q.trim();
    if (query.length < 3 || busy) return;
    setBusy(true);
    try {
      setResult(await clientFind(query));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        className="query-form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Describe it — "feeling abandoned", "forgiving someone", a saying you heard…'
          aria-label="What do you need a passage about?"
        />
        <button type="submit">{busy ? "Searching…" : "Find"}</button>
      </form>
      <p className="atlas-note" style={{ marginTop: -6, marginBottom: 16 }}>
        Deterministic search across all 31,102 verses, entirely in your browser — nothing
        generated, nothing sent anywhere.
      </p>

      {result?.saying && (
        <div className="section-card consensus">
          <h3>
            {VERDICT_LABEL[result.saying.verdict]} — &ldquo;{result.saying.saying}&rdquo;
          </h3>
          <p className="saying-origin">{result.saying.origin}</p>
          {result.saying.nearest.map((n) => (
            <p key={n.refNorm} className="saying-nearest">
              <span className="chip">{prettyRefNorm(n.refNorm)}</span>{" "}
              {n.text.length > 160 ? n.text.slice(0, 160) + "…" : n.text}
            </p>
          ))}
        </div>
      )}

      {result?.doctrineLabel && (
        <p className="atlas-note" style={{ marginBottom: 12 }}>
          Comparative question detected — the <strong>Across Traditions</strong> tab answers{" "}
          <strong>{result.doctrineLabel}</strong> from each tradition&apos;s own confessions.
        </p>
      )}

      {result?.invalid.map((inv) => (
        <p key={inv.input} className="insufficiency">
          &ldquo;{inv.input}&rdquo; — {inv.reason}
        </p>
      ))}

      {result?.passages.map((p) => (
        <SuggestionCard key={p.refNorm} s={p} onOpenAtlas={onOpenAtlas} onMemorize={onMemorize} />
      ))}

      {result && result.passages.length === 0 && !result.saying && result.invalid.length === 0 && (
        <p className="insufficiency">
          Nothing matched closely. Try different words — or a direct reference like &ldquo;Romans
          8&rdquo;.
        </p>
      )}

      <RefChecker />
    </div>
  );
}
