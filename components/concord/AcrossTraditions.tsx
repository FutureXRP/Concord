"use client";

/**
 * The "Across Traditions" tab (spec §11). Lives inside an existing
 * PassageLab study - not a separate destination. Free at every tier: no
 * upsell interstitial, no teaser truncation, no blur-and-upgrade.
 *
 * Defaults to shared ground ("Where they agree") first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CitationChip, type ResolvedSource } from "./CitationChip";
import { SourcePanel } from "./SourcePanel";
import { InsufficiencyNotice } from "./InsufficiencyNotice";
import { useConcordConfig } from "./config";

interface VerifiedClaim {
  text: string;
  csids: string[];
  quotation: { csid: string; text: string } | null;
  entailment: "pass" | "partial";
}

interface VerifiedSection {
  type: "consensus" | "position" | "divergence" | "critique" | "historical" | "sources";
  tradition: string | null;
  claims: VerifiedClaim[];
}

type Phase = "idle" | "loading" | "streaming" | "done" | "error";

const SECTION_TITLES: Record<VerifiedSection["type"], string> = {
  consensus: "Shared ground",
  position: "Position",
  divergence: "Where they differ",
  critique: "Critique (as critique)",
  historical: "Historical development",
  sources: "Sources",
};

export interface AcrossTraditionsProps {
  /** Pre-filled question. */
  initialQuery?: string;
  /**
   * The passage the host study is on (e.g. "Romans 3:21-26"). Used to
   * compose a default question when initialQuery is not given.
   */
  passage?: string;
  /** Run the initial question immediately on mount (host-app embedding). */
  autoRun?: boolean;
}

