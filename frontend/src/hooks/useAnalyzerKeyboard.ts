import { useEffect } from 'react';

import type { AnalyzeResult } from '../types';

interface AnalyzerKeyboardDeps {
  exploration: {
    isExploring: boolean;
    currentExplorationIndex: number;
    exploredMoves: { san: string; fen: string }[];
    navigateExploration: (index: number) => void;
    exitExploration: () => void;
  };
  variationState: { moveIndex: number; varIndex: number } | null;
  setVariationState: (
    v: { moveIndex: number; varIndex: number } | null,
  ) => void;
  ctiResult: AnalyzeResult | null;
}

export function useAnalyzerKeyboard(deps: AnalyzerKeyboardDeps) {
  const { exploration, variationState, setVariationState, ctiResult } = deps;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (exploration.isExploring) {
          exploration.exitExploration();
          return;
        }
        if (variationState) {
          setVariationState(null);
          return;
        }
      }

      if (exploration.isExploring) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          if (exploration.currentExplorationIndex > 0) {
            exploration.navigateExploration(exploration.currentExplorationIndex - 1);
          } else {
            exploration.exitExploration();
          }
          return;
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          if (
            exploration.currentExplorationIndex < exploration.exploredMoves.length - 1
          ) {
            exploration.navigateExploration(exploration.currentExplorationIndex + 1);
          }
          return;
        }
      }

      if (variationState && ctiResult) {
        const analysisMove = ctiResult.moves[variationState.moveIndex];
        if (!analysisMove) {
          return;
        }

        const lineLength = analysisMove.best_line.length;

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          if (variationState.varIndex < lineLength - 1) {
            setVariationState({
              moveIndex: variationState.moveIndex,
              varIndex: variationState.varIndex + 1,
            });
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          if (variationState.varIndex > 0) {
            setVariationState({
              moveIndex: variationState.moveIndex,
              varIndex: variationState.varIndex - 1,
            });
          } else {
            setVariationState(null);
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [exploration, variationState, ctiResult, setVariationState]);
}
