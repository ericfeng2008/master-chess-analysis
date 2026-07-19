import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { savedMistake } from '../test/mistakeFixtures'
import { useMistakeLibrary } from './useMistakeLibrary'

const api={list:vi.fn(),tags:vi.fn(),detail:vi.fn(),patch:vi.fn(),replaceTags:vi.fn(),remove:vi.fn(),attempt:vi.fn()}
vi.mock('../api/mistakes',()=>({
  listMistakes:(...args:unknown[])=>api.list(...args),listMistakeTags:(...args:unknown[])=>api.tags(...args),getMistake:(...args:unknown[])=>api.detail(...args),patchMistake:(...args:unknown[])=>api.patch(...args),replaceMistakeTags:(...args:unknown[])=>api.replaceTags(...args),deleteMistake:(...args:unknown[])=>api.remove(...args),addMistakeAttempt:(...args:unknown[])=>api.attempt(...args),
}))

describe('useMistakeLibrary',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    api.list.mockImplementation((query:{side:string})=>Promise.resolve({items:[savedMistake({id:query.side||'all',side:query.side==='black'?'black':'white'})],total:1,page:1,page_size:25}))
    api.tags.mockResolvedValue({items:[]});api.detail.mockResolvedValue(savedMistake());api.attempt.mockResolvedValue({});api.patch.mockResolvedValue(savedMistake());api.replaceTags.mockResolvedValue(savedMistake());api.remove.mockResolvedValue(undefined)
  })
  it('refreshes bounded filters and practice state without retaining a stale list',async()=>{
    const {result}=renderHook(()=>useMistakeLibrary())
    await waitFor(()=>expect(result.current.items[0]?.id).toBe('all'))
    act(()=>result.current.setQuery({side:'black'}))
    await waitFor(()=>expect(result.current.items[0]?.id).toBe('black'))
    await act(async()=>{await result.current.assess('mistake-1','e5','again')})
    expect(api.attempt).toHaveBeenCalledWith('mistake-1','e5','again')
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({side:'black'}))
    act(()=>result.current.setQuery({player_name:'Master',tag:'Calculation horizon'}))
    await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({player_name:'Master',tag:'Calculation horizon'})))
  })
})
