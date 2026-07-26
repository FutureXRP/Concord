"use client";

/**
 * Places & Art — the visual layer for any passage.
 *
 * The map is a real interactive atlas: drag to pan, scroll or pinch to
 * zoom, with every one of the 1,278 gazetteer places drawn as a context
 * layer so you always have your bearings. Labels are chosen by importance
 * (total verse mentions across the Bible) with collision avoidance, so
 * zooming in progressively reveals more. Seas and rivers are named.
 * Passage places render in the accent color; everything else is context.
 *
 * Data: OpenBible.info Bible Geocoding (CC BY 4.0) over a Natural Earth
 * public-domain basemap — pure data to pure SVG, no tile server, no keys.
 * Geometry is projected once into a fixed coordinate space; pan and zoom
 * only move the viewBox, so interaction costs nothing.
 *
 * Art: Gustave Doré's 1866 Bible engravings (public domain, Project
 * Gutenberg #8710), keyed to the passage by the plates' printed citations.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateReference, expandRefToVerses } from "@/lib/concord/canon";
import type { ScriptureRef } from "@/lib/concord/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface PlacesData {
  attribution: string;
  places: Array<[string, number, number, number, number]>; // name, lat, lon, conf, mentions
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

// ─── Interactive map ───────────────────────────────────────────────────────

const ASPECT = 1.55; // viewBox width : height

// Named waters and rivers for bearings. show: [minViewW, maxViewW] in
// global units (view width shrinks as you zoom in).
const GEO_LABELS: Array<{ name: string; lon: number; lat: number; show: [number, number] }> = [
  { name: "Mediterranean Sea", lon: 19.5, lat: 34.3, show: [120, 400] },
  { name: "The Great Sea", lon: 32.6, lat: 33.4, show: [30, 120] },
  { name: "Black Sea", lon: 33.5, lat: 43.2, show: [60, 400] },
  { name: "Red Sea", lon: 34.6, lat: 26.6, show: [40, 400] },
  { name: "Dead Sea", lon: 35.5, lat: 31.35, show: [0, 45] },
  { name: "Sea of Galilee", lon: 35.59, lat: 32.82, show: [0, 25] },
  { name: "Nile", lon: 30.9, lat: 28.6, show: [0, 200] },
  { name: "Euphrates", lon: 39.6, lat: 35.8, show: [0, 200] },
  { name: "Tigris", lon: 43.9, lat: 34.9, show: [0, 200] },
  { name: "Jordan", lon: 35.75, lat: 32.25, show: [0, 30] },
];

interface View {
  x: number;
  y: number;
  w: number;
}

function MapView({
  places,
  basemap,
  hits,
}: {
  places: PlacesData;
  basemap: Basemap;
  hits: PlaceHit[];
}) {
  const [W, S, E, N] = basemap.bbox;
  const KX = Math.cos(((S + N) / 2) * (Math.PI / 180));
  const GW = (E - W) * KX * 10; // global width
  const GH = (N - S) * 10; // global height
  const gx = useCallback((lon: number) => (lon - W) * KX * 10, [W, KX]);
  const gy = useCallback((lat: number) => (N - lat) * 10, [N]);

  const [selected, setSelected] = useState<PlaceHit | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fitView = useCallback(
    (targets: PlaceHit[]): View => {
      if (targets.length === 0) {
        // Whole-region overview.
        const w = GW;
        return { x: 0, y: Math.max(0, (GH - w / ASPECT) / 2), w };
      }
      const xs = targets.map((h) => gx(h.lon));
      const ys = targets.map((h) => gy(h.lat));
      let x0 = Math.min(...xs) - 14;
      let x1 = Math.max(...xs) + 14;
      let y0 = Math.min(...ys) - 11;
      let y1 = Math.max(...ys) + 11;
      let w = Math.max(x1 - x0, (y1 - y0) * ASPECT, 42);
      let h = w / ASPECT;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      let x = cx - w / 2;
      let y = cy - h / 2;
      // Clamp inside the world.
      w = Math.min(w, GW);
      h = w / ASPECT;
      x = Math.max(0, Math.min(x, GW - w));
      y = Math.max(0, Math.min(y, GH - h));
      return { x, y, w };
    },
    [GW, GH, gx, gy],
  );

  const [view, setView] = useState<View>(() => fitView(hits));
  useEffect(() => {
    setView(fitView(hits));
    setSelected(null);
  }, [hits, fitView]);

  const h = view.w / ASPECT;

  const clampView = useCallback(
    (v: View): View => {
      const w = Math.max(10, Math.min(v.w, GW));
      const vh = w / ASPECT;
      return {
        w,
        x: Math.max(0, Math.min(v.x, GW - w)),
        y: Math.max(0, Math.min(v.y, Math.max(0, GH - vh))),
      };
    },
    [GW, GH],
  );

  // Wheel zoom around the cursor. Native listener so preventDefault works.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const factor = e.deltaY > 0 ? 1.22 : 1 / 1.22;
        const w = Math.max(10, Math.min(v.w * factor, GW));
        const vh0 = v.w / ASPECT;
        const vh = w / ASPECT;
        return clampView({
          w,
          x: v.x + px * v.w - px * w,
          y: v.y + py * vh0 - py * vh,
        });
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [GW, clampView]);

  // Drag pan + two-finger pinch via pointer events.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; w: number } | null>(null);
  const dragged = useRef(false);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), w: view.w };
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0) {
        const w = pinchStart.current.w * (pinchStart.current.dist / dist);
        const cxp = ((a.x + b.x) / 2 - rect.left) / rect.width;
        const cyp = ((a.y + b.y) / 2 - rect.top) / rect.height;
        setView((v) =>
          clampView({
            w,
            x: v.x + cxp * v.w - cxp * w,
            y: v.y + cyp * (v.w / ASPECT) - cyp * w / ASPECT,
          }),
        );
      }
      return;
    }

    const dx = ((e.clientX - prev.x) / rect.width) * view.w;
    const dy = ((e.clientY - prev.y) / rect.height) * (view.w / ASPECT);
    if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 2) dragged.current = true;
    setView((v) => clampView({ ...v, x: v.x - dx, y: v.y - dy }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  const zoomBy = (factor: number) =>
    setView((v) => {
      const w = Math.max(10, Math.min(v.w * factor, GW));
      const cx = v.x + v.w / 2;
      const cy = v.y + v.w / ASPECT / 2;
      return clampView({ w, x: cx - w / 2, y: cy - w / ASPECT / 2 });
    });

  // Geometry projected once — pan/zoom never re-projects.
  const toPath = useCallback(
    (rings: number[][][], close: boolean) =>
      rings
        .map((ring) => {
          if (ring.length < 2) return "";
          return (
            "M" +
            ring.map(([lon, lat]) => `${gx(lon).toFixed(1)},${gy(lat).toFixed(1)}`).join("L") +
            (close ? "Z" : "")
          );
        })
        .filter(Boolean)
        .join(" "),
    [gx, gy],
  );
  const landPath = useMemo(() => toPath(basemap.land, true), [basemap, toPath]);
  const lakePath = useMemo(() => toPath(basemap.lakes, true), [basemap, toPath]);
  const riverPath = useMemo(() => toPath(basemap.rivers, false), [basemap, toPath]);

  const hitIdx = useMemo(() => new Set(hits.map((h) => h.idx)), [hits]);

  // Scale-dependent sizes (viewBox units).
  const fs = view.w / 52;
  const dotR = view.w / 220;

  // Label selection: passage places first, then context by importance,
  // greedy collision avoidance. Recomputed per view — cheap.
  const labels = useMemo(() => {
    const inView = (x: number, y: number) =>
      x >= view.x - 2 && x <= view.x + view.w + 2 && y >= view.y - 2 && y <= view.y + h + 2;
    type Cand = { name: string; x: number; y: number; hit: boolean; lx?: number; ly?: number };
    const cands: Cand[] = [];
    for (const hp of hits) {
      const x = gx(hp.lon);
      const y = gy(hp.lat);
      if (inView(x, y)) cands.push({ name: hp.name, x, y, hit: true });
    }
    const ctx = places.places
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => !hitIdx.has(i))
      .sort((a, b) => (b.p[4] ?? 0) - (a.p[4] ?? 0));
    for (const { p } of ctx) {
      if (cands.length > 220) break;
      const x = gx(p[2]);
      const y = gy(p[1]);
      if (inView(x, y)) cands.push({ name: p[0], x, y, hit: false });
    }
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const overlaps = (box: { x: number; y: number; w: number; h: number }) =>
      placed.some(
        (b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h,
      );
    const out: Cand[] = [];
    for (const c of cands) {
      if (out.length >= 26) break;
      const bw = (c.name.length + 1.5) * fs * 0.56;
      const bh = fs * 1.15;
      // Preferred spot: right of the dot. Passage places that clash there
      // (co-located sites like Damascus + Straight Street) try below, then
      // left, so every passage label lands somewhere readable.
      const spots = [
        { x: c.x + dotR * 2, y: c.y - bh / 2 },
        ...(c.hit
          ? [
              { x: c.x - bw / 2, y: c.y + fs * 0.55 },
              { x: c.x - bw - dotR * 2, y: c.y - bh / 2 },
              { x: c.x - bw / 2, y: c.y - fs * 1.7 },
            ]
          : []),
      ];
      const spot = spots.find((sp) => !overlaps({ ...sp, w: bw, h: bh }));
      if (!spot) continue;
      placed.push({ ...spot, w: bw, h: bh });
      out.push({ ...c, lx: spot.x, ly: spot.y + bh * 0.78 });
    }
    return out;
  }, [view, h, hits, places, hitIdx, fs, dotR, gx, gy]);

  // Context dots: importance-capped so low zooms stay readable.
  const contextDots = useMemo(() => {
    const inView = (x: number, y: number) =>
      x >= view.x && x <= view.x + view.w && y >= view.y && y <= view.y + h;
    const all = places.places
      .map((p, i) => ({ name: p[0], lat: p[1], lon: p[2], mentions: p[4] ?? 0, i }))
      .filter(({ i }) => !hitIdx.has(i))
      .map((p) => ({ ...p, x: gx(p.lon), y: gy(p.lat) }))
      .filter((p) => inView(p.x, p.y));
    all.sort((a, b) => b.mentions - a.mentions);
    return all.slice(0, 500);
  }, [view, h, places, hitIdx, gx, gy]);

  return (
    <div className="map-wrap">
      <svg
        ref={svgRef}
        viewBox={`${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${h.toFixed(2)}`}
        className="atlas-map"
        role="img"
        aria-label={
          hits.length > 0
            ? `Interactive map: ${hits.length} biblical places in this passage`
            : "Interactive map of the biblical world"
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none", cursor: "grab" }}
      >
        <path d={landPath} fillRule="evenodd" fill="var(--panel)" stroke="var(--line)" strokeWidth={fs / 14} />
        <path d={lakePath} fillRule="evenodd" fill="var(--accent-soft)" stroke="var(--line)" strokeWidth={fs / 18} />
        <path d={riverPath} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={fs / 12} />

        {GEO_LABELS.filter(
          (g) => view.w >= g.show[0] && view.w <= g.show[1],
        ).map((g) => (
          <text
            key={g.name}
            x={gx(g.lon)}
            y={gy(g.lat)}
            fontSize={fs * 0.85}
            fontStyle="italic"
            fill="var(--muted)"
            opacity={0.85}
            textAnchor="middle"
          >
            {g.name}
          </text>
        ))}

        {contextDots.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r={dotR * 0.62} fill="var(--muted)" opacity={0.5}>
            <title>
              {p.name} — {p.mentions} mention{p.mentions === 1 ? "" : "s"} in scripture
            </title>
          </circle>
        ))}

        {hits.map((hp) => (
          <circle
            key={hp.idx}
            cx={gx(hp.lon)}
            cy={gy(hp.lat)}
            r={selected?.idx === hp.idx ? dotR * 1.9 : dotR * 1.3}
            fill="var(--accent)"
            stroke="var(--panel)"
            strokeWidth={dotR / 3}
            strokeDasharray={hp.conf < 0.7 ? `${dotR / 2} ${dotR / 2.6}` : undefined}
            style={{ cursor: "pointer" }}
            onClick={() => {
              if (!dragged.current) setSelected((s) => (s?.idx === hp.idx ? null : hp));
            }}
          >
            <title>
              {hp.name}
              {hp.conf < 0.7 ? " (identification less certain)" : ""} — {hp.verses.length} mention
              {hp.verses.length === 1 ? "" : "s"} in this passage
            </title>
          </circle>
        ))}

        {labels.map((l) => (
          <text
            key={`${l.x},${l.y}`}
            x={l.lx ?? l.x + dotR * 2}
            y={l.ly ?? l.y + fs * 0.34}
            fontSize={l.hit ? fs : fs * 0.82}
            fontWeight={l.hit ? 600 : 400}
            fill={l.hit ? "var(--ink)" : "var(--muted)"}
            stroke="var(--bg)"
            strokeWidth={fs / 6}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {l.name}
          </text>
        ))}
      </svg>

      <div className="map-controls" role="group" aria-label="Map controls">
        <button type="button" onClick={() => zoomBy(1 / 1.45)} title="Zoom in">＋</button>
        <button type="button" onClick={() => zoomBy(1.45)} title="Zoom out">－</button>
        <button type="button" onClick={() => setView(fitView(hits))} title="Fit the passage">⌖</button>
        <button type="button" onClick={() => setView(fitView([]))} title="Whole region">⛶</button>
      </div>

      <p className="atlas-note">
        {selected
          ? `${selected.name} — mentioned at ${selected.verses.slice(0, 6).map(prettyVerse).join(", ")}${selected.verses.length > 6 ? "…" : ""}${selected.conf < 0.7 ? " · identification less certain" : ""}`
          : hits.length > 0
            ? `${hits.length} place${hits.length === 1 ? "" : "s"} in this passage (green) among ${places.places.length.toLocaleString()} known biblical places (gray). Drag to pan, scroll or pinch to zoom, tap a marker. Dashed = identification less certain.`
            : `All ${places.places.length.toLocaleString()} known biblical places. Drag to pan, scroll or pinch to zoom — labels appear as you zoom in.`}
      </p>
      <p className="atlas-attribution">
        Locations: OpenBible.info Bible Geocoding (CC BY 4.0) · Basemap: Natural Earth (public
        domain)
      </p>
    </div>
  );
}

// ─── Art panel ─────────────────────────────────────────────────────────────

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

// ─── Combined tab ──────────────────────────────────────────────────────────

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
        <p className="insufficiency">{(validation as { reason: string }).reason}</p>
      )}
      {failed && <p className="insufficiency">Could not load the atlas data — reload to retry.</p>}
      {!data && !failed && validation.ok && <p className="atlas-note">Loading places &amp; art…</p>}

      {data && sref && (
        <>
          {hits.length === 0 && (
            <p className="atlas-note" style={{ marginBottom: 8 }}>
              No mapped locations in this passage — showing the whole biblical world instead. Try
              Acts 9, Exodus 14, or 1 Kings 5 for a passage-specific map.
            </p>
          )}
          <MapView places={data.places} basemap={data.basemap} hits={hits} />
          <ArtPanel meta={data.dore} sref={sref} />
        </>
      )}
    </div>
  );
}
