import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useExploration } from './useExploration'

describe('useExploration game switching', () => {
  it('discards both the active line and saved in-memory lines', () => {
    const { result } = renderHook(() => useExploration())
    act(() => result.current.startNewExploration(2, [{
      san: 'e4', fen: 'fen-after-e4', side: 'white', moveNumber: 1, evalResult: null,
    }]))
    act(() => result.current.exitExploration())
    expect(result.current.savedExplorations).toHaveLength(1)

    act(() => result.current.clearExplorations())
    expect(result.current.savedExplorations).toEqual([])
    expect(result.current.isExploring).toBe(false)
    expect(result.current.exploredMoves).toEqual([])
  })
})
