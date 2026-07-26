#!/usr/bin/env node
/**
 * Build the biblical places layer (Places & Art feature).
 *
 * Sources (both verified reachable, licenses checked before ingest per
 * project convention):
 *  - openbibleinfo/Bible-Geocoding-Data (CC BY 4.0): 1,342 ancient places,
 *    verse links in OSIS refs, coordinates via modern-site associations
 *    with scholarly confidence scores.
 *  - nvkelso/natural-earth-vector (public domain): 1:50m land, lakes and
 *    named rivers for the basemap.
 *
 * Outputs:
 *  - data/places/places.json  — compact place table + verse→place index
 *  - data/places/basemap.json — bbox-clipped polygons/polylines (lon,lat)
 * Both are copied into public/places/ for the static site by the caller.
 *
 * Usage: node scripts/sources/build-places.mjs [--cache <dir>]
 *   --cache points at a directory holding pre-downloaded copies
 *   (ob_ancient.jsonl, ob_modern.jsonl, ne_50m_*.geojson); without it the
 *   script fetches from the pinned raw URLs.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SOURCES = {
  ancient: {
    url: "https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl",
    cache: "ob_ancient.jsonl",
  },
  modern: {
    url: "https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/modern.jsonl",
    cache: "ob_modern.jsonl",
  },
  land: {
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson",
    cache: "ne_50m_land.geojson",
  },
  lakes: {
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson",
    cache: "ne_50m_lakes.geojson",
  },
  rivers: {
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson",
    cache: "ne_50m_rivers_lake_centerlines.geojson",
  },
};

// Frame: Rome/Malta in the west to Babylon/Nineveh in the east.
const BBOX = { west: 8, south: 24.5, east: 48.5, north: 46 };

const RIVER_NAMES = /nile|euphrates|tigris|jordan|orontes/i;

const cacheDirArg = process.argv.indexOf("--cache");
const CACHE_DIR = cacheDirArg !== -1 ? process.argv[cacheDirArg + 1] : null;

async function load(key) {
  const src = SOURCES[key];
  if (CACHE_DIR) {
    const p = join(CACHE_DIR, src.cache);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${src.url}: HTTP ${res.status}`);
  return res.text();
}

// ─── OSIS → Concord book ids ────────────────────────────────────────────────

const booksData = JSON.parse(readFileSync(join(ROOT, "data/canon/books.json"), "utf8"));
const knownIds = new Set(
  [...booksData.books, ...booksData.deuterocanon].map((b) => b.id),
);
const aliasToId = new Map();
for (const b of [...booksData.books, ...booksData.deuterocanon]) {
  for (const a of b.aliases) aliasToId.set(a.toLowerCase(), b.id);
}

function osisToId(osisBook) {
  const lower = osisBook.toLowerCase();
  if (knownIds.has(lower)) return lower;
  return aliasToId.get(lower) ?? null;
}

// ─── Places ────────────────────────────────────────────────────────────────

function parseLonlat(s) {
  if (typeof s !== "string") return null;
  const [lon, lat] = s.split(",").map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function resolveCoords(rec, modernById) {
  let extra = null;
  try {
    extra = typeof rec.extra === "string" ? JSON.parse(rec.extra) : rec.extra;
  } catch {
    extra = null;
  }
  const assocs = (extra?.associations ?? [])
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const a of assocs) {
    const modern = modernById.get(a.modern_id);
    const ll = parseLonlat(modern?.lonlat);
    if (ll) return { ...ll, score: a.score ?? 0 };
  }
  for (const ident of rec.identifications ?? []) {
    for (const r of ident.resolutions ?? []) {
      const ll = parseLonlat(r.lonlat);
      if (ll) return { ...ll, score: 0 };
    }
  }
  return null;
}

async function buildPlaces() {
  const modernById = new Map();
  for (const line of (await load("modern")).split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    modernById.set(rec.id, rec);
  }

  const places = [];
  const byVerse = {};
  let skippedNoCoords = 0;
  let unmappedBooks = new Set();

  for (const line of (await load("ancient")).split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    const name = rec.friendly_id ?? rec.id;
    const coords = resolveCoords(rec, modernById);
    if (!coords) {
      skippedNoCoords++;
      continue;
    }
    const verses = [];
    for (const v of rec.verses ?? []) {
      const m = /^([^.]+)\.(\d+)\.(\d+)$/.exec(v.osis ?? "");
      if (!m) continue;
      const id = osisToId(m[1]);
      if (!id) {
        unmappedBooks.add(m[1]);
        continue;
      }
      verses.push(`${id}:${m[2]}.${m[3]}`);
    }
    if (verses.length === 0) continue; // extra-biblical-only place
    const idx = places.length;
    // Strip homonym counters for display ("Bethlehem 1" → "Bethlehem").
    places.push([
      name.replace(/ \d+$/, ""),
      Math.round(coords.lat * 1e4) / 1e4,
      Math.round(coords.lon * 1e4) / 1e4,
      Math.round((coords.score / 1000) * 100) / 100,
    ]);
    for (const vn of verses) {
      (byVerse[vn] ??= []).push(idx);
    }
  }

  console.log(
    `places: ${places.length} kept, ${skippedNoCoords} without coordinates skipped`,
  );
  if (unmappedBooks.size) {
    console.log(`  unmapped OSIS books (verses dropped): ${[...unmappedBooks].join(", ")}`);
  }
  console.log(`  verse links: ${Object.keys(byVerse).length} verses`);

  return {
    attribution:
      "Place identifications and coordinates: OpenBible.info Bible Geocoding Data, CC BY 4.0 (openbible.info/geo). Confidence reflects the scholarly identification score.",
    places,
    byVerse,
  };
}

// ─── Basemap ───────────────────────────────────────────────────────────────

/**
 * Robust polygon → bbox restriction via scanline rasterization + contour
 * tracing. Naive Sutherland–Hodgman clipping of the continent-scale land
 * rings produces bridged self-overlapping output that renders inverted;
 * rasterizing to a fine grid and tracing the cell boundary back into
 * simple loops sidesteps every degeneracy (SVG evenodd handles holes).
 */
