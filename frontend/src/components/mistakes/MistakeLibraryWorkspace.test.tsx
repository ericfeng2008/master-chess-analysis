import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { denseMistake, practiceAttempts, savedMistake } from '../../test/mistakeFixtures'
import { MistakeLibraryWorkspace } from './MistakeLibraryWorkspace'

const mocks={assess:vi.fn().mockResolvedValue(undefined),update:vi.fn(),saveTags:vi.fn(),remove:vi.fn(),openDetail:vi.fn(),setQuery:vi.fn(),refresh:vi.fn(),toggleSelected:vi.fn(),clearSelected:vi.fn(),closeDetail:vi.fn()}
let detail:ReturnType<typeof savedMistake>|null=null
let items:ReturnType<typeof savedMistake>[]=[savedMistake()]
let selected=new Set<string>()
vi.mock('../../hooks/useMistakeLibrary',()=>({useMistakeLibrary:()=>({query:{query:'',player_name:'',side:'',reason:'',tag:'',lifecycle:'active',practice_state:'',page:1,page_size:25},items,total:items.length,tags:[{id:'t1',name:'Calculation horizon',item_count:1},{id:'t2',name:'Opponent resource',item_count:0}],detail,selected,loading:false,saving:false,error:null,...mocks})}))
vi.mock('../../api/mistakes',()=>({getStoredGame:vi.fn()}))

describe('MistakeLibraryWorkspace',()=>{
  beforeEach(()=>{vi.clearAllMocks();detail=null;items=[savedMistake()];selected=new Set()})

  it('renders the compact folio and spoiler-safe practice flow',async()=>{
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.getByText('Master — Opponent · Open')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Practice this view'}))
    expect(screen.getByText(/played mistake.*hidden/i)).toBeInTheDocument()
    expect(screen.queryByText('Nxe5')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your move (SAN)'),{target:{value:'Bb5'}})
    fireEvent.click(screen.getByRole('button',{name:'Reveal'}))
    expect(screen.getByText('Nxe5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:/Understood/i}))
    await waitFor(()=>expect(mocks.assess).toHaveBeenCalledWith('mistake-1','Bb5','understood'))
  })

  it('uses task-oriented detail views and keeps primary actions visible',()=>{
    detail=savedMistake()
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.getByRole('tab',{name:'Study'})).toHaveAttribute('aria-selected','true')
    expect(screen.getAllByRole('button',{name:'Practice'})).toHaveLength(1)
    expect(screen.getByRole('button',{name:'Open full game'})).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('tab',{name:'Study'}),{key:'ArrowRight'})
    expect(screen.getByRole('tab',{name:'Notes & Tags'})).toHaveAttribute('aria-selected','true')
    expect(screen.getByRole('tab',{name:'Notes & Tags'})).toHaveFocus()
    expect(screen.getByLabelText('Your note')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your note'),{target:{value:'Check forcing replies'}})
    fireEvent.blur(screen.getByLabelText('Your note'))
    expect(mocks.update).toHaveBeenCalledWith({note:'Check forcing replies'})
    fireEvent.click(screen.getByRole('button',{name:'Add tag'}))
    fireEvent.click(screen.getByLabelText('Opponent resource'))
    expect(mocks.saveTags).toHaveBeenCalledWith(['Calculation horizon','Opponent resource'])
    fireEvent.click(screen.getByRole('tab',{name:'History'}))
    expect(screen.getByText('No practice attempts yet.')).toBeInTheDocument()
    expect(screen.getAllByRole('button',{name:'Practice'})).toHaveLength(1)
    expect(screen.queryByRole('button',{name:'More'})).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Archive'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Delete mistake'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Archive'}))
    expect(mocks.update).toHaveBeenCalledWith({lifecycle:'archived'})
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button',{name:'Delete mistake'}))
    expect(confirm).toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('conceals the complete solution until revealed and resets it for another mistake',()=>{
    detail=denseMistake()
    const view=render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    const solution=screen.getByLabelText('Mistake solution')
    expect(within(solution).queryByText('Bb5')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Reveal Best Move'}))
    expect(within(solution).getByText('Bb5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'View complete line'}))
    expect(screen.getByRole('dialog',{name:'Complete best line'})).toHaveTextContent('Bb5 Nf6 Nc3')
    fireEvent.click(screen.getByRole('button',{name:'Back to study'}))
    detail=savedMistake({id:'mistake-2',best_move:'Qd2',evidence:{...savedMistake().evidence,best_line:['Qd2','Qe7']}})
    view.rerender(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.getByRole('tab',{name:'Study'})).toHaveAttribute('aria-selected','true')
    expect(screen.queryByText('Qd2')).not.toBeInTheDocument()
  })

  it('paginates long practice history locally',()=>{
    detail=savedMistake({attempts:practiceAttempts(5),practice_count:5})
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    fireEvent.click(screen.getByRole('tab',{name:'History'}))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getAllByText(/Qe2.*not acceptable/)).toHaveLength(2)
    fireEvent.click(within(screen.getByLabelText('Practice history')).getByRole('button',{name:'Next'}))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('keeps every discovery filter visible in one toolbar',()=>{
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    fireEvent.change(screen.getByLabelText('Player name'),{target:{value:'Master'}})
    expect(mocks.setQuery).toHaveBeenCalledWith({player_name:'Master'})
    fireEvent.change(screen.getByLabelText('Mistake made by'),{target:{value:'white'}})
    expect(mocks.setQuery).toHaveBeenCalledWith({side:'white'})
    expect(screen.getByLabelText('Capture reason')).toBeInTheDocument()
    expect(screen.getByLabelText('Tag')).toBeInTheDocument()
    expect(screen.getByLabelText('Practice state')).toBeInTheDocument()
    expect(screen.getByLabelText('Library state')).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Filters'})).not.toBeInTheDocument()
  })

  it('keeps selection controls inside the folio and supports arrow navigation',()=>{
    const second=savedMistake({id:'mistake-2',move_number:8,played_move:'Qe2'})
    items=[savedMistake(),second];selected=new Set(['mistake-1'])
    render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.queryByText('Practice selection')).toBeInTheDocument()
    const first=screen.getByRole('button',{name:/Master — Opponent.*Nxe5/i})
    fireEvent.keyDown(first,{key:'ArrowDown'})
    expect(mocks.openDetail).toHaveBeenCalledWith('mistake-2')
    expect(screen.getByRole('button',{name:/Qe2/i})).toHaveFocus()
  })

  it('uses an accessible overlay on narrower desktop windows and returns focus on close',()=>{
    const originalMatchMedia=window.matchMedia
    Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn().mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})})
    const view=render(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    const row=screen.getByRole('button',{name:/Master — Opponent.*Nxe5/i})
    row.focus()
    fireEvent.click(row)
    detail=savedMistake()
    view.rerender(<MistakeLibraryWorkspace onBack={vi.fn()} onOpenGame={vi.fn()}/>)
    expect(screen.getByRole('dialog',{name:'Saved mistake detail'})).toBeInTheDocument()
    fireEvent.keyDown(document,{key:'Escape'})
    expect(mocks.closeDetail).toHaveBeenCalled()
    expect(row).toHaveFocus()
    Object.defineProperty(window,'matchMedia',{configurable:true,value:originalMatchMedia})
  })
})
