import type { AnalysisHistoryEntry, AnalyzeRequest, AnalyzeResult } from '../types'

export type StudySide = 'white' | 'black'
export type MistakeReason = 'high_cti_mistake' | 'human_natural_blunder'
export type MistakeOutcome = 'again' | 'understood'
export type MetadataKey = 'Event' | 'White' | 'Black'
export type MetadataSource = 'manual' | 'imported' | 'missing'
export type AnalysisStateFilter = 'all' | 'analyzed' | 'not_analyzed'
export type StoredGameSort = 'recent' | 'added' | 'players'

export interface GameMetadata {
  metadata: Partial<Record<MetadataKey, string>>
  metadata_sources: Record<MetadataKey, MetadataSource>
  metadata_missing: MetadataKey[]
  metadata_updated_at: string | null
  source_headers: Record<string, string>
  imported_metadata: Partial<Record<MetadataKey, string>>
  metadata_overrides: Partial<Record<MetadataKey, string>>
}

export interface StoredGameMetadata extends GameMetadata {
  id: string
}

export interface MistakeEvidence {
  good_moves: string[]
  good_moves_with_eval: Record<string, number>
  best_line: string[]
  stockfish_eval: number | null
  eval_after: number | null
  mate_in: number | null
  acceptable_drop: number
  minefield_threshold: number
  blunder_threshold: number
  mbi_trap_threshold: number
  maia3_white_elo: number
  maia3_black_elo: number
  analysis_depth: number
  engine: Record<string, unknown>
  maia: Record<string, unknown>
  metric_schema_version: number
}

export interface MistakeSuggestion {
  analysis_run_id: string
  game_id: string | null
  mistake_fingerprint: string
  ply: number
  move_number: number
  side: StudySide
  decision_fen: string
  played_move: string
  played_move_uci: string
  best_move: string | null
  objective_loss: number
  cti: number | null
  cti_lower_bound: number | null
  cti_upper_bound: number | null
  cti_is_approximate: boolean
  mbi_classification: string | null
  mbi_maia_prob: number | null
  system_reasons: MistakeReason[]
  evidence: MistakeEvidence
  saved: boolean
}

export interface MistakeAttempt {
  id: string
  mistake_id: string
  chosen_move: string | null
  revealed_without_move: boolean
  objective_acceptable: boolean
  outcome: MistakeOutcome
  revealed_at: string
  created_at: string
}

export interface SavedMistake extends Omit<MistakeSuggestion, 'saved'> {
  id: string
  headers: Record<string, string>
  game_created_at: string
  note: string
  tags: string[]
  lifecycle: 'active' | 'archived'
  last_practice_state: MistakeOutcome | null
  practice_count: number
  last_practiced_at: string | null
  attempts?: MistakeAttempt[]
  created_at: string
  updated_at: string
}

export interface StoredGameSummary extends GameMetadata {
  id: string
  headers: Record<string, string>
  created_at: string
  updated_at: string
  mistake_count: number
  move_count: number
  analysis_count: number
  preferred_analysis_run_id: string | null
  last_opened_at: string | null
  result: string | null
}

export interface StoredGame {
  id: string
  game_id: string
  analysis_fingerprint: string
  cacheable: boolean
  normalized_pgn: string
  headers: Record<string, string>
  request: AnalyzeRequest
  engine: Record<string, unknown>
  maia: Record<string, unknown>
  metric_schema_version: number
  result: AnalyzeResult
  created_at: string
  updated_at: string
}

export interface LogicalStoredGame extends StoredGameMetadata {
  fingerprint_version: number
  game_fingerprint: string
  canonical_initial_fen: string
  mainline_uci: string[]
  normalized_pgn: string
  headers: Record<string, string>
  move_count: number
  created_at: string
  updated_at: string
  last_opened_at: string
  analysis_history: AnalysisHistoryEntry[]
  preferred_analysis_run_id: string | null
  analysis: StoredGame | null
}

export interface MistakeTag { id: string; name: string; item_count: number }

export interface MistakeQuery {
  query: string
  player_name: string
  side: '' | StudySide
  reason: '' | MistakeReason
  tag: string
  lifecycle: 'active' | 'archived'
  practice_state: '' | MistakeOutcome
  page: number
  page_size: number
}

export interface MistakeListResult {
  items: SavedMistake[]
  total: number
  page: number
  page_size: number
}
