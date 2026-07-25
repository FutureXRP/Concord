/**
 * KJV ingest (Tier A, Phase 1). Verse-level chunks:
 *   scripture:kjv:{book}:{ch}.{v}
 * Source: aruljohn/Bible-kjv (public domain text, JSON per book).
 */

import booksData from "../../data/canon/books.json";
import { insertChunks, upsertWork } from "./common";
import { manifestEntry } from "./index";

const SOURCE_BASE = "https://raw.githubusercontent.com/aruljohn/Bible-kjv/master";

export async function ingestKJV(): Promise<void> {
  manifestEntry("scripture:kjv");

  await upsertWork({
    id: "scripture:kjv",
    title: "King James Version",
    author: null,
    author_died_year: null,
    composed_year: 1611,
    composed_era: "post-reformation",
    tradition: "patristic-undivided",
    language_original: "en",
    translator: "KJV translation committees",
    license_tier: "A",
    license_note: "Public domain (outside the UK).",
    source_url: SOURCE_BASE,
    embeddable: true,
    authority_class: "scripture",
  });

  const books = (booksData as { books: Array<{ id: string; name: string }> }).books;

  for (const book of books) {
    const fileName = book.name.replaceAll(" ", "");
    const res = await fetch(`${SOURCE_BASE}/${fileName}.json`);
    if (!res.ok) throw new Error(`fetch ${fileName}: ${res.status}`);
    const data = (await res.json()) as {
      chapters: Array<{ chapter: string; verses: Array<{ verse: string; text: string }> }>;
    };

    const chunks = data.chapters.flatMap((ch) =>
      ch.verses.map((v) => {
        const refNorm = `${book.id}:${ch.chapter}.${v.verse}`;
        return {
          csid: `scripture:kjv:${book.id}:${ch.chapter}.${v.verse}`,
          work_id: "scripture:kjv",
          locator: `${ch.chapter}.${v.verse}`,
          body: v.text,
          source_type: "primary",
          stance: "neutral",
          scripture_refs: [refNorm],
        };
      }),
    );

    console.log(`\n${book.name}: ${chunks.length} verses`);
    await insertChunks(chunks);
  }
  console.log("KJV ingest complete");
}
