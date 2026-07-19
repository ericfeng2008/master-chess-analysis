import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { savedMistake } from '../../test/mistakeFixtures'
import { MistakeLibraryWorkspace } from './MistakeLibraryWorkspace'

const mocks={assess:vi.fn().mockResolvedValue(undefined),update:vi.fn(),saveTags:vi.fn(),remove:vi.fn(),openDetail:vi.fn(),setQuery:vi.fn(),refresh:vi.fn(),toggleSelected:vi.fn(),clearSelected:vi.fn(),closeDetail:vi.fn()}
let detail:ReturnType<typeof savedMistake>|null=null
vi.mock('../../hooks/useMistakeLibrary',()=>({useMistakeLibrary:()=>({query:{query:'',player_name:'',side:'',reason:'',tag:'',lifecycle:'active',practice_state:'',page:1,page_size:25},items:[savedMistake()],total:1,tags:[{id:'t1',name:'Calculation horizon',item_count:1},{id:'t2',name:'Opponent resource',item_count:0}],detail,selected:new Set<string>(),loading:false,saving:false,error:null,...mocks})}))
vi.mock('../../api/mistakes',()=>({getStoredGame:vi.fn()}))

describe('MistakeLibraryWorkspace',()=>{
  beforeEach(()=>{vi.clearAllMocks();detail=null})
  it('renders the compact game folio and minimal spoiler-safe practice',async()=>{
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.getByText('Master — Opponent · Open')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button',{name:'Practice'})[0])
    expect(screen.getByText(/played mistake.*hidden/i)).toBeInTheDocument()
    expect(screen.queryByText('Nxe5')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your move (SAN)'),{target:{value:'Bb5'}})
    fireEvent.click(screen.getByRole('button',{name:'Reveal'}))
    expect(screen.getByText('Nxe5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:/Understood/i}))
    await waitFor(()=>expect(mocks.assess).toHaveBeenCalledWith('mistake-1','Bb5','understood'))
    expect(await screen.findByText(/1 positions revisited/i)).toBeInTheDocument()
  })

  it('uses an in-app confirmation dialog before revealing without a move',()=>{
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button',{name:'Practice'}))
    fireEvent.click(screen.getByRole('button',{name:'Reveal without move'}))
    expect(screen.getByRole('dialog',{name:'Continue without submitting a move?'})).toBeInTheDocument()
    expect(screen.queryByText('Nxe5')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Keep thinking'}))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Reveal without move'}))
    fireEvent.click(screen.getByRole('button',{name:'Reveal solution'}))
    expect(screen.getByText('Nxe5')).toBeInTheDocument()
  })

  it('conceals the best move and line until the compact solution control is activated',()=>{
    detail=savedMistake()
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)

    const solution=screen.getByLabelText('Mistake solution')
    expect(within(solution).getByText('Nxe5')).toBeInTheDocument()
    expect(within(solution).queryByText('Bb5')).not.toBeInTheDocument()
    expect(within(solution).queryByText('Nf6')).not.toBeInTheDocument()
    const reveal=within(solution).getByRole('button',{name:'Reveal Best Move'})
    expect(reveal).toHaveAttribute('aria-expanded','false')

    fireEvent.click(reveal)

    expect(reveal).toHaveAttribute('aria-expanded','true')
    const region=within(solution).getByRole('region',{name:'Best move and line'})
    expect(within(region).getAllByText('Bb5')).not.toHaveLength(0)
    expect(within(region).getByText('Bb5 Nf6')).toBeInTheDocument()
    expect(solution.querySelector('.mistake-verdict')?.nextElementSibling).toHaveClass('mistake-solution-row')
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.saveTags).not.toHaveBeenCalled()
    expect(mocks.assess).not.toHaveBeenCalled()
  })

  it('conceals the solution again when another detail is selected or reopened',()=>{
    detail=savedMistake()
    const view=render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button',{name:'Reveal Best Move'}))
    expect(screen.getByText('Bb5 Nf6')).toBeInTheDocument()

    const second=savedMistake({
      id:'mistake-2',
      best_move:'Qd2',
      evidence:{...savedMistake().evidence,best_line:['Qd2','Qe7']},
    })
    detail=second
    view.rerender(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.queryByText('Qd2')).not.toBeInTheDocument()
    expect(screen.queryByText('Qd2 Qe7')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Reveal Best Move'})).toHaveAttribute('aria-expanded','false')

    detail=null
    view.rerender(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    detail=second
    view.rerender(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.queryByText('Qd2')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Reveal Best Move'})).toHaveAttribute('aria-expanded','false')
  })

  it('shows explicit empty states only after revealing incomplete solution data',()=>{
    detail=savedMistake({best_move:null,evidence:{...savedMistake().evidence,best_line:[]}})
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.queryByText('Best move unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText('No stored line')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Reveal Best Move'}))
    expect(screen.getByText('Best move unavailable')).toBeInTheDocument()
    expect(screen.getByText('No stored line')).toBeInTheDocument()
  })

  it('shows editable tags, note, lifecycle, history, and full-game controls',()=>{
    detail=savedMistake()
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.getByLabelText('Saved mistake detail')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your note'),{target:{value:'Check forcing replies'}})
    fireEvent.blur(screen.getByLabelText('Your note'))
    expect(mocks.update).toHaveBeenCalledWith({note:'Check forcing replies'})
    fireEvent.click(screen.getByLabelText('Opponent resource'))
    expect(mocks.saveTags).toHaveBeenCalledWith(['Calculation horizon','Opponent resource'])
    fireEvent.change(screen.getByLabelText('Add custom tag'),{target:{value:'Time trouble'}})
    fireEvent.click(screen.getByRole('button',{name:'Add tag'}))
    expect(mocks.saveTags).toHaveBeenCalledWith(['Calculation horizon','Time trouble'])
    fireEvent.click(screen.getByLabelText('Calculation horizon'))
    expect(mocks.saveTags).toHaveBeenCalledWith([])
    expect(screen.getByRole('button',{name:'Open full game'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Archive'})).toBeInTheDocument()
    expect(screen.queryByText(/R Reveal|1 Again|2 Understood|hotkey/i)).not.toBeInTheDocument()
  })

  it('exposes a dedicated player filter separate from game and note search',()=>{
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    fireEvent.change(screen.getByLabelText('Player name'),{target:{value:'Master'}})
    expect(mocks.setQuery).toHaveBeenCalledWith({player_name:'Master'})
    expect(screen.getByLabelText('Mistake made by')).toBeInTheDocument()
  })
})
