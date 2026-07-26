"use client";

/**
 * Places & Art — the visual layer for any passage.
 *
 * Geography: every place the passage mentions, plotted on a deterministic
 * SVG map. Data is OpenBible.info's Bible Geocoding dataset (CC BY 4.0,
 * 1,278 places with scholarly-confidence scores) over a Natural Earth
 * public-domain basemap — pure data to pure SVG, no tile server, no keys.
 *
 * Art: Gustave Doré's 1866 Bible engravings (public domain, Project
 * Gutenberg #8710), keyed to the passage by the plates' printed citations.
 * Everything is served from this site's own static assets.
 */

import React, { useEffect, useMemo, useState } from "react";
import { validateReference, expandRefToVerses } from "@/lib/concord/canon";
import type { ScriptureRef } from "@/lib/concord/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface PlacesData {
  attribution: string;
  places: Array<[string, number, number, number]>; // name, lat, lon, conf
  byVerse: Record<string, number[]>;
}
interface Basemap {
  attribution: string;
  bbox: [number, number, number, number];
  land: number[][][];
  lakes: number[][][];
  rivers: number[][][];
}
interface DoreMeta {
  attribution: string;
  plates: Array<{ n: string; title: string; display: string; matches: string[]; curated?: boolean }>;
}

const cache = new Map<string, Promise<unknown>>();
function loadJSON<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
    );
  }
  return cache.get(url) as Promise<T>;
}

interface PlaceHit {
  idx: number;
  name: string;
  lat: number;
  lon: number;
  conf: number;
  verses: string[];
}

function prettyVerse(refNorm: string): string {
  const m = refNorm.match(/^[a-z0-9]+:(\d+)\.(\d+)$/);
  return m ? `${m[1]}:${m[2]}` : refNorm;
}

