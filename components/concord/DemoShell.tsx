"use client";

/**
 * Demo shell — the four free layers side by side:
 *   Across Traditions · Find · Places & Art · Memorize
 * All of it runs in the visitor's browser on the static build.
 */

import React, { useState } from "react";
import { AcrossTraditions } from "@/components/concord/AcrossTraditions";
import { FindPassages } from "@/components/concord/FindPassages";
import { Atlas } from "@/components/concord/Atlas";
import { MemorizeDeck, addToDeck } from "@/components/concord/MemorizeDeck";

type View = "traditions" | "find" | "atlas" | "memorize";

const TABS: Array<{ id: View; label: string }> = [
  { id: "traditions", label: "Across Traditions" },
  { id: "find", label: "Find a passage" },
  { id: "atlas", label: "Places & Art" },
  { id: "memorize", label: "Memorize" },
];

export function DemoShell({ initialQuery }: { initialQuery: string }) {
  const [view, setView] = useState<View>("traditions");
  const [atlasRef, setAtlasRef] = useState<string | undefined>(undefined);

  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${view === t.id ? "active" : ""}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Views stay mounted so corpus loads and deck state survive switches. */}
      <div style={{ display: view === "traditions" ? "block" : "none" }}>
        <AcrossTraditions initialQuery={initialQuery} />
      </div>
      <div style={{ display: view === "find" ? "block" : "none" }}>
        <FindPassages
          onOpenAtlas={(ref) => {
            setAtlasRef(ref);
            setView("atlas");
          }}
          onMemorize={(ref) => {
            void addToDeck(ref);
          }}
        />
      </div>
      <div style={{ display: view === "atlas" ? "block" : "none" }}>
        <Atlas initialRef={atlasRef} />
      </div>
      {/* Remounts on every visit so passages added from Find show up. */}
      {view === "memorize" && <MemorizeDeck />}
    </>
  );
}
