import type { EvaluationBarStatus } from "../components/PositionEvaluationBar";
import type { AnalysisMoveResult, PositionEvalResult } from "../types";

export interface DisplayedPositionEvaluation {
  evaluation: number | null;
  mateIn: number | null;
  status: EvaluationBarStatus;
}

interface DisplayedPositionEvaluationInput {
  boardFen: string | undefined;
  exploration: {
    isExploring: boolean;
    currentExplorationIndex: number;
    exploredMoves: Array<{ evalResult: PositionEvalResult | null }>;
    isEvaluating: boolean;
  };
  selectedMove: AnalysisMoveResult | null;
  variationState: { moveIndex: number; varIndex: number } | null;
  varEvalCache: Map<string, PositionEvalResult>;
  varEvalLoading: string | null;
}

const PENDING_EVALUATION: DisplayedPositionEvaluation = {
  evaluation: null,
  mateIn: null,
  status: "pending",
};

export function resolveDisplayedPositionEvaluation({
  boardFen,
  exploration,
  selectedMove,
  variationState,
  varEvalCache,
  varEvalLoading,
}: DisplayedPositionEvaluationInput): DisplayedPositionEvaluation | null {
  if (exploration.isExploring && exploration.currentExplorationIndex >= 0) {
    const exploredEvaluation =
      exploration.exploredMoves[exploration.currentExplorationIndex]?.evalResult ?? null;

    if (exploredEvaluation) {
      return fromPositionEvaluation(exploredEvaluation);
    }

    return exploration.isEvaluating ? PENDING_EVALUATION : null;
  }

  if (variationState !== null) {
    const variationEvaluation = boardFen ? varEvalCache.get(boardFen) ?? null : null;

    if (variationEvaluation) {
      return fromPositionEvaluation(variationEvaluation);
    }

    return boardFen && varEvalLoading === boardFen ? PENDING_EVALUATION : null;
  }

  if (!selectedMove) {
    return null;
  }

  return {
    evaluation: selectedMove.eval_after,
    mateIn: selectedMove.mate_in,
    status: "available",
  };
}

function fromPositionEvaluation(evaluation: PositionEvalResult): DisplayedPositionEvaluation {
  return {
    evaluation: evaluation.eval,
    mateIn: evaluation.mate_in,
    status: "available",
  };
}
