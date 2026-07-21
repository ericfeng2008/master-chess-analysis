import { evalTransform } from "./chartTransform";
import type { ChartDataPoint } from "./ChartTooltip";

export type AnalysisMoveLike = {
  move_number: number;
  side: string;
  move: string;
  fen: string;
  stockfish_eval: number;
  eval_after: number | null | undefined;
  cti: number | null;
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
  epe_score: number | null | undefined;
  best_line: string[];
  mate_in: number | null;
};

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function buildAnalysisChartData(moves: AnalysisMoveLike[]): ChartDataPoint[] {
  return moves.map((move, index) => {
    const rawEval = finiteNumber(move.eval_after) ? move.eval_after : null;
    const transformedEval = rawEval === null ? null : evalTransform(rawEval);
    return {
      index,
      label: `${move.move_number}${move.side === "white" ? "." : "..."}`,
      stockfish_eval: transformedEval,
      evalPositive: transformedEval === null ? null : Math.max(0, transformedEval),
      evalNegative: transformedEval === null ? null : Math.min(0, transformedEval),
      ctiWhite: move.side === "white" ? move.cti : null,
      ctiBlack: move.side === "black" ? move.cti : null,
      ctiApproximate: move.cti_is_approximate ?? false,
      mbi_classification: move.mbi_classification,
      mbi_maia_prob: move.mbi_maia_prob,
      eig_value: move.eig_value,
      is_eig_flagged: move.is_eig_flagged,
      move: move.move,
      side: move.side,
      move_number: move.move_number,
      mate_in: move.mate_in,
      raw_eval: rawEval,
    };
  });
}
