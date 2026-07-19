import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { suggestion } from '../test/mistakeFixtures'
import type { StoredGame } from '../types/mistakes'
import { useGameAnalysis } from './useGameAnalysis'

const api = vi.hoisted(() => ({ sse: vi.fn() }))
vi.mock('../api/client', () => ({ ssePost: (...args: unknown[]) => api.sse(...args) }))

describe('useGameAnalysis stored-game restore',()=>{
  beforeEach(() => vi.clearAllMocks())
  it('restores the persisted result and jumps to the saved mistake ply',()=>{
    const move=suggestion()
    const game={id:'run-1',normalized_pgn:'*',headers:{},request:{acceptable_drop:.5,minefield_threshold:.8,engine_depth:12,blunder_threshold:1,mbi_trap_threshold:.4,mbi_outlier_threshold:.05,eig_threshold:2,bri_threshold:.05,maia3_white_elo:2400,maia3_black_elo:2350},engine:{},maia:{},metric_schema_version:2,result:{moves:[{...move,best_line_evals:{},good_moves_with_eval:{},is_minefield:true,is_eig_flagged:false,is_brilliant:false,bri_maia_prob:null,eig_value:null,epe_score:null,mate_in:null,stockfish_eval:.4,eval_after:-.9}],minefields:[0]},created_at:'',updated_at:''} as unknown as StoredGame
    const {result}=renderHook(()=>useGameAnalysis())
    act(()=>result.current.restoreAnalysis(game,0))
    expect(result.current.result?.analysis_run_id).toBe('run-1')
    expect(result.current.selectedMoveIndex).toBe(0)
    expect(result.current.analysisMaia3WhiteElo).toBe(2400)
  })

  it('sends game identity and records an immediate compatible cache hit',()=>{
    api.sse.mockImplementation((_path: string, body: unknown, onMessage: (value: unknown) => void) => {
      expect(body).toMatchObject({ game_id: 'game-1', engine_depth: 18 })
      onMessage({
        type: 'complete', moves: [], minefields: [], analysis_run_id: 'run-18', game_id: 'game-1',
        cache_hit: true, analysis_history: [], persistence_warning: null,
      })
      return new AbortController()
    })
    const {result}=renderHook(()=>useGameAnalysis())
    act(()=>result.current.startAnalysis('1. e4 *','game-1',.5,.8,18,1,.4,.05,2,.05,2200,2200))
    expect(result.current.result?.analysis_run_id).toBe('run-18')
    expect(result.current.result?.cache_hit).toBe(true)
    expect(result.current.isAnalyzing).toBe(false)
  })
})
