import { useEffect, useState } from 'react'
import { listStoredGames } from '../api/mistakes'
import type { AnalysisStateFilter, StoredGameSort, StoredGameSummary } from '../types/mistakes'

export function useSavedGameLibrary(open: boolean, refreshToken = 0) {
  const [query, setQuery] = useState('')
  const [analysisState, setAnalysisState] = useState<AnalysisStateFilter>('all')
  const [sort, setSort] = useState<StoredGameSort>('recent')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<StoredGameSummary[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<StoredGameSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision(value => value + 1)
  useEffect(() => {
    if (!open) return
    let live = true
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null)
      void listStoredGames({query, page, analysis_state: analysisState, sort}).then(result => {
        if (!live) return
        setItems(result.items); setTotal(result.total); setPageSize(result.page_size)
        setSelected(previous => result.items.find(item => item.id === previous?.id) ?? result.items[0] ?? null)
      }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { if (live) setLoading(false) })
    }, 150)
    return () => { live = false; window.clearTimeout(timer) }
  }, [open, query, page, analysisState, sort, revision, refreshToken])
  return {query,setQuery,analysisState,setAnalysisState,sort,setSort,page,setPage,pageSize,items,total,selected,setSelected,loading,error,refresh}
}
