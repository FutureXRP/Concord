import { describe, expect, it } from 'vitest'
import { localSparseSearch, localGetChunk } from '../lib/concord/localstore'
import { suggestPassages } from '../lib/concord/discover'
import { scanRefs } from '../lib/concord/trust'
import { schedule, maskText, type MemoryCard } from '../lib/concord/memory'

// The three Concord layers added around the paid tabs: Discovery (passage
// finder), Trust (deterministic reference verification), Retention (SM-2).

describe('discovery: suggestPassages', () => {
  it('merges contiguous verse hits into passage suggestions', () => {
    const hits = localSparseSearch('faith hope charity love', 80)
    const suggestions = suggestPassages(hits, 6)
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      // Labels look like "1 Corinthians 13:4-13" and previews are verbatim.
      expect(s.label).toMatch(/^[1-3]? ?[A-Za-z ]+ \d+:\d+(-\d+)?$/)
      expect(s.preview.length).toBeGreaterThan(0)
      expect(s.verseCount).toBeGreaterThanOrEqual(1)
    }
    // 1 Corinthians 13 is the canonical result for this query.
    expect(suggestions.some(s => s.label.startsWith('1 Corinthians 13'))).toBe(true)
  })

  it('returns nothing for scripture-free hit lists', () => {
    expect(suggestPassages([], 6)).toEqual([])
  })
})

describe('trust layer: scanRefs', () => {
  it('verifies real references and flags fabricated ones', () => {
    const refs = scanRefs('Compare John 3:16 with John 3:99 and Romans 8:28.')
    expect(refs).toHaveLength(3)
    expect(refs[0]).toMatchObject({ match: 'John 3:16', ok: true })
    expect(refs[1].ok).toBe(false)
    expect(refs[1].reason).toMatch(/John 3 has 36 verses/)
    expect(refs[2]).toMatchObject({ match: 'Romans 8:28', ok: true })
  })

  it('ignores lowercase alias collisions in ordinary prose', () => {
    // "mark 2 things" and "his job 1" must not become reference chips.
    expect(scanRefs('Please mark 2 things about his job 1 today.')).toHaveLength(0)
  })

  it('reports span positions that slice the original text correctly', () => {
    const text = 'See Genesis 1:1 for the beginning.'
    const [r] = scanRefs(text)
    expect(text.slice(r.start, r.end)).toBe('Genesis 1:1')
  })
})

describe('retention: SM-2 scheduling and masking', () => {
  const card: MemoryCard = {
    id: 'rom:8.28',
    label: 'Romans 8:28',
    verses: [{ verse: '8:28', text: 'And we know that all things work together for good to them that love God' }],
    addedAt: 0,
    reps: 0,
    ease: 2.5,
    intervalDays: 0,
    dueAt: 0,
  }

  it('grows the interval on success and resets on failure', () => {
    const now = 1_000_000
    const first = schedule(card, 4, now)
    expect(first.reps).toBe(1)
    expect(first.intervalDays).toBe(1)
    const second = schedule(first, 4, now)
    expect(second.intervalDays).toBe(3)
    const third = schedule(second, 4, now)
    expect(third.intervalDays).toBeGreaterThan(3)
    const lapsed = schedule(third, 0, now)
    expect(lapsed.reps).toBe(0)
    expect(lapsed.dueAt).toBe(now)
    // Ease never collapses below the SM-2 floor.
    let c = card
    for (let i = 0; i < 10; i++) c = schedule(c, 3, now)
    expect(c.ease).toBeGreaterThanOrEqual(1.3)
  })

  it('hides more words as repetitions increase, deterministically', () => {
    const text = 'And we know that all things work together for good'
    const hidden = (reps: number) => maskText(text, reps).filter(w => w.hidden).length
    expect(hidden(0)).toBeGreaterThan(0)
    expect(hidden(1)).toBeGreaterThanOrEqual(hidden(0))
    expect(hidden(3)).toBe(text.split(' ').length)
    // Same input, same mask — no RNG (project convention).
    expect(maskText(text, 1)).toEqual(maskText(text, 1))
  })
})

describe('verses lookup used by chips and the memory deck', () => {
  it('serves verbatim KJV text for a verified refNorm', () => {
    const chunk = localGetChunk('scripture:kjv:rom:8.28')
    expect(chunk).not.toBeNull()
    expect(chunk!.body_norm).toContain('all things work together for good')
  })
})
