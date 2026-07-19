import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { suggestion } from '../../test/mistakeFixtures'
import { MistakeCapturePanel } from './MistakeCapturePanel'

const api={get:vi.fn(),save:vi.fn()}
vi.mock('../../api/mistakes',()=>({
  getMistakeSuggestions:(...args:unknown[])=>api.get(...args),
  saveMistakes:(...args:unknown[])=>api.save(...args),
}))

describe('MistakeCapturePanel',()=>{
  beforeEach(()=>{vi.clearAllMocks();api.get.mockResolvedValue({items:[suggestion()],study_side:'white'});api.save.mockResolvedValue({created:[{id:'m1',ply:12}],existing:[]})})
  it('explains the two immutable reasons and saves the selected suggestion once',async()=>{
    const changeSide=vi.fn()
    render(<MistakeCapturePanel analysisRunId="run-1" studySide="white" players={{white:'Master',black:'Opponent'}} onStudySideChange={changeSide} onJumpToMove={vi.fn()} onOpenLibrary={vi.fn()}/>)
    expect(screen.getByRole('button',{name:'White'})).toHaveAttribute('data-active','true')
    expect(screen.getByRole('button',{name:'White'})).toHaveAttribute('title','Master')
    fireEvent.click(screen.getByRole('button',{name:'Black'}))
    expect(changeSide).toHaveBeenCalledWith('black')
    expect(await screen.findByText('High-CTI mistake · Human-natural blunder')).toBeInTheDocument()
    expect(screen.getByText(/model estimate for the selected Elo context/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:/Save selected mistakes \(1\)/i}))
    await waitFor(()=>expect(api.save).toHaveBeenCalledWith('run-1','white',[12]))
    expect(await screen.findByText(/1 saved/i)).toBeInTheDocument()
  })
  it('shows the additional-mistake empty state when prior library items were suppressed',async()=>{
    api.get.mockResolvedValue({items:[],study_side:'white'})
    render(<MistakeCapturePanel analysisRunId="run-2" studySide="white" onStudySideChange={vi.fn()} onJumpToMove={vi.fn()} onOpenLibrary={vi.fn()}/>)
    expect(await screen.findByText('No additional mistakes for white.')).toBeInTheDocument()
    expect(screen.getByText(/already saved anywhere in this game’s history/i)).toBeInTheDocument()
  })
})
