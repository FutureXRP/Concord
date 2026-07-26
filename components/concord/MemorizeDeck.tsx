"use client";

/**
 * Memorize — scripture memorization with SM-2 spaced repetition.
 *
 * Entirely client-side: the deck lives in localStorage, scheduling and the
 * deterministic progressive word-hiding live in lib/concord/memory, and
 * verse text comes verbatim from the in-browser corpus. No account, no
 * server, no cost.
 */

import React, { useEffect, useMemo, useState } from "react";
import { schedule, maskText, type MemoryCard } from "@/lib/concord/memory";
import { clientVerses } from "@/lib/concord/browser/engine";

const DECK_KEY = "concord-memory-deck-v1";
const DAY_MS = 86400000;

export function loadDeck(): MemoryCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DECK_KEY);
    const deck = raw ? JSON.parse(raw) : [];
    return Array.isArray(deck) ? deck : [];
  } catch {
    return [];
  }
}

export function saveDeck(deck: MemoryCard[]): void {
  try {
    window.localStorage.setItem(DECK_KEY, JSON.stringify(deck));
  } catch {
    // Storage full or blocked — the session still works.
  }
}

/** Add a passage to the deck from anywhere in the demo. */
export async function addToDeck(refText: string): Promise<string | null> {
  const v = await clientVerses(refText);
  if (!v.ok || v.verses.length === 0 || !v.refNorm || !v.label) return null;
  const deck = loadDeck();
  if (!deck.some((c) => c.id === v.refNorm)) {
    deck.push({
      id: v.refNorm,
      label: v.label,
      verses: v.verses.map((x) => ({ verse: x.verse, text: x.text })),
      addedAt: Date.now(),
      reps: 0,
      ease: 2.5,
      intervalDays: 0,
      dueAt: Date.now(),
    });
    saveDeck(deck);
  }
  return v.label;
}

function PracticeCard({ card, onGrade }: { card: MemoryCard; onGrade: (g: 0 | 3 | 4 | 5) => void }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setRevealed(false), [card.id]);

  const masked = useMemo(
    () => card.verses.map((v) => ({ verse: v.verse, words: maskText(v.text, card.reps) })),
    [card],
  );

  return (
    <div className="section-card practice-card">
      <div className="suggestion-head">
        <h3>{card.label}</h3>
        <span className="atlas-note">
          {card.reps === 0 ? "new" : `rep ${card.reps} · every ${card.intervalDays || 1}d`} · KJV
        </span>
      </div>
      {masked.map((v) => (
        <p key={v.verse} className="practice-text">
          <sup>{v.verse.split(":")[1] ?? v.verse}</sup>{" "}
          {v.words.map((w, i) => (
            <React.Fragment key={i}>
              {w.hidden && !revealed ? (
                <span className="masked-word">{w.word.replace(/[\w']/g, "·")}</span>
              ) : (
                <span>{w.word}</span>
              )}{" "}
            </React.Fragment>
          ))}
        </p>
      ))}
      <div className="suggestion-actions">
        {!revealed ? (
          <button type="button" className="primary" onClick={() => setRevealed(true)}>
            Reveal the passage
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onGrade(0)}>Forgot</button>
            <button type="button" onClick={() => onGrade(3)}>Hard</button>
            <button type="button" className="primary" onClick={() => onGrade(4)}>Good</button>
            <button type="button" onClick={() => onGrade(5)}>Easy</button>
          </>
        )}
      </div>
    </div>
  );
}

export function MemorizeDeck() {
  const [deck, setDeck] = useState<MemoryCard[] | null>(null);
  const [sessionDone, setSessionDone] = useState(0);
  const [addInput, setAddInput] = useState("");
  const [addNote, setAddNote] = useState("");

  useEffect(() => setDeck(loadDeck()), []);

  if (deck === null) return <p className="atlas-note">Loading your deck…</p>;

  const now = Date.now();
  const due = deck.filter((c) => c.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
  const current = due[0];

  const grade = (g: 0 | 3 | 4 | 5) => {
    if (!current) return;
    const next = deck.map((c) => (c.id === current.id ? schedule(c, g, now) : c));
    saveDeck(next);
    setDeck(next);
    if (g >= 3) setSessionDone((n) => n + 1);
  };

  const add = async () => {
    const label = await addToDeck(addInput.trim());
    setAddNote(label ? `✓ ${label} added` : "Could not add that reference.");
    setDeck(loadDeck());
    if (label) setAddInput("");
  };

  return (
    <div>
      <form
        className="query-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          placeholder="Add a passage — Romans 8:28, Psalm 23, John 3:16-17…"
          aria-label="Passage to memorize"
        />
        <button type="submit">Add to deck</button>
      </form>
      {addNote && <p className="atlas-note" style={{ marginTop: -6 }}>{addNote}</p>}

      {deck.length === 0 && (
        <p className="atlas-note">
          Your deck is empty. Add a passage above, or send one over from the Find tab. Everything
          is stored on this device — no account needed.
        </p>
      )}

      {deck.length > 0 && current && <PracticeCard card={current} onGrade={grade} />}

      {deck.length > 0 && !current && (
        <div className="section-card">
          <p style={{ margin: 0 }}>
            {sessionDone > 0
              ? `Session complete — ${sessionDone} passage${sessionDone === 1 ? "" : "s"} reviewed. `
              : ""}
            Nothing due right now. Spaced repetition works because the gaps grow — come back when a
            card falls due.
          </p>
        </div>
      )}

      {deck.length > 0 && (
        <div className="deck-list">
          <h3>
            Your deck · {deck.length} passage{deck.length === 1 ? "" : "s"} · {due.length} due
          </h3>
          {deck
            .slice()
            .sort((a, b) => a.dueAt - b.dueAt)
            .map((c) => (
              <div key={c.id} className="deck-row">
                <span>{c.label}</span>
                <span className="deck-meta">
                  {c.dueAt <= now
                    ? "due now"
                    : `due in ${Math.max(1, Math.round((c.dueAt - now) / DAY_MS))}d`}
                  <button
                    type="button"
                    title="Remove from deck"
                    onClick={() => {
                      const next = deck.filter((x) => x.id !== c.id);
                      saveDeck(next);
                      setDeck(next);
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
