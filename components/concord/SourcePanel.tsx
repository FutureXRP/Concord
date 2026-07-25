"use client";

/**
 * Slide-over with full source text, work metadata, era, author, translator,
 * license, and an external link where one exists (spec §11).
 */

import type { ResolvedSource } from "./CitationChip";

export function SourcePanel({
  source,
  onClose,
}: {
  source: ResolvedSource;
  onClose: () => void;
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
