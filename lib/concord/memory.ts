/**
 * Retention layer core — SM-2 spaced repetition + deterministic word
 * masking for scripture memorization. Pure code, no React, no storage:
 * the deck component owns persistence.
 */

export interface MemoryCard {
  id: string; // refNorm of first verse
  label: string; // "Romans 8:28"
  verses: Array<{ verse: string; text: string }>;
  addedAt: number;
  // SM-2 state
  reps: number;
  ease: number;
  intervalDays: number;
  dueAt: number;
}

const DAY_MS = 86400000;

/** SM-2. grade: 0 = forgot, 3 = hard, 4 = good, 5 = easy. */
export function schedule(card: MemoryCard, grade: 0 | 3 | 4 | 5, now: number): MemoryCard {
  let { reps, ease, intervalDays } = card;
  if (grade < 3) {
    reps = 0;
    intervalDays = 0; // again today
  } else {
    reps += 1;
    if (reps === 1) intervalDays = 1;
    else if (reps === 2) intervalDays = 3;
    else intervalDays = Math.round(intervalDays * ease);
    ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  }
  return { ...card, reps, ease, intervalDays, dueAt: now + intervalDays * DAY_MS };
}

/**
 * Deterministically hide a fraction of words based on repetition count —
 * every k-th word, no RNG (project convention), so the same card masks the
 * same way twice.
 */
export function maskText(text: string, reps: number): Array<{ word: string; hidden: boolean }> {
  const words = text.split(/\s+/);
  const fraction = reps <= 0 ? 0.3 : reps === 1 ? 0.55 : reps === 2 ? 0.8 : 1;
  const step = fraction >= 1 ? 1 : Math.max(1, Math.round(1 / fraction));
  return words.map((word, i) => ({ word, hidden: fraction >= 1 || i % step === step - 1 }));
}
