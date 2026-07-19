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

const EMPTY_CACHE = new Map<string, PositionEvalResult>()

export function useVariationEvaluation(deps: VariationEvaluationDeps) {
  const { variationState, ctiResult, engineDepth, acceptableDrop } = deps;

  const [cacheState, setCacheState] = useState<{ result: AnalyzeResult | null; values: Map<string, PositionEvalResult> }>({ result: null, values: new Map() });
  const [loadingState, setLoadingState] = useState<{ result: AnalyzeResult | null; fen: string | null }>({ result: null, fen: null });
  const varEvalCache = cacheState.result === ctiResult ? cacheState.values : EMPTY_CACHE;
  const varEvalLoading = loadingState.result === ctiResult ? loadingState.fen : null;

  const varEvalSeqRef = useRef(0);
  const varEvalFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    varEvalSeqRef.current += 1;
    varEvalFetchedRef.current.clear();
  }, [ctiResult]);

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
        setCacheState((prev) => {
          const next = new Map(prev.result === ctiResult ? prev.values : EMPTY_CACHE);
          next.set(fenAfter, preComputed);
          return { result: ctiResult, values: next };
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
      setLoadingState({ result: ctiResult, fen: fenAfter });
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

        setCacheState((prev) => {
          const next = new Map(prev.result === ctiResult ? prev.values : EMPTY_CACHE);
          next.set(fenAfter, merged);
          return { result: ctiResult, values: next };
        });
      } catch {
        varEvalFetchedRef.current.delete(fenAfter);
      } finally {
        if (seq === varEvalSeqRef.current) {
          setLoadingState({ result: ctiResult, fen: null });
        }
      }
    })();
  }, [variationState, ctiResult, engineDepth, acceptableDrop]);

  return { varEvalCache, varEvalLoading };
}
