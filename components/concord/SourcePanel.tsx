"use client";

/**
 * Slide-over with full source text, work metadata, era, author, translator,
 * license, and an external link where one exists (spec §11).
 */

import { CitationChip, type ResolvedSource } from "./CitationChip";

export function SourcePanel({
  source,
  onClose,
  onResolved,
}: {
  source: ResolvedSource;
  onClose: () => void;
  /** Chip clicks inside the panel navigate to that source. */
  onResolved?: (s: ResolvedSource) => void;
}) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="slide-over" role="dialog" aria-label="Source detail">
        <button className="close" onClick={onClose} aria-label="Close">
          &times;
        </button>

        {source.kind === "unresolved" ? (
          <>
            <h2>Source unavailable</h2>
            <p className="meta">
              This citation could not be resolved ({source.reason ?? "unknown"}). This
              has been reported.
            </p>
          </>
        ) : source.kind === "describe-only" ? (
          <>
            <h2>Described source</h2>
            <p className="source-body">{source.note}</p>
          </>
        ) : (
          <>
            <h2>{source.work?.title ?? source.csid}</h2>
            <p className="meta">
              {[
                source.work?.author,
                source.work?.translator ? `tr. ${source.work.translator}` : null,
                source.work?.composed_era,
                source.work?.composed_year ? String(source.work.composed_year) : null,
                source.work?.tradition,
                source.work ? `license tier ${source.work.license_tier}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {source.degradationNotice ? (
              <p className="insufficiency">{source.degradationNotice}</p>
            ) : null}
            <div className="source-body">{source.body}</div>
            {onResolved && source.restsOn && source.restsOn.length > 0 ? (
              <div className="attribution">
                Rests on:{" "}
                {source.restsOn.map((csid) => (
                  <CitationChip key={csid} csid={csid} onResolved={onResolved} />
                ))}
              </div>
            ) : null}
            {onResolved && source.citedBy && source.citedBy.length > 0 ? (
              <div className="attribution">
                Cited by:{" "}
                {source.citedBy.map((c) => (
                  <CitationChip key={c.csid} csid={c.csid} onResolved={onResolved} />
                ))}
              </div>
            ) : null}
            {source.attribution ? (
              <div className="attribution">{source.attribution}</div>
            ) : null}
            {source.work?.source_url ? (
              <p className="attribution">
                <a href={source.work.source_url} target="_blank" rel="noreferrer">
                  Open the source
                </a>
              </p>
            ) : null}
          </>
        )}
      </aside>
    </>
  );
}
