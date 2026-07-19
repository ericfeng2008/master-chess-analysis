import { describe, expect, it } from 'vitest'
import { parsePgnToMoves } from './pgnParser'

describe('parsePgnToMoves', () => {
  it('replays a stored game from its declared initial FEN', () => {
    const pgn = '[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/6k1 w - - 0 1"]\n\n1. Kf3 *'
    const parsed = parsePgnToMoves(pgn)
    expect(parsed?.startingFen).toBe('8/8/8/8/8/8/4K3/6k1 w - - 0 1')
    expect(parsed?.moves).toHaveLength(1)
    expect(parsed?.moves[0]?.fen).toContain('5K2')
  })
})
