export interface PgnUploadResponse {
  pgn: string;
  num_games: number;
  num_unique_games: number;
  num_games_added: number;
  num_games_existing: number;
  num_duplicate_games: number;
  num_games_saved: number;
  num_variations: number;
  max_depth: number;
  game_id: string | null;
  fingerprint_version: number | null;
  game_fingerprint: string | null;
  preferred_analysis_run_id: string | null;
  analysis_history: AnalysisHistoryEntry[];
  persistence_warning: string | null;
  metadata?: Record<string, string>;
  metadata_sources?: Record<string, 'manual' | 'imported' | 'missing'>;
  metadata_missing?: string[];
  metadata_updated_at?: string | null;
  source_headers?: Record<string, string>;
  imported_metadata?: Record<string, string>;
  metadata_overrides?: Record<string, string>;
}

export interface AnalysisHistoryEntry {
  id: string;
  game_id: string;
  analysis_fingerprint: string;
  created_at: string;
  engine_depth: number;
  request: AnalyzeRequest;
  engine: Record<string, unknown>;
  maia: Record<string, unknown>;
  metric_schema_version: number;
}

export interface PositionEvalResult {
  eval: number;
  best_move: string;
  good_moves: string[];
  good_moves_with_eval: Record<string, number>;
  cti: number | null;
  mate_in: number | null;
}

export interface AnalysisMoveResult {
  move_number: number;
  side: string;
  move: string;
  fen: string;
  stockfish_eval: number;
  eval_after: number;
  cti: number | null;
  cti_lower_bound?: number | null;
  cti_upper_bound?: number | null;
  cti_remaining_mass?: number | null;
  cti_is_approximate?: boolean;
  best_move: string | null;
  good_moves: string[];
  good_moves_with_eval: Record<string, number>;
  is_minefield: boolean;
  mbi_classification: string | null;
  mbi_maia_prob: number | null;
  played_move_eval_drop?: number | null;
  eig_value: number | null;
  is_eig_flagged: boolean;
  is_brilliant: boolean;
  bri_maia_prob: number | null;
  epe_score: number | null;
  best_line: string[];
  best_line_evals: Record<string, PositionEvalResult>;
  mate_in: number | null;
}

export interface AnalyzeResult {
  moves: AnalysisMoveResult[];
  minefields: number[];
  analysis_run_id?: string | null;
  persistence_warning?: string | null;
  game_id?: string | null;
  cache_hit?: boolean;
  analysis_history?: AnalysisHistoryEntry[];
}

export interface AnalyzeRequest {
  pgn: string;
  game_id?: string | null;
  acceptable_drop: number;
  minefield_threshold: number;
  engine_depth: number;
  blunder_threshold: number;
  mbi_trap_threshold: number;
  mbi_outlier_threshold: number;
  eig_threshold: number;
  bri_threshold: number;
  maia3_white_elo: number;
  maia3_black_elo: number;
}

export interface AnalysisProgressEvent {
  type: 'progress';
  moves_analyzed: number;
  total_moves: number;
  minefields_found: number;
}

export interface AnalysisCompleteEvent {
  type: 'complete';
  moves: AnalysisMoveResult[];
  minefields: number[];
  analysis_run_id: string | null;
  persistence_warning: string | null;
  game_id: string | null;
  cache_hit: boolean;
  analysis_history: AnalysisHistoryEntry[];
}

export type AnalysisSSEEvent = AnalysisProgressEvent | AnalysisCompleteEvent;

export interface ParsedMove {
  index: number;
  moveNumber: number;
  side: 'white' | 'black';
  san: string;
  fen: string;
}

export interface ParsedGame {
  startingFen: string;
  moves: ParsedMove[];
}
