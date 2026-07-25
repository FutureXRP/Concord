/**
 * Westminster Shorter Catechism ingest (Tier A, Phase 1). One chunk per
 * question: confession:westminster-shorter:q{n}
 *
 * Source file: data/sources/westminster-shorter.json, an array of
 * { "q": 1, "question": "...", "answer": "...", "refs": ["ps:86", ...] }.
 * (The CCEL text is public domain; convert it to this shape once and check
 * the JSON into data/sources/.)
 */

import fs from "node:fs";
import path from "node:path";
import { extractReferences, buildRefNorm } from "../../lib/concord/canon";
import { insertChunks, upsertWork } from "./common";
import { manifestEntry } from "./index";

const SOURCE_FILE = path.join(process.cwd(), "data/sources/westminster-shorter.json");

export async function ingestWestminsterShorter(): Promise<void> {
  manifestEntry("confession:westminster-shorter");

  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(
      `Missing ${SOURCE_FILE}. Convert the public-domain CCEL text to JSON first (see file header).`,
    );
  }

  await upsertWork({
    id: "confession:westminster-shorter",
    title: "Westminster Shorter Catechism",
    author: "Westminster Assembly",
    author_died_year: null,
    composed_year: 1647,
    composed_era: "post-reformation",
    tradition: "reformed",
    language_original: "en",
    translator: null,
    license_tier: "A",
    license_note: "Public domain.",
    source_url: "https://www.ccel.org/ccel/anonymous/westminster2",
    embeddable: true,
    authority_class: "confessional-standard",
  });

  const items = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8")) as Array<{
    q: number;
    question: string;
    answer: string;
    refs?: string[];
  }>;

  const chunks = items.map((item, i) => {
    const body = `Q${item.q}. ${item.question}\nA. ${item.answer}`;
    // Proof-text refs: use provided normalized refs, else extract from text.
    const refs =
      item.refs ??
      extractReferences(body).map((r) =>
        buildRefNorm(r.book.id, r.chapter, r.verse, r.endChapter, r.endVerse),
      );
    return {
      csid: `confession:westminster-shorter:q${item.q}`,
      work_id: "confession:westminster-shorter",
      locator: `q${item.q}`,
      body,
      source_type: "primary",
      stance: "self-descriptive",
      prev_csid: i > 0 ? `confession:westminster-shorter:q${items[i - 1].q}` : null,
      next_csid: i < items.length - 1 ? `confession:westminster-shorter:q${items[i + 1].q}` : null,
      scripture_refs: refs,
    };
  });

  console.log(`Westminster Shorter Catechism: ${chunks.length} questions`);
  await insertChunks(chunks);
  console.log("done");
}
