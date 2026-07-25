"use client";

/**
 * Citation chip (spec §11). Every claim ends in one or more chips - the
 * visible proof of the guarantee. Click performs a live resolveCSID()
 * (Gate 6); a chip that fails to resolve renders in an error state.
 */

import { useState } from "react";
import { useConcordConfig } from "./config";

/** Short human label for a CSID: 'confession:westminster-shorter:q1' -> 'WSC Q1'. */
export function chipLabel(csid: string): string {
  const parts = csid.split(":");
  const ABBREV: Record<string, string> = {
    "confession:westminster-shorter": "WSC",
    "confession:westminster-larger": "WLC",
    "confession:westminster": "WCF",
    "confession:augsburg": "Augsburg",
    "confession:trent": "Trent",
    "magisterium:ccc": "CCC",
    "confession:baltimore-2": "Baltimore",
    "confession:luther-small-catechism": "Small Cat.",
    "confession:thirty-nine-articles": "39 Art.",
    "confession:heidelberg": "Heidelberg",
    "confession:belgic": "Belgic",
    "confession:dort": "Dort",
    "confession:london-baptist-1689": "1689",
    "confession:apostles-creed": "Apostles'",
    "confession:athanasian-creed": "Athanasian",
    "council:constantinople-i:creed": "Nicene",
    "council:chalcedon:definition": "Chalcedon",
    "council:orange-ii:canon": "Orange",
    "father:augustine:confessions": "Augustine Conf.",
  };
  for (const [prefix, label] of Object.entries(ABBREV)) {
    if (csid.startsWith(prefix + ":")) {
      return `${label} ${csid.slice(prefix.length + 1)}`;
    }
  }
  if (parts[0] === "scripture") {
    return `${parts[2]} ${parts[3]} (${parts[1].toUpperCase()})`;
  }
  if (parts.length >= 4) {
    return `${parts[1]} ${parts[parts.length - 1]}`;
  }
  return csid;
}

export interface ResolvedSource {
  kind: string;
  csid: string;
  body?: string;
  note?: string;
  reason?: string;
  attribution?: string | null;
  degradationNotice?: string | null;
  restsOn?: string[];
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

export function CitationChip({
  csid,
  onResolved,
}: {
  csid: string;
  onResolved: (source: ResolvedSource) => void;
}) {
  const [errored, setErrored] = useState(false);
  const { apiBaseUrl, translation, engine } = useConcordConfig();

  const handleClick = async () => {
    if (engine === "client") {
      // Static build: Gate 6 resolution runs in the browser.
      try {
        const { clientResolve } = await import("../../lib/concord/browser/engine");
        const data = (await clientResolve(csid)) as ResolvedSource;
        if (data.kind === "unresolved") setErrored(true);
        onResolved(data);
      } catch {
        setErrored(true);
      }
      return;
    }
    try {
      const params = new URLSearchParams({ csid });
      if (translation) params.set("translation", translation);
      const res = await fetch(`${apiBaseUrl}/api/concord/resolve?${params}`);
      const data = (await res.json()) as ResolvedSource;
      if (!res.ok || data.kind === "unresolved") {
        setErrored(true);
        onResolved(data);
        return;
      }
      onResolved(data);
    } catch {
      setErrored(true);
    }
  };

  return (
    <button
      type="button"
      className={`chip${errored ? " error" : ""}`}
      title={csid}
      onClick={handleClick}
    >
      {chipLabel(csid)}
    </button>
  );
}