const GRID_STEP = 0.04; // degrees ≈ 4 km — sub-pixel at render scale

function rasterizeMask(features) {
  const nx = Math.round((BBOX.east - BBOX.west) / GRID_STEP);
  const ny = Math.round((BBOX.north - BBOX.south) / GRID_STEP);
  const mask = new Uint8Array(nx * ny);
  for (const f of features) {
    const g = f.geometry;
    const polys =
      g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const ring of poly)
        for (const [x, y] of ring) {
          if (y < minLat) minLat = y;
          if (y > maxLat) maxLat = y;
          if (x < minLon) minLon = x;
          if (x > maxLon) maxLon = x;
        }
      if (maxLat < BBOX.south || minLat > BBOX.north || maxLon < BBOX.west || minLon > BBOX.east)
        continue;
      const j0 = Math.max(0, Math.floor((minLat - BBOX.south) / GRID_STEP));
      const j1 = Math.min(ny - 1, Math.ceil((maxLat - BBOX.south) / GRID_STEP));
      for (let j = j0; j <= j1; j++) {
        const y = BBOX.south + (j + 0.5) * GRID_STEP;
        const xs = [];
        for (const ring of poly) {
          for (let k = 0; k < ring.length; k++) {
            const [x1, y1] = ring[k];
            const [x2, y2] = ring[(k + 1) % ring.length];
            if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
              xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
            }
          }
        }
        xs.sort((a, b) => a - b);
        for (let m = 0; m + 1 < xs.length; m += 2) {
          const i0 = Math.max(0, Math.ceil((xs[m] - BBOX.west) / GRID_STEP - 0.5));
          const i1 = Math.min(nx - 1, Math.floor((xs[m + 1] - BBOX.west) / GRID_STEP - 0.5));
          for (let i = i0; i <= i1; i++) mask[j * nx + i] = 1;
        }
      }
    }
  }
  return { mask, nx, ny };
}

