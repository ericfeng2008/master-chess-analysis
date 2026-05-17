import { Chess } from 'chess.js'
import type { ParsedGame, ParsedMove } from '../types'

function stripVariations(text: string): string {
  let result = ''
  let depth = 0

  for (const char of text) {
    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth = Math.max(0, depth - 1)
    } else if (depth === 0) {
      result += char
    }
  }

  return result
}

function extractMainlineMovetext(pgn: string): string {
  const firstGame = pgn.split(/\n\s*\n(?=\[)/)[0] ?? pgn
  let movetext = firstGame
    .replace(/^\s*\[[^\]]*\]\s*$/gm, '')
    .replace(/\{[^}]*\}/g, '')

  movetext = stripVariations(movetext)

  return movetext
    .replace(/\$\d+/g, '')
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parsePgnToMoves(pgn: string): ParsedGame | null {
  const startingFen = new Chess().fen()

  try {
    const chess = new Chess()
    chess.loadPgn(pgn)
    if (chess.history().length > 0) {
      return replayFromHistory(chess.history(), startingFen)
    }
  } catch {
    // fall through to more tolerant parsing
  }

  const movetext = extractMainlineMovetext(pgn)
  if (!movetext) return null

  try {
    const chess = new Chess()
    chess.loadPgn(movetext)
    if (chess.history().length > 0) {
      return replayFromHistory(chess.history(), startingFen)
    }
  } catch {
    // fall through to manual replay
  }

  return replayMovetextManually(movetext)
}

function replayFromHistory(history: string[], startingFen: string): ParsedGame | null {
  if (history.length === 0) return null

  const replay = new Chess()
  const moves: ParsedMove[] = []

  for (let i = 0; i < history.length; i += 1) {
    replay.move(history[i])
    moves.push({
      index: i,
      moveNumber: Math.floor(i / 2) + 1,
      side: i % 2 === 0 ? 'white' : 'black',
      san: history[i],
      fen: replay.fen(),
    })
  }

  return { startingFen, moves }
}

function replayMovetextManually(movetext: string): ParsedGame | null {
  try {
    const chess = new Chess()
    const startingFen = chess.fen()
    const moves: ParsedMove[] = []

    const tokens = movetext.split(/\s+/).filter((token) => {
      if (!token) return false
      if (/^\d+\.(\.\.)?$/.test(token)) return false
      if (/^\d+\.\.\.$/.test(token)) return false
      return true
    })

    for (const token of tokens) {
      const result = chess.move(token)
      if (!result) break

      moves.push({
        index: moves.length,
        moveNumber: Math.floor(moves.length / 2) + 1,
        side: moves.length % 2 === 0 ? 'white' : 'black',
        san: token,
        fen: chess.fen(),
      })
    }

    if (moves.length === 0) return null
    return { startingFen, moves }
  } catch {
    return null
  }
}

export function replayMovesToParsedMoves(moveSequence: string[]): ParsedGame | null {
  try {
    const chess = new Chess()
    const startingFen = chess.fen()
    const moves: ParsedMove[] = []

    for (let i = 0; i < moveSequence.length; i += 1) {
      chess.move(moveSequence[i])
      moves.push({
        index: i,
        moveNumber: Math.floor(i / 2) + 1,
        side: i % 2 === 0 ? 'white' : 'black',
        san: moveSequence[i],
        fen: chess.fen(),
      })
    }

    return { startingFen, moves }
  } catch {
    return null
  }
}
