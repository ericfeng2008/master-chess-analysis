import { useState, useEffect, useRef } from 'react';

import { evaluatePosition } from '../api/client';
import type { PositionEvalResult, AnalyzeResult } from '../types';
import { bestLineFens } from '../utils/bestLineFens';

interface VariationEvaluationDeps {
  variationState: { moveIndex: number; varIndex: number } | null;
  ctiResult: AnalyzeResult | null;
  engineDepth: number;
  acceptableDrop: number;
}

export function useVariationEvaluation(deps: VariationEvaluationDeps) {
  const { variationState, ctiResult, engineDepth, acceptableDrop } = deps;

  const [varEvalCache, setVarEvalCache] = useState<Map<string, PositionEvalResult>>(
    new Map(),
  );
  const [varEvalLoading, setVarEvalLoading] = useState<string | null>(null);

  const varEvalSeqRef = useRef(0);
  const varEvalFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!variationState || !ctiResult) {
      return;
    }

    const { moveIndex, varIndex } = variationState;
    const analysisMove = ctiResult.moves[moveIndex];
    if (!analysisMove) {
      return;
    }

    const variationFens = bestLineFens(analysisMove.fen, analysisMove.best_line);
    const fenAfter = variationFens[varIndex];
    if (!fenAfter) {
      return;
    }

    if (varEvalFetchedRef.current.has(fenAfter)) {
      return;
    }
    varEvalFetchedRef.current.add(fenAfter);

    const preComputed = analysisMove.best_line_evals?.[fenAfter];
    if (preComputed) {
      queueMicrotask(() => {
        setVarEvalCache((prev: Map<string, PositionEvalResult>) => {
          const next = new Map(prev);
          next.set(fenAfter, preComputed);
          return next;
        });
      });
      return;
    }

    const preFen = varIndex === 0 ? analysisMove.fen : variationFens[varIndex - 1];
    if (!preFen) {
      return;
    }

    const seq = ++varEvalSeqRef.current;
    queueMicrotask(() => {
      setVarEvalLoading(fenAfter);
    });

    void (async () => {
      try {
        const preResult = await evaluatePosition(preFen, engineDepth, acceptableDrop);
        const postResult = await evaluatePosition(fenAfter, engineDepth, acceptableDrop);

        const merged: PositionEvalResult = {
          eval: postResult.eval,
          best_move: preResult.best_move,
          good_moves: preResult.good_moves,
          good_moves_with_eval: preResult.good_moves_with_eval,
          cti: preResult.cti,
          mate_in: postResult.mate_in,
        };

        setVarEvalCache((prev: Map<string, PositionEvalResult>) => {
          const next = new Map(prev);
          next.set(fenAfter, merged);
          return next;
        });
      } catch {
        varEvalFetchedRef.current.delete(fenAfter);
      } finally {
        if (seq === varEvalSeqRef.current) {
          setVarEvalLoading(null);
        }
      }
    })();
  }, [variationState, ctiResult, engineDepth, acceptableDrop]);

  return { varEvalCache, varEvalLoading };
}