/** Trace mask cell boundaries into closed loops (grid-corner coordinates). */
function traceContours({ mask, nx, ny }) {
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : mask[j * nx + i]);
  // adjacency: corner id -> neighbor corner ids along boundary segments
  const adj = new Map();
  const id = (i, j) => j * (nx + 1) + i;
  const link = (a, b) => {
    (adj.get(a) ?? adj.set(a, []).get(a)).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)).push(a);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      if (at(i - 1, j) !== at(i, j)) link(id(i, j), id(i, j + 1)); // vertical
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j <= ny; j++) {
      if (at(i, j - 1) !== at(i, j)) link(id(i, j), id(i + 1, j)); // horizontal
    }
  }
  const used = new Set();
  const segKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const loops = [];
  for (const [start, nbrs] of adj) {
    for (const first of nbrs) {
      if (used.has(segKey(start, first))) continue;
      const loop = [start];
      let prev = start;
      let cur = first;
      used.add(segKey(prev, cur));
      while (cur !== start) {
        loop.push(cur);
        const next = (adj.get(cur) ?? []).find((n) => n !== prev && !used.has(segKey(cur, n)));
        if (next === undefined) break;
        used.add(segKey(cur, next));
        prev = cur;
        cur = next;
      }
      if (cur === start && loop.length >= 8) loops.push(loop);
    }
  }
  // corner ids -> lon/lat
  return loops.map((loop) =>
    loop.map((c) => {
      const i = c % (nx + 1);
      const j = Math.floor(c / (nx + 1));
      return [BBOX.west + i * GRID_STEP, BBOX.south + j * GRID_STEP];
    }),
  );
}

/** One Chaikin round smooths the rectilinear staircase into a coastline. */
function chaikin(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    out.push([0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2]);
    out.push([0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2]);
  }
  return out;
}

function radialSimplify(ring, tol) {
  const out = [];
  let last = null;
  for (const p of ring) {
    if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= tol) {
      out.push(p);
      last = p;
    }
  }
  return out;
}

function maskToRings(features, minArea) {
  const rings = [];
  for (const raw of traceContours(rasterizeMask(features))) {
    const smooth = radialSimplify(chaikin(raw), 0.05).map(([x, y]) => [
      Math.round(x * 100) / 100,
      Math.round(y * 100) / 100,
    ]);
    if (smooth.length >= 4 && ringArea(smooth) > minArea) rings.push(smooth);
  }
  return rings;
}

/** Clip an open polyline: keep in-bbox sub-segments. */
function clipLine(line) {
  const inBox = (p) =>
    p[0] >= BBOX.west && p[0] <= BBOX.east && p[1] >= BBOX.south && p[1] <= BBOX.north;
  const out = [];
  let cur = [];
  for (const p of line) {
    if (inBox(p)) {
      cur.push(p);
    } else if (cur.length > 1) {
      out.push(cur);
      cur = [];
    } else {
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function simplify(points) {
  const out = [];
  let last = null;
  for (const [lon, lat] of points) {
    const p = [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];
    if (!last || p[0] !== last[0] || p[1] !== last[1]) out.push(p);
    last = p;
  }
  return out;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

function eachRing(geom, fn) {
  if (geom.type === "Polygon") geom.coordinates.forEach((r) => fn(r));
  else if (geom.type === "MultiPolygon")
    geom.coordinates.forEach((p) => p.forEach((r) => fn(r)));
}

function eachLine(geom, fn) {
  if (geom.type === "LineString") fn(geom.coordinates);
  else if (geom.type === "MultiLineString") geom.coordinates.forEach((l) => fn(l));
}

async function buildBasemap() {
  const land = maskToRings(JSON.parse(await load("land")).features, 0.02);
  const lakes = maskToRings(JSON.parse(await load("lakes")).features, 0.005);
  const rivers = [];
  for (const f of JSON.parse(await load("rivers")).features) {
    if (!RIVER_NAMES.test(f.properties?.name ?? "")) continue;
    eachLine(f.geometry, (line) => {
      for (const seg of clipLine(line)) {
        const simple = simplify(seg);
        if (simple.length >= 2) rivers.push(simple);
      }
    });
  }
  console.log(
    `basemap: ${land.length} land rings, ${lakes.length} lakes, ${rivers.length} river segments`,
  );
  return {
    attribution: "Basemap: Natural Earth 1:50m (public domain, naturalearthdata.com).",
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    land,
    lakes,
    rivers,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

const outDir = join(ROOT, "data/places");
mkdirSync(outDir, { recursive: true });

const placesOut = await buildPlaces();
writeFileSync(join(outDir, "places.json"), JSON.stringify(placesOut));
console.log(`wrote data/places/places.json (${JSON.stringify(placesOut).length} bytes)`);

const basemapOut = await buildBasemap();
writeFileSync(join(outDir, "basemap.json"), JSON.stringify(basemapOut));
console.log(`wrote data/places/basemap.json (${JSON.stringify(basemapOut).length} bytes)`);
