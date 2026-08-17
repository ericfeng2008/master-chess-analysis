import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AnalysisHistoryEntry } from '../types'
import { AnalysisHistoryPanel } from './AnalysisHistoryPanel'

const entry = (id: string, depth: number, isLegacy = false, analysisScope: 'both' | 'white' | 'black' = 'both'): AnalysisHistoryEntry => ({
  id, game_id: 'game-1', analysis_fingerprint: `fingerprint-${id}`,
  created_at: depth === 18 ? '2026-07-18T18:00:00Z' : '2026-07-17T12:00:00Z',
  engine_depth: depth,
  request: { analysis_scope: analysisScope } as never,
  engine: { name: 'Stockfish 17' },
  maia: { model: 'maia3-79m' },
  metric_schema_version: isLegacy ? 3 : 4,
  is_legacy: isLegacy,
})

describe('AnalysisHistoryPanel', () => {
  it('identifies a restored result and selects an immutable prior version', () => {
    const select = vi.fn()
    render(<AnalysisHistoryPanel history={[entry('run-18', 18), entry('run-12', 12)]} activeRunId="run-18" cacheHit onSelect={select} />)
    expect(screen.getByText('Loaded saved analysis')).toBeInTheDocument()
    expect(screen.getAllByText(/Depth 18/)[0]).toBeInTheDocument()
    expect(screen.getByText(/Stockfish 17 · maia3-79m/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis history' }), { target: { value: 'run-12' } })
    expect(select).toHaveBeenCalledWith('run-12')
  })

  it('distinguishes a newly completed locally saved result', () => {
    render(<AnalysisHistoryPanel history={[entry('run-18', 18, false, 'white')]} activeRunId="run-18" cacheHit={false} onSelect={vi.fn()} />)
    expect(screen.getByText('Analysis saved locally')).toBeInTheDocument()
    expect(screen.getByText(/White only · Depth 18/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('labels explicitly restored schema-3 evidence as legacy', () => {
    render(<AnalysisHistoryPanel history={[entry('run-4', 18), entry('run-3', 16, true)]} activeRunId="run-3" cacheHit onSelect={vi.fn()} />)
    expect(screen.getByText('Legacy metric evidence · reanalyze for current CTI')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Depth 16.*Legacy/ })).toBeInTheDocument()
  })
})