function PassageMap({ basemap, hits }: { basemap: Basemap; hits: PlaceHit[] }) {
  const [selected, setSelected] = useState<PlaceHit | null>(null);

  const view = useMemo(() => {
    const [W, S, E, N] = basemap.bbox;
    let west = Math.min(...hits.map((h) => h.lon)) - 1.5;
    let east = Math.max(...hits.map((h) => h.lon)) + 1.5;
    let south = Math.min(...hits.map((h) => h.lat)) - 1.2;
    let north = Math.max(...hits.map((h) => h.lat)) + 1.2;
    if (east - west < 6) {
      const c = (east + west) / 2;
      west = c - 3;
      east = c + 3;
    }
    if (north - south < 4.5) {
      const c = (north + south) / 2;
      south = c - 2.25;
      north = c + 2.25;
    }
    const kx0 = Math.cos(((south + north) / 2) * (Math.PI / 180));
    const needLon = ((north - south) * 1.25) / kx0;
    if (east - west < needLon) {
      const c = (east + west) / 2;
      west = c - needLon / 2;
      east = c + needLon / 2;
    }
    west = Math.max(W, west);
    east = Math.min(E, east);
    south = Math.max(S, south);
    north = Math.min(N, north);
    const kx = Math.cos(((south + north) / 2) * (Math.PI / 180));
    return { west, south, east, north, kx };
  }, [hits, basemap]);

  const SCALE = 10;
  const px = (lon: number) => (lon - view.west) * view.kx * SCALE;
  const py = (lat: number) => (view.north - lat) * SCALE;
  const width = (view.east - view.west) * view.kx * SCALE;
  const height = (view.north - view.south) * SCALE;

  const toPath = (rings: number[][][], close: boolean) =>
    rings
      .map((ring) => {
        if (ring.length < 2) return "";
        return (
          "M" +
          ring.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join("L") +
          (close ? "Z" : "")
        );
      })
      .filter(Boolean)
      .join(" ");

  /* eslint-disable react-hooks/exhaustive-deps */
  const landPath = useMemo(() => toPath(basemap.land, true), [basemap, view]);
  const lakePath = useMemo(() => toPath(basemap.lakes, true), [basemap, view]);
  const riverPath = useMemo(() => toPath(basemap.rivers, false), [basemap, view]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const shown = hits.slice(0, 20);
  const fs = width / 46;
  const dotR = width / 170;
  const labeled: PlaceHit[] = [];
  for (const h of shown) {
    if (labeled.length >= 12) break;
    const clash = labeled.some(
      (l) =>
        Math.abs(l.lon - h.lon) * view.kx < width / 52 && Math.abs(l.lat - h.lat) < fs / 6,
    );
    if (!clash) labeled.push(h);
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
        className="atlas-map"
        role="img"
        aria-label={`Map of ${hits.length} biblical places in this passage`}
      >
        <path d={landPath} fillRule="evenodd" fill="var(--panel)" stroke="var(--line)" strokeWidth={fs / 14} />
        <path d={lakePath} fillRule="evenodd" fill="var(--accent-soft)" stroke="var(--line)" strokeWidth={fs / 18} />
        <path d={riverPath} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={fs / 11} />
        {shown.map((h) => (
          <g
            key={h.idx}
            onClick={() => setSelected((s) => (s?.idx === h.idx ? null : h))}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={px(h.lon)}
              cy={py(h.lat)}
              r={selected?.idx === h.idx ? dotR * 1.5 : dotR}
              fill="var(--accent)"
              stroke="var(--panel)"
              strokeWidth={dotR / 3}
              strokeDasharray={h.conf < 0.7 ? `${dotR / 2} ${dotR / 2.6}` : undefined}
              opacity={h.conf < 0.7 ? 0.75 : 1}
            >
              <title>
                {h.name}
                {h.conf < 0.7 ? " (identification less certain)" : ""} — {h.verses.length} mention
                {h.verses.length === 1 ? "" : "s"} in this passage
              </title>
            </circle>
            {labeled.includes(h) && (
              <text
                x={px(h.lon) + dotR * 1.9}
                y={py(h.lat) + fs * 0.34}
                fontSize={fs}
                fill="var(--ink)"
                stroke="var(--bg)"
                strokeWidth={fs / 6}
                paintOrder="stroke"
              >
                {h.name}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="atlas-note">
        {selected
          ? `${selected.name} — mentioned at ${selected.verses.slice(0, 6).map(prettyVerse).join(", ")}${selected.verses.length > 6 ? "…" : ""}${selected.conf < 0.7 ? " · identification less certain" : ""}`
          : `${hits.length} place${hits.length === 1 ? "" : "s"} in this passage${hits.length > 20 ? " (20 shown)" : ""} — tap a marker. Dashed = identification less certain.`}
      </p>
      <p className="atlas-attribution">
        Locations: OpenBible.info Bible Geocoding (CC BY 4.0) · Basemap: Natural Earth (public
        domain)
      </p>
    </div>
  );
}

function ArtPanel({ meta, sref }: { meta: DoreMeta; sref: ScriptureRef }) {
  const [expanded, setExpanded] = useState(false);

  const plates = useMemo(() => {
    const keys = new Set<string>();
    const endCh = sref.endChapter ?? sref.chapter;
    for (let ch = sref.chapter; ch <= endCh; ch++) keys.add(`${sref.bookId}:${ch}`);
    keys.add(`${sref.bookId}:*`);
    return meta.plates.filter((p) => p.matches.some((m) => keys.has(m)));
  }, [meta, sref]);

  if (plates.length === 0) {
    return (
      <p className="atlas-note" style={{ marginTop: 18 }}>
        No Doré engraving covers this passage — the gallery has 100 plates across the canon, so
        many passages fall between them.
      </p>
    );
  }
  const visible = expanded ? plates : plates.slice(0, 2);

  return (
    <div className="art-panel">
      <h3>Doré engravings for this passage</h3>
      <div className="art-grid">
        {visible.map((p) => (
          <figure key={p.n}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${BASE}/art/dore/${p.n}.jpg`}
              alt={`${p.title} — engraving by Gustave Doré`}
              loading="lazy"
            />
            <figcaption>
              <strong>{p.title}</strong> · {p.display}
              {p.curated ? " (editorial assignment)" : ""}
            </figcaption>
          </figure>
        ))}
      </div>
      {plates.length > 2 && (
        <button type="button" className="art-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show fewer" : `Show all ${plates.length} engravings`}
        </button>
      )}
      <p className="atlas-attribution">
        Gustave Doré, 1866 (La Grande Bible de Tours) — public domain, via Project Gutenberg.
      </p>
    </div>
  );
}

export function Atlas({ initialRef }: { initialRef?: string }) {
  const [input, setInput] = useState(initialRef ?? "Acts 9:1-20");
  const [passage, setPassage] = useState(initialRef ?? "Acts 9:1-20");
  const [data, setData] = useState<{ places: PlacesData; basemap: Basemap; dore: DoreMeta } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (initialRef) {
      setInput(initialRef);
      setPassage(initialRef);
    }
  }, [initialRef]);

  useEffect(() => {
    let dead = false;
    Promise.all([
      loadJSON<PlacesData>(`${BASE}/places/places.json`),
      loadJSON<Basemap>(`${BASE}/places/basemap.json`),
      loadJSON<DoreMeta>(`${BASE}/art/dore.json`),
    ])
      .then(([places, basemap, dore]) => {
        if (!dead) setData({ places, basemap, dore });
      })
      .catch(() => {
        if (!dead) setFailed(true);
      });
    return () => {
      dead = true;
    };
  }, []);

  const validation = useMemo(() => validateReference(passage), [passage]);
  const sref = validation.ok ? validation.ref : null;

  const hits = useMemo<PlaceHit[]>(() => {
    if (!data || !sref) return [];
    const byIdx = new Map<number, string[]>();
    for (const vn of expandRefToVerses(sref)) {
      for (const idx of data.places.byVerse[vn] ?? []) {
        const arr = byIdx.get(idx) ?? [];
        arr.push(vn);
        byIdx.set(idx, arr);
      }
    }
    const out: PlaceHit[] = [];
    for (const [idx, verses] of byIdx) {
      const [name, lat, lon, conf] = data.places.places[idx];
      out.push({ idx, name, lat, lon, conf, verses });
    }
    out.sort((a, b) => b.verses.length - a.verses.length);
    return out;
  }, [data, sref]);

  return (
    <div>
      <form
        className="query-form"
        onSubmit={(e) => {
          e.preventDefault();
          setPassage(input.trim());
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Any passage — Acts 9, Exodus 14, Luke 2:1-20…"
          aria-label="Passage for the atlas"
        />
        <button type="submit">Map it</button>
      </form>

      {!validation.ok && (
        <p className="insufficiency">
          {(validation as { reason: string }).reason}
        </p>
      )}
      {failed && <p className="insufficiency">Could not load the atlas data — reload to retry.</p>}
      {!data && !failed && validation.ok && <p className="atlas-note">Loading places &amp; art…</p>}

      {data && sref && (
        <>
          {hits.length > 0 ? (
            <PassageMap basemap={data.basemap} hits={hits} />
          ) : (
            <p className="atlas-note">
              No mapped locations in this passage — not every text names a place. Try Acts 9,
              Exodus 14, or 1 Kings 5.
            </p>
          )}
          <ArtPanel meta={data.dore} sref={sref} />
        </>
      )}
    </div>
  );
}
