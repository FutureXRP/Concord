#!/usr/bin/env node
/**
 * Build the passage artwork layer: Gustave Doré's Bible illustrations.
 *
 * Source: GITenberg mirror of Project Gutenberg #8710, "The Doré Bible
 * Gallery, Complete" (100 plates, 1866 engravings; public domain — Doré
 * died 1883). License checked before ingest: PG metadata declares
 * "Public domain in the USA"; the artwork itself is PD worldwide. The
 * Project Gutenberg trademark license applies only to PG branding, which
 * this pipeline strips (images + our own metadata only).
 *
 * Passage assignments follow the plates' printed KJV citations where the
 * source volume prints one (77 of 100); the remaining plates are identified
 * editorially from the KJV text the volume quotes beneath them, and are
 * marked curated:true.
 *
 * Outputs:
 *  - data/art/dore.json      — plate metadata + chapter-level match keys
 *  - public/art/dore/NNN.jpg — recompressed plates (sharp, quality 78)
 *
 * Usage: node scripts/sources/build-art.mjs [--skip-images]
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const RAW_BASE =
  "https://raw.githubusercontent.com/GITenberg/The-Dor--Bible-Gallery-Complete--13-Containing-One-Hundred-Superb-Illustrations-and-a-Page-of-__8710/master/8710-h/images";

// [plate, title, display ref, match keys ("book:chapter" | "book:*"), curated]
// curated=1 → the source volume printed no citation; assignment is editorial,
// identified from the KJV text quoted beneath the plate.
const PLATES = [
  ["001", "The Creation of Eve", "Genesis 2:18, 21-24", ["gen:2"], 0],
  ["002", "The Expulsion from the Garden", "Genesis 3:22-24", ["gen:3"], 0],
  ["003", "The Murder of Abel", "Genesis 4:1-16", ["gen:4"], 0],
  ["004", "The Deluge", "Genesis 7:11-24", ["gen:7"], 0],
  ["005", "Noah Cursing Ham", "Genesis 9:18-27", ["gen:9"], 0],
  ["006", "The Tower of Babel", "Genesis 11:1-9", ["gen:11"], 0],
  ["007", "Abraham Entertains Three Strangers", "Genesis 18:1-8", ["gen:18", "heb:13"], 0],
  ["008", "The Destruction of Sodom", "Genesis 19:15-28", ["gen:19"], 0],
  ["009", "The Expulsion of Hagar", "Genesis 21:1-14", ["gen:21"], 0],
  ["010", "Hagar in the Wilderness", "Genesis 21:14-21", ["gen:21"], 0],
  ["011", "The Trial of the Faith of Abraham", "Genesis 22:1-14", ["gen:22"], 1],
  ["012", "The Burial of Sarah", "Genesis 23", ["gen:23"], 0],
  ["013", "Eliezer and Rebekah", "Genesis 24:9-28", ["gen:24"], 0],
  ["014", "Isaac Blessing Jacob", "Genesis 27:1-29", ["gen:27"], 0],
  ["015", "Jacob Tending the Flocks of Laban", "Genesis 29:9-30", ["gen:29"], 0],
  ["016", "Joseph Sold into Egypt", "Genesis 37:12-36", ["gen:37"], 1],
  ["017", "Joseph Interpreting Pharaoh's Dream", "Genesis 41:1-36", ["gen:41"], 0],
  ["018", "Joseph Making Himself Known to His Brethren", "Genesis 45:1-18", ["gen:45"], 0],
  ["019", "Moses in the Bulrushes", "Exodus 2:1-10", ["exod:2"], 0],
  ["020", "The War Against Gibeon", "Joshua 10:5-20", ["josh:10"], 0],
  ["021", "Sisera Slain by Jael", "Judges 4:2-22", ["judg:4"], 0],
  ["022", "Deborah's Song of Triumph", "Judges 5:2-5, 24-31", ["judg:5"], 0],
  ["023", "Jephthah Met by His Daughter", "Judges 11:29-34", ["judg:11"], 0],
  ["024", "Jephthah's Daughter and Her Companions", "Judges 11:35-40", ["judg:11"], 0],
  ["025", "Samson Slaying the Lion", "Judges 14:5-6", ["judg:14"], 0],
  ["026", "Samson and Delilah", "Judges 16:4-20", ["judg:16"], 0],
  ["027", "The Death of Samson", "Judges 16:21-31", ["judg:16"], 0],
  ["028", "Naomi and Her Daughters in Law", "Ruth 1:1-19", ["ruth:1"], 0],
  ["029", "Ruth and Boaz", "Ruth 2:1-17", ["ruth:2"], 0],
  ["030", "The Return of the Ark", "1 Samuel 6:1-15", ["1sam:6"], 0],
  ["031", "Saul and David", "1 Samuel 18:6-16", ["1sam:18"], 1],
  ["032", "David Sparing Saul", "1 Samuel 24", ["1sam:24", "1sam:26"], 1],
  ["033", "Death of Saul", "1 Samuel 31", ["1sam:31"], 0],
  ["034", "The Death of Absalom", "2 Samuel 18:1-17", ["2sam:18"], 0],
  ["035", "David Mourning over Absalom", "2 Samuel 18:33-19:4", ["2sam:18", "2sam:19"], 1],
  ["036", "Solomon", "2 Samuel 5:13-16", ["2sam:5", "1kgs:4"], 0],
  ["037", "The Judgment of Solomon", "1 Kings 3:16-28", ["1kgs:3"], 0],
  ["038", "The Cedars Destined for the Temple", "1 Kings 5", ["1kgs:5"], 0],
  ["039", "The Prophet Slain by a Lion", "1 Kings 13:11-30", ["1kgs:13"], 1],
  ["040", "Elijah Destroying the Messengers of Ahaziah", "2 Kings 1:2-17", ["2kgs:1"], 0],
  ["041", "Elijah's Ascent in a Chariot of Fire", "2 Kings 2:1-14", ["2kgs:2"], 1],
  ["042", "The Death of Jezebel", "2 Kings 9:30-37", ["2kgs:9"], 0],
  ["043", "Esther Confounding Haman", "Esther 7", ["esth:7"], 0],
  ["044", "Isaiah", "The book of Isaiah", ["isa:*"], 1],
  ["045", "Destruction of Sennacherib's Host", "2 Kings 19:32-37", ["2kgs:19", "isa:37"], 0],
  ["046", "Baruch", "Jeremiah 36:1-4", ["jer:36"], 0],
  ["047", "Ezekiel Prophesying", "The book of Ezekiel", ["ezek:*"], 1],
  ["048", "The Vision of Ezekiel", "Ezekiel 37:1-14", ["ezek:37"], 0],
  ["049", "Daniel", "The book of Daniel", ["dan:*"], 1],
  ["050", "The Fiery Furnace", "Daniel 3:8-27", ["dan:3"], 0],
  ["051", "Belshazzar's Feast", "Daniel 5", ["dan:5"], 0],
  ["052", "Daniel in the Lions' Den", "Daniel 6", ["dan:6"], 0],
  ["053", "The Prophet Amos", "The book of Amos", ["amos:*"], 1],
  ["054", "Jonah Calling Nineveh to Repentance", "Jonah 3", ["jonah:3"], 0],
  ["055", "Daniel Confounding the Priests of Bel", "Bel and the Dragon (Apocrypha)", [], 1],
  ["056", "Heliodorus Punished in the Temple", "2 Maccabees 3:23-29", ["2macc:3"], 0],
  ["057", "The Nativity", "Luke 2:1-20", ["luke:2"], 0],
  ["058", "The Star in the East", "Matthew 2:1-10", ["matt:2"], 1],
  ["059", "The Flight into Egypt", "Matthew 2:13-15", ["matt:2"], 0],
  ["060", "The Massacre of the Innocents", "Matthew 2:16-18", ["matt:2"], 0],
  ["061", "Jesus Questioning the Doctors", "Luke 2:41-52", ["luke:2"], 0],
  ["062", "Jesus Healing the Sick", "Matthew 4:23-25", ["matt:4", "luke:4"], 1],
  ["063", "Sermon on the Mount", "Matthew 5", ["matt:5"], 1],
  ["064", "Christ Stilling the Tempest", "Matthew 8:23-27", ["matt:8", "mark:4"], 0],
  ["065", "The Dumb Man Possessed", "Matthew 9:32-34", ["matt:9"], 0],
  ["066", "Christ in the Synagogue", "Matthew 13:53-58", ["matt:13"], 0],
  ["067", "The Disciples Plucking Corn on the Sabbath", "Mark 2:23-28", ["mark:2"], 0],
  ["068", "Jesus Walking on the Water", "Mark 6:46-52", ["mark:6", "matt:14"], 0],
  ["069", "Christ's Entry into Jerusalem", "Matthew 21:1-11", ["matt:21", "mark:11", "luke:19", "john:12"], 1],
  ["070", "Jesus and the Tribute Money", "Mark 12:13-17", ["mark:12"], 0],
  ["071", "The Widow's Mite", "Mark 12:41-44", ["mark:12", "luke:21"], 0],
  ["072", "Raising of the Daughter of Jairus", "Mark 5:22-43", ["mark:5", "luke:8"], 0],
  ["073", "The Good Samaritan", "Luke 10:29-37", ["luke:10"], 0],
  ["074", "Arrival of the Samaritan at the Inn", "Luke 10:33-34", ["luke:10"], 0],
  ["075", "The Prodigal Son", "Luke 15:11-32", ["luke:15"], 0],
  ["076", "Lazarus and the Rich Man", "Luke 16:19-31", ["luke:16"], 0],
  ["077", "The Pharisee and the Publican", "Luke 18:9-14", ["luke:18"], 0],
  ["078", "Jesus and the Woman of Samaria", "John 4:5-30", ["john:4"], 0],
  ["079", "Jesus and the Woman Taken in Adultery", "John 8:1-11", ["john:8"], 1],
  ["080", "The Resurrection of Lazarus", "John 11:30-45", ["john:11"], 0],
  ["081", "Mary Magdalene", "Luke 8:1-3", ["luke:8"], 1],
  ["082", "The Last Supper", "Matthew 26:17-30", ["matt:26", "mark:14", "luke:22", "john:13"], 0],
  ["083", "The Agony in the Garden", "Luke 22:39-46", ["luke:22"], 0],
  ["084", "Prayer of Jesus in the Garden of Olives", "Matthew 26:36-46", ["matt:26"], 0],
  ["085", "The Betrayal", "Mark 14:41-50", ["mark:14"], 0],
  ["086", "Christ Fainting Under the Cross", "Matthew 27:31-32", ["matt:27"], 1],
  ["087", "The Flagellation", "Matthew 27:26", ["matt:27", "john:19"], 0],
  ["088", "The Crucifixion", "Matthew 27:33-38", ["matt:27", "mark:15", "luke:23", "john:19"], 1],
  ["089", "Close of the Crucifixion", "Matthew 27:45-56", ["matt:27"], 0],
  ["090", "The Burial of Jesus", "Matthew 27:57-61", ["matt:27"], 0],
  ["091", "The Angel at the Sepulchre", "Matthew 28:1-8", ["matt:28"], 0],
  ["092", "The Journey to Emmaus", "Luke 24:13-35", ["luke:24"], 0],
  ["093", "The Ascension", "Luke 24:50-53", ["luke:24", "acts:1"], 0],
  ["094", "The Martyrdom of St. Stephen", "Acts 7:54-60", ["acts:7"], 1],
  ["095", "Saul's Conversion", "Acts 9:1-20", ["acts:9"], 0],
  ["096", "The Deliverance of St. Peter", "Acts 12:1-11", ["acts:12"], 0],
  ["097", "Paul at Ephesus", "Acts 19:1-20", ["acts:19"], 1],
  ["098", "Paul Menaced by the Jews", "Acts 21:27-40", ["acts:21"], 0],
  ["099", "Paul's Shipwreck", "Acts 27:14-44", ["acts:27"], 1],
  ["100", "Death on the Pale Horse", "Revelation 6:7-8", ["rev:6"], 0],
];

// ─── Validate match keys against the canon ─────────────────────────────────

const booksData = JSON.parse(readFileSync(join(ROOT, "data/canon/books.json"), "utf8"));
const counts = JSON.parse(
  readFileSync(join(ROOT, "data/canon/verse-counts.json"), "utf8"),
);
const bookIds = new Set(
  [...booksData.books, ...booksData.deuterocanon].map((b) => b.id),
);

let bad = 0;
for (const [n, title, , matches] of PLATES) {
  for (const key of matches) {
    const [book, ch] = key.split(":");
    if (!bookIds.has(book)) {
      console.error(`plate ${n} (${title}): unknown book "${book}"`);
      bad++;
      continue;
    }
    if (ch !== "*" && counts[book] && parseInt(ch, 10) > counts[book].length) {
      console.error(`plate ${n} (${title}): ${book} has ${counts[book].length} chapters, key ${key}`);
      bad++;
    }
  }
}
if (bad > 0) {
  console.error(`${bad} invalid match keys — aborting`);
  process.exit(1);
}
console.log(`validated ${PLATES.length} plates against the canon`);

// ─── Write metadata ────────────────────────────────────────────────────────

const meta = {
  attribution:
    "Engravings by Gustave Doré (1832-1883) for La Grande Bible de Tours (1866), from the Doré Bible Gallery (1879). Public domain. Digitized by Project Gutenberg (#8710). Passage assignments follow the plates' printed KJV citations where present; plates marked curated were identified editorially from the KJV text quoted beneath them.",
  plates: PLATES.map(([n, title, display, matches, curated]) => ({
    n,
    title,
    display,
    matches,
    ...(curated ? { curated: true } : {}),
  })),
};

mkdirSync(join(ROOT, "data/art"), { recursive: true });
writeFileSync(join(ROOT, "data/art/dore.json"), JSON.stringify(meta, null, 1));
console.log(`wrote data/art/dore.json (${PLATES.length} plates)`);

// ─── Fetch + recompress images ─────────────────────────────────────────────

if (process.argv.includes("--skip-images")) {
  console.log("--skip-images: done");
  process.exit(0);
}

const sharp = require("sharp");
const outDir = join(ROOT, "public/art/dore");
mkdirSync(outDir, { recursive: true });

let fetched = 0;
let skipped = 0;
let bytes = 0;
for (const [n] of PLATES) {
  const out = join(outDir, `${n}.jpg`);
  if (existsSync(out)) {
    skipped++;
    continue;
  }
  const res = await fetch(`${RAW_BASE}/${n}.jpg`);
  if (!res.ok) throw new Error(`plate ${n}: HTTP ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());
  const output = await sharp(input)
    .resize({ width: 900, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  writeFileSync(out, output);
  bytes += output.length;
  fetched++;
  if (fetched % 20 === 0) console.log(`  ${fetched} plates fetched…`);
}
console.log(
  `images: ${fetched} fetched+recompressed (${(bytes / 1048576).toFixed(1)} MB), ${skipped} already present`,
);
