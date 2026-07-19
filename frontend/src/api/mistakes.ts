import { apiRequest } from './client'
import type {
  MistakeAttempt, MistakeListResult, MistakeOutcome, MistakeQuery, MistakeSuggestion,
  AnalysisStateFilter, LogicalStoredGame, MetadataKey, MistakeTag, SavedMistake, StoredGame, StoredGameMetadata, StoredGameSort, StoredGameSummary, StudySide,
} from '../types/mistakes'

export const getMistakeSuggestions = (runId: string, side: StudySide) =>
  apiRequest<{ items: MistakeSuggestion[]; study_side: StudySide }>(`/api/analysis-runs/${runId}/mistake-suggestions?study_side=${side}`)

export const saveMistakes = (runId: string, side: StudySide, plies: number[]) =>
  apiRequest<{ created: Array<{id:string;ply:number}>; existing: Array<{id:string;ply:number}> }>('/api/saved-mistakes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_run_id: runId, study_side: side, plies }),
  })

export const listStoredGames = (options: {query?:string;page?:number;analysis_state?:AnalysisStateFilter;sort?:StoredGameSort} = {}) => {
  const params = new URLSearchParams({ query: options.query ?? '', page: String(options.page ?? 1), analysis_state: options.analysis_state ?? 'all', sort: options.sort ?? 'recent' })
  return apiRequest<{items:StoredGameSummary[];total:number;page:number;page_size:number}>(`/api/stored-games?${params}`)
}

export const getAnalysisRun = (runId: string) => apiRequest<StoredGame>(`/api/analysis-runs/${runId}`)

export const getStoredGame = getAnalysisRun

export const getLogicalGame = (gameId: string, runId?: string) => {
  const query = runId ? `?analysis_run_id=${encodeURIComponent(runId)}` : ''
  return apiRequest<LogicalStoredGame>(`/api/stored-games/${gameId}${query}`)
}

export const openStoredGame = (gameId: string) => apiRequest<LogicalStoredGame>(`/api/stored-games/${gameId}/open`, { method: 'POST' })

export const patchGameMetadata = (gameId: string, changes: Partial<Record<MetadataKey, string | null>>) =>
  apiRequest<StoredGameMetadata>(`/api/stored-games/${gameId}/metadata`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })

export const listMistakes = (query: MistakeQuery) => {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key,value]) => { if(value !== '') params.set(key,String(value)) })
  return apiRequest<MistakeListResult>(`/api/saved-mistakes?${params}`)
}
export const getMistake = (id: string) => apiRequest<SavedMistake>(`/api/saved-mistakes/${id}`)
export const patchMistake = (id: string, changes: Partial<Pick<SavedMistake,'note'|'lifecycle'>>) => apiRequest<SavedMistake>(`/api/saved-mistakes/${id}`, {
  method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes),
})
export const deleteMistake = (id: string) => apiRequest<void>(`/api/saved-mistakes/${id}`,{method:'DELETE'})
export const listMistakeTags = () => apiRequest<{items:MistakeTag[]}>('/api/mistake-tags')
export const replaceMistakeTags = (id:string,names:string[]) => apiRequest<SavedMistake>(`/api/saved-mistakes/${id}/tags`,{
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({names}),
})
export const addMistakeAttempt = (id:string,chosenMove:string|null,outcome:MistakeOutcome) => apiRequest<MistakeAttempt>(`/api/saved-mistakes/${id}/attempts`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chosen_move:chosenMove||null,outcome}),
})
