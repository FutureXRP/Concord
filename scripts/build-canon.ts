/**
 * Seeds concord_canon from data/canon/verse-counts.json — one row per real
 * verse (spec §6). Deterministic backing for the reference validator.
 *
 * Run: npm run build:canon
 */

import books from "../data/canon/books.json";
import verseCounts from "../data/canon/verse-counts.json";
import { getSupabase } from "../lib/supabase/client";

async function main() {
  const supabase = getSupabase();
  const counts = verseCounts as Record<string, number[]>;
  const canonSets = new Map(
    (books as { books: Array<{ id: string; canon_set: string[] }> }).books.map((b) => [
      b.id,
      b.canon_set,
    ]),
  );

  const rows: Array<{
    ref_norm: string;
    book: string;
    chapter: number;
    verse: number;
    canon_set: string[];
  }> = [];

  for (const [book, chapters] of Object.entries(counts)) {
    const canon_set = canonSets.get(book) ?? ["protestant"];
    chapters.forEach((verseCount, chIdx) => {
      for (let v = 1; v <= verseCount; v++) {
        rows.push({
          ref_norm: `${book}:${chIdx + 1}.${v}`,
          book,
          chapter: chIdx + 1,
          verse: v,
          canon_set,
        });
      }
    });
  }

  console.log(`Seeding concord_canon with ${rows.length} verses...`);
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from("concord_canon")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "ref_norm" });
    if (error) throw new Error(`batch ${i}: ${error.message}`);
    process.stdout.write(`\r${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log("\ndone");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
