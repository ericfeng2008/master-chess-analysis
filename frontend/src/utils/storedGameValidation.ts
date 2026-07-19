import type { LogicalStoredGame, StoredGameSummary } from '../types/mistakes'
import { parsePgnToMoves } from './pgnParser'

export const SAVED_GAME_BACKEND_MISMATCH = 'Saved-game actions need the current local backend. Restart the backend, then reopen the library.'

export function validateSavedGameSummaryResponse(game: StoredGameSummary) {
  const candidate = game as Partial<StoredGameSummary>
  if (!candidate.metadata || !candidate.metadata_sources || !Array.isArray(candidate.metadata_missing)) {
    throw new Error(SAVED_GAME_BACKEND_MISMATCH)
  }
}

export function validateStoredGameOpenResponse(game: LogicalStoredGame, expectedId: string) {
  if (!game || game.id !== expectedId || typeof game.normalized_pgn !== 'string' || !game.normalized_pgn.trim()) {
    throw new Error('The saved game response is incomplete or does not match the selected game.')
  }
  if (!Array.isArray(game.mainline_uci) || !Array.isArray(game.analysis_history)) {
    throw new Error('The saved game response contains invalid game data.')
  }
  const parsed = parsePgnToMoves(game.normalized_pgn)
  if (game.move_count > 0 && (!parsed || parsed.moves.length !== game.move_count)) {
    throw new Error('The saved game PGN could not be restored safely.')
  }
  if (game.analysis && (game.analysis.game_id !== game.id || !Array.isArray(game.analysis.result?.moves))) {
    throw new Error('The saved analysis does not belong to the selected game.')
  }
}
