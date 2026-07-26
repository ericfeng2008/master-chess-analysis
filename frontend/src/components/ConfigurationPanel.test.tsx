import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfigurationPanel } from './ConfigurationPanel'

describe('ConfigurationPanel CTI settings', () => {
  it('exposes the supported 0.2 to 0.4 pawn range', () => {
    render(
      <ConfigurationPanel
        showConfig
        setShowConfig={vi.fn()}
        engineDepth={18}
        setEngineDepth={vi.fn()}
        acceptableDrop={0.3}
        setAcceptableDrop={vi.fn()}
        minefieldThreshold={0.8}
        setMinefieldThreshold={vi.fn()}
        blunderThreshold={1}
        setBlunderThreshold={vi.fn()}
        mbiTrapThreshold={0.4}
        setMbiTrapThreshold={vi.fn()}
        mbiOutlierThreshold={0.05}
        setMbiOutlierThreshold={vi.fn()}
        eigThreshold={2}
        setEigThreshold={vi.fn()}
        briThreshold={0.05}
        setBriThreshold={vi.fn()}
        isAnalyzing={false}
        cancelAnalysis={vi.fn()}
        movesAnalyzed={0}
        totalMoves={0}
        minefieldsFound={0}
        analysisMaia3WhiteElo={null}
        analysisMaia3BlackElo={null}
        error={null}
        handleAnalyze={vi.fn()}
        hasPgn={false}
      />,
    )

    const acceptableDrop = screen.getAllByRole('slider')[1]
    expect(acceptableDrop).toHaveAttribute('min', '0.2')
    expect(acceptableDrop).toHaveAttribute('max', '0.4')
    expect(acceptableDrop).toHaveAttribute('step', '0.1')
    expect(acceptableDrop).toHaveValue('0.3')
  })

  it('exposes the supported 16 to 28 Stockfish-depth range', () => {
    render(
      <ConfigurationPanel
        showConfig
        setShowConfig={vi.fn()}
        engineDepth={18}
        setEngineDepth={vi.fn()}
        acceptableDrop={0.3}
        setAcceptableDrop={vi.fn()}
        minefieldThreshold={0.8}
        setMinefieldThreshold={vi.fn()}
        blunderThreshold={1}
        setBlunderThreshold={vi.fn()}
        mbiTrapThreshold={0.4}
        setMbiTrapThreshold={vi.fn()}
        mbiOutlierThreshold={0.05}
        setMbiOutlierThreshold={vi.fn()}
        eigThreshold={2}
        setEigThreshold={vi.fn()}
        briThreshold={0.05}
        setBriThreshold={vi.fn()}
        isAnalyzing={false}
        cancelAnalysis={vi.fn()}
        movesAnalyzed={0}
        totalMoves={0}
        minefieldsFound={0}
        analysisMaia3WhiteElo={null}
        analysisMaia3BlackElo={null}
        error={null}
        handleAnalyze={vi.fn()}
        hasPgn={false}
      />,
    )

    const engineDepth = screen.getAllByRole('slider')[0]
    expect(engineDepth).toHaveAttribute('min', '16')
    expect(engineDepth).toHaveAttribute('max', '28')
    expect(engineDepth).toHaveAttribute('step', '1')
    expect(engineDepth).toHaveValue('18')
  })

  it('exposes the supported 0.80 to 0.95 minefield-threshold range', () => {
    render(
      <ConfigurationPanel
        showConfig
        setShowConfig={vi.fn()}
        engineDepth={18}
        setEngineDepth={vi.fn()}
        acceptableDrop={0.3}
        setAcceptableDrop={vi.fn()}
        minefieldThreshold={0.8}
        setMinefieldThreshold={vi.fn()}
        blunderThreshold={1}
        setBlunderThreshold={vi.fn()}
        mbiTrapThreshold={0.4}
        setMbiTrapThreshold={vi.fn()}
        mbiOutlierThreshold={0.05}
        setMbiOutlierThreshold={vi.fn()}
        eigThreshold={2}
        setEigThreshold={vi.fn()}
        briThreshold={0.05}
        setBriThreshold={vi.fn()}
        isAnalyzing={false}
        cancelAnalysis={vi.fn()}
        movesAnalyzed={0}
        totalMoves={0}
        minefieldsFound={0}
        analysisMaia3WhiteElo={null}
        analysisMaia3BlackElo={null}
        error={null}
        handleAnalyze={vi.fn()}
        hasPgn={false}
      />,
    )

    const minefieldThreshold = screen.getAllByRole('slider')[2]
    expect(minefieldThreshold).toHaveAttribute('min', '0.8')
    expect(minefieldThreshold).toHaveAttribute('max', '0.95')
    expect(minefieldThreshold).toHaveAttribute('step', '0.05')
    expect(minefieldThreshold).toHaveValue('0.8')
  })
})