export function AcrossTraditions({ initialQuery, passage, autoRun }: AcrossTraditionsProps) {
  const defaultQuery =
    initialQuery ?? (passage ? `What do the traditions teach about ${passage}?` : "");
  const [query, setQuery] = useState(defaultQuery);
  const [view, setView] = useState<"agree" | "differ">("agree");
  const [phase, setPhase] = useState<Phase>("idle");
  const [sections, setSections] = useState<VerifiedSection[]>([]);
  const [mode, setMode] = useState<"synthesized" | "sources" | "curated" | null>(null);
  const [doctrineLabel, setDoctrineLabel] = useState<string | null>(null);
  const [sayingNote, setSayingNote] = useState<{
    saying: string;
    verdict: string;
    origin: string;
  } | null>(null);
  const [insufficientTraditions, setInsufficientTraditions] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [canonNotes, setCanonNotes] = useState<string[]>([]);
  const [openSource, setOpenSource] = useState<ResolvedSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { apiBaseUrl, engine } = useConcordConfig();

  const run = useCallback(
    async (q: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPhase("loading");
      setSections([]);
      setMode(null);
      setDoctrineLabel(null);
      setSayingNote(null);
      setNotice(null);
      setCanonNotes([]);
      setInsufficientTraditions([]);

      // Static build: the whole standalone pipeline runs in the browser.
      if (engine === "client") {
        try {
          const { clientQuery } = await import("../../lib/concord/browser/engine");
          const res = await clientQuery(q);
          switch (res.status) {
            case "invalid-reference":
              setNotice(res.problems.map((p) => p.reason).join(" "));
              break;
            case "insufficient":
              setCanonNotes(res.canonNotes);
              setNotice(res.reason);
              break;
            case "answered": {
              setMode(res.mode);
              setDoctrineLabel(res.doctrineLabel ?? null);
              setSayingNote(res.sayingNote ?? null);
              setCanonNotes(res.canonNotes);
              const rendered = res.result.rendered as VerifiedSection[];
              setSections(rendered);
              if (!rendered.some((s) => s.type === "consensus")) setView("differ");
              break;
            }
          }
          setPhase("done");
        } catch {
          setNotice("The corpus could not be loaded.");
          setPhase("error");
        }
        return;
      }

      try {
        const res = await fetch(`${apiBaseUrl}/api/concord/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, traditions: [] }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          setNotice("Concord could not process this question.");
          setPhase("error");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const eventLine = frame.split("\n").find((l) => l.startsWith("event: "));
            const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!eventLine || !dataLine) continue;
            const event = eventLine.slice(7).trim();
            const data = JSON.parse(dataLine.slice(6));

            switch (event) {
              case "meta":
                setMode(data.mode ?? null);
                setDoctrineLabel(data.doctrineLabel ?? null);
                setSayingNote(data.sayingNote ?? null);
                setCanonNotes(data.canonNotes ?? []);
                setInsufficientTraditions(data.insufficientTraditions ?? []);
                setPhase("streaming");
                break;
              case "section":
                setSections((prev) => {
                  const next = [...prev, data as VerifiedSection];
                  return next;
                });
                break;
              case "insufficient":
                setNotice(data.reason);
                setInsufficientTraditions(data.insufficientTraditions ?? []);
                break;
              case "invalid":
                setNotice(
                  (data.problems as Array<{ reason: string }>)
                    .map((p) => p.reason)
                    .join(" "),
                );
                break;
              case "out-of-scope":
                setNotice(data.reason);
                break;
              case "error":
                setNotice("Something went wrong. The study is unaffected.");
                break;
              case "done":
                setSections((prev) => {
                  if (prev.length > 0 && !prev.some((s) => s.type === "consensus")) {
                    setView("differ");
                  }
                  return prev;
                });
                break;
            }
          }
        }
        setPhase("done");
        // Curated doctrine answers without a consensus section land on
        // "Where they differ" so the loci are immediately visible.
        setSections((prev) => {
          if (prev.length > 0 && !prev.some((s) => s.type === "consensus")) {
            setView("differ");
          }
          return prev;
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPhase("error");
      }
    },
    [apiBaseUrl, engine],
  );

  useEffect(() => {
    if (autoRun && defaultQuery) run(defaultQuery);
    // Run once on mount when the host app embeds with autoRun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agreeSections = sections.filter((s) => s.type === "consensus");
  const differSections = sections.filter((s) => s.type !== "consensus");
  // Standalone sources mode has no consensus/divergence synthesis: show
  // everything, skip the toggle.
  const visible =
    mode === "sources" ? sections : view === "agree" ? agreeSections : differSections;

  return (
    <div>
      <form
        className="query-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) run(query.trim());
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do the traditions teach about justification in Romans 3:21-26?"
          aria-label="Question"
        />
        <button type="submit">Ask</button>
      </form>

      {mode !== "sources" &&
      (sections.length > 0 || phase === "streaming" || phase === "loading") ? (
        <div className="view-toggle" role="tablist">
          <button
            className={view === "agree" ? "active" : ""}
            onClick={() => setView("agree")}
            role="tab"
            aria-selected={view === "agree"}
          >
            Where they agree
          </button>
          <button
            className={view === "differ" ? "active" : ""}
            onClick={() => setView("differ")}
            role="tab"
            aria-selected={view === "differ"}
          >
            Where they differ
          </button>
        </div>
      ) : null}

      {sayingNote ? (
        <div className="insufficiency">
          <strong>
            &ldquo;{sayingNote.saying}&rdquo;{" "}
            {sayingNote.verdict === "not-in-scripture"
              ? "does not appear in any book of scripture."
              : sayingNote.verdict === "misattributed"
                ? "is commonly misattributed."
                : "is a paraphrase, not a quotation."}
          </strong>
          <p style={{ margin: "0.4rem 0 0" }}>{sayingNote.origin}</p>
        </div>
      ) : null}

      {doctrineLabel ? (
        <div className="insufficiency">
          <strong>{doctrineLabel}.</strong> A curated comparison: what each tradition
          states in its own confessional standard, side by side, with shared creedal
          ground first where it exists.
        </div>
      ) : null}

      {mode === "sources" ? (
        <div className="insufficiency">
          <strong>Standalone mode.</strong> No language model is configured, so Concord
          shows the retrieved sources directly, verbatim and cited, instead of a
          synthesized comparison.
        </div>
      ) : null}

      {canonNotes.map((n) => (
        <div key={n} className="insufficiency">{n}</div>
      ))}

      {notice ? (
        <InsufficiencyNotice
          traditions={insufficientTraditions}
          reason={notice}
        />
      ) : null}

      {phase === "loading" ? (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      ) : null}

      {visible.map((section, i) => (
        <section
          key={`${section.type}-${section.tradition}-${i}`}
          className={`section-card ${section.type}`}
        >
          <h3>
            {section.tradition
              ? `${SECTION_TITLES[section.type]} - ${section.tradition}`
              : SECTION_TITLES[section.type]}
          </h3>
          {section.claims.map((claim, j) => (
            <p className="claim" key={j}>
              {claim.text}
              {claim.entailment === "partial" ? (
                <span className="hedge" title="Partially supported by the cited source">
                  partial
                </span>
              ) : null}
              {claim.quotation ? (
                <span className="quote">&ldquo;{claim.quotation.text}&rdquo;</span>
              ) : null}{" "}
              {claim.csids.map((csid) => (
                <CitationChip key={csid} csid={csid} onResolved={setOpenSource} />
              ))}
            </p>
          ))}
        </section>
      ))}

      {phase === "done" &&
      sections.length > 0 &&
      insufficientTraditions.length > 0 &&
      !notice ? (
        <InsufficiencyNotice traditions={insufficientTraditions} />
      ) : null}

      {phase === "done" &&
      mode !== "sources" &&
      view === "agree" &&
      agreeSections.length === 0 &&
      sections.length > 0 ? (
        <div className="insufficiency">
          No consensus section was supported by the sources for this question. See
          &ldquo;Where they differ&rdquo;.
        </div>
      ) : null}

      {openSource ? (
        <SourcePanel
          source={openSource}
          onClose={() => setOpenSource(null)}
          onResolved={setOpenSource}
        />
      ) : null}
    </div>
  );
}
