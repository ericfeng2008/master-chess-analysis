import { act, renderHook } from '@testing-library/react'
import type { ChangeEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PgnUploadResponse } from '../types'
import type { StoredGame } from '../types/mistakes'
import { useAnalyzerHandler, type AnalyzerHandlersDeps } from './useAnalyzerHandler'

const api = vi.hoisted(() => ({ upload: vi.fn(), getRun: vi.fn() }))
vi.mock('../api/client', () => ({ apiPostForm: (...args: unknown[]) => api.upload(...args) }))
vi.mock('../api/mistakes', () => ({ getAnalysisRun: (...args: unknown[]) => api.getRun(...args) }))

const history = [{
  id: 'run-1', game_id: 'game-1', analysis_fingerprint: 'analysis-1', created_at: '2026-07-18T12:00:00Z',
  engine_depth: 14, request: {} as never, engine: { name: 'Stockfish 17' }, maia: { model: 'maia3-79m' }, metric_schema_version: 2,
}]

const uploadResult = (overrides: Partial<PgnUploadResponse> = {}): PgnUploadResponse => ({
  pgn: '[Event "Test"]\n\n1. e4 *', num_games: 1, num_unique_games: 1,
  num_games_added: 1, num_games_existing: 0, num_duplicate_games: 0, num_games_saved: 1,
  num_variations: 0, max_depth: 1,
  game_id: 'game-1', fingerprint_version: 1, game_fingerprint: 'game-fingerprint',
  preferred_analysis_run_id: 'run-1', analysis_history: history, persistence_warning: null,
  ...overrides,
})

const storedRun = { id: 'run-1', game_id: 'game-1' } as unknown as StoredGame

function deps(overrides: Partial<AnalyzerHandlersDeps> = {}): AnalyzerHandlersDeps {
  return {
    ctiResult: null, selectMove: vi.fn(), startAnalysis: vi.fn(), isExploring: false,
    currentExplorationIndex: -1, exploredMoves: [], startNewExploration: vi.fn(), addExploredMove: vi.fn(),
    exitExploration: vi.fn(), navigateExploration: vi.fn(), savedExplorations: [], activeSavedIndex: -1,
    enterSavedExploration: vi.fn(), goTo: vi.fn(), hasResult: false, activeIndex: null, parsedMoves: [],
    pgn: '[Event "Test"]\n\n1. e4 *', gameId: 'game-1', acceptableDrop: .5, minefieldThreshold: .8,
    engineDepth: 14, blunderThreshold: 1, mbiTrapThreshold: .4, mbiOutlierThreshold: .05,
    eigThreshold: 2, briThreshold: .05, maia3WhiteElo: 2200, maia3BlackElo: 2200,
    setPgn: vi.fn(), setGameId: vi.fn(), setAnalysisHistory: vi.fn(), setImportPersistenceWarning: vi.fn(),
    clearAnalysis: vi.fn(), restoreImportedAnalysis: vi.fn(), setUploadSummary: vi.fn(), setImportNotice: vi.fn(), setUploadError: vi.fn(),
    setUploading: vi.fn(), setUploadedFileName: vi.fn(), setShowConfig: vi.fn(), variationState: null,
    setVariationState: vi.fn(), ...overrides,
  }
}

describe('useAnalyzerHandler local analysis restoration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('restores the preferred saved analysis and propagates game history on upload', async () => {
    api.upload.mockResolvedValue(uploadResult())
    api.getRun.mockResolvedValue(storedRun)
    const values = deps()
    const { result } = renderHook(() => useAnalyzerHandler(values))
    const file = new File(['1. e4 *'], 'game.pgn', { type: 'application/x-chess-pgn' })
    await act(() => result.current.handleFile({ target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>))
    expect(values.clearAnalysis).toHaveBeenCalled()
    expect(values.setGameId).toHaveBeenCalledWith('game-1')
    expect(values.setAnalysisHistory).toHaveBeenCalledWith(history)
    expect(values.restoreImportedAnalysis).toHaveBeenCalledWith(storedRun)
    expect(values.setShowConfig).toHaveBeenCalledWith(false)
  })

  it('notifies game-level state and resets the file input after import', async () => {
    const response = uploadResult({
      pgn: '[Event "First"]\n\n1. d4 *', num_games: 3, num_unique_games: 2,
      num_games_added: 2, num_duplicate_games: 1, num_games_saved: 2,
      preferred_analysis_run_id: null,
    })
    api.upload.mockResolvedValue(response)
    const onImportedGame = vi.fn()
    const values = deps({ onImportedGame })
    const { result } = renderHook(() => useAnalyzerHandler(values))
    const file = new File(['1. e4 *'], 'game.pgn')
    const target = { files: [file], value: '/fake/game.pgn' }
    await act(() => result.current.handleFile({ target } as unknown as ChangeEvent<HTMLInputElement>))
    expect(values.clearAnalysis).toHaveBeenCalledTimes(1)
    expect(values.setPgn).toHaveBeenCalledWith(response.pgn)
    expect(values.setUploadSummary).toHaveBeenCalledWith(response)
    expect(values.setImportNotice).toHaveBeenCalledWith(response)
    expect(onImportedGame).toHaveBeenCalledTimes(1)
    expect(onImportedGame).toHaveBeenCalledWith(expect.objectContaining({ game_id: 'game-1' }))
    expect(values.startAnalysis).not.toHaveBeenCalled()
    expect(target.value).toBe('')
  })

  it('keeps a first-time game ready and exposes persistence warnings', async () => {
    api.upload.mockResolvedValue(uploadResult({
      preferred_analysis_run_id: null, analysis_history: [], persistence_warning: 'Not saved locally',
    }))
    const values = deps()
    const { result } = renderHook(() => useAnalyzerHandler(values))
    const file = new File(['1. e4 *'], 'game.pgn')
    await act(() => result.current.handleFile({ target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>))
    expect(values.restoreImportedAnalysis).not.toHaveBeenCalled()
    expect(values.setImportPersistenceWarning).toHaveBeenCalledWith('Not saved locally')
    expect(values.setImportNotice).toHaveBeenCalledWith(expect.objectContaining({ persistence_warning: 'Not saved locally' }))
  })

  it('sends the logical game and current changed settings to analysis', () => {
    const values = deps({ engineDepth: 18 })
    const { result } = renderHook(() => useAnalyzerHandler(values))
    act(() => result.current.handleAnalyze())
    expect(values.startAnalysis).toHaveBeenCalledWith(
      values.pgn, 'game-1', .5, .8, 18, 1, .4, .05, 2, .05, 2200, 2200,
    )
  })
})
