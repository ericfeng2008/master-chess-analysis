export interface PgnUploadResponse {
  pgn: string;
  num_games: number;
  num_variations: number;
  max_depth: number;
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
}

export interface AnalyzeRequest {
  pgn: string;
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
