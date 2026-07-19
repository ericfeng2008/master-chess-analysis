import { describe, expect, it } from 'vitest'
import type { LogicalStoredGame } from '../types/mistakes'
import { SAVED_GAME_BACKEND_MISMATCH, validateSavedGameSummaryResponse, validateStoredGameOpenResponse } from './storedGameValidation'

const game = {
  id: 'game-1', normalized_pgn: '[Event "Test"]\n\n1. e4 *', mainline_uci: ['e2e4'], move_count: 1,
  analysis_history: [], metadata_missing: [], analysis: null,
} as unknown as LogicalStoredGame

describe('validateStoredGameOpenResponse', () => {
  it('accepts a complete matching stored game', () => {
    expect(() => validateStoredGameOpenResponse(game, 'game-1')).not.toThrow()
  })

  it('rejects mismatched or unrestorable data before analyzer state changes', () => {
    expect(() => validateStoredGameOpenResponse(game, 'game-2')).toThrow(/does not match/i)
    expect(() => validateStoredGameOpenResponse({ ...game, normalized_pgn: 'not a PGN' }, 'game-1')).toThrow(/restored safely/i)
  })

  it('accepts an open response without optional metadata completeness fields', () => {
    const response = { ...game } as unknown as Record<string, unknown>
    delete response.metadata_missing
    expect(() => validateStoredGameOpenResponse(response as unknown as LogicalStoredGame, 'game-1')).not.toThrow()
  })

  it('explains when a saved-game summary came from an older backend', () => {
    expect(() => validateSavedGameSummaryResponse({ id: 'legacy-game' } as never)).toThrow(SAVED_GAME_BACKEND_MISMATCH)
  })
})
