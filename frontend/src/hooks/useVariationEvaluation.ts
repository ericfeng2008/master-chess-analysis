import { useState, useEffect, useRef } from 'react';

import { evaluatePosition } from '../api/client';
import type { PositionEvalResult, AnalyzeResult } from '../types';
import { bestLineFens } from '../utils/bestLineFens';

interface VariationEvaluationDeps {
  variationState: { moveIndex: number; varIndex: number } | null;
  ctiResult: AnalyzeResult | null;
  acceptableDrop: number;
}

const EMPTY_CACHE = new Map<string, PositionEvalResult>()
const VARIATION_DETAIL_DEPTH = 10

export function useVariationEvaluation(deps: VariationEvaluationDeps) {
  const { variationState, ctiResult, acceptableDrop } = deps;
  const detailSettingsKey = `${VARIATION_DETAIL_DEPTH}|${acceptableDrop}`;

  const [cacheState, setCacheState] = useState<{
    result: AnalyzeResult | null;
    valuesBySettings: Map<string, Map<string, PositionEvalResult>>;
  }>({ result: null, valuesBySettings: new Map() });
  const [loadingState, setLoadingState] = useState<{
    result: AnalyzeResult | null;
    settingsKey: string;
    fen: string | null;
  }>({ result: null, settingsKey: '', fen: null });
  const varEvalCache = cacheState.result === ctiResult
    ? cacheState.valuesBySettings.get(detailSettingsKey) ?? EMPTY_CACHE
    : EMPTY_CACHE;
  const varEvalLoading = loadingState.result === ctiResult && loadingState.settingsKey === detailSettingsKey
    ? loadingState.fen
    : null;

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

    const requestKey = `${fenAfter}|${VARIATION_DETAIL_DEPTH}|${acceptableDrop}`;
    if (varEvalFetchedRef.current.has(requestKey)) {
      return;
    }
    varEvalFetchedRef.current.add(requestKey);

    const preComputed = analysisMove.best_line_evals?.[fenAfter];
    if (preComputed) {
      queueMicrotask(() => {
        setCacheState((prev) => {
          const valuesBySettings = new Map(
            prev.result === ctiResult ? prev.valuesBySettings : undefined,
          );
          const values = new Map(valuesBySettings.get(detailSettingsKey) ?? EMPTY_CACHE);
          values.set(fenAfter, preComputed);
          valuesBySettings.set(detailSettingsKey, values);
          return { result: ctiResult, valuesBySettings };
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
      setLoadingState({ result: ctiResult, settingsKey: detailSettingsKey, fen: fenAfter });
    });

    void (async () => {
      try {
        const preResult = await evaluatePosition(
          preFen,
          VARIATION_DETAIL_DEPTH,
          acceptableDrop,
          'variation_detail',
        );
        const postResult = await evaluatePosition(
          fenAfter,
          VARIATION_DETAIL_DEPTH,
          acceptableDrop,
          'variation_detail',
        );

        const merged: PositionEvalResult = {
          eval: postResult.eval,
          best_move: preResult.best_move,
          good_moves: preResult.good_moves,
          good_moves_with_eval: preResult.good_moves_with_eval,
          cti: preResult.cti,
          mate_in: postResult.mate_in,
        };

        setCacheState((prev) => {
          const valuesBySettings = new Map(
            prev.result === ctiResult ? prev.valuesBySettings : undefined,
          );
          const values = new Map(valuesBySettings.get(detailSettingsKey) ?? EMPTY_CACHE);
          values.set(fenAfter, merged);
          valuesBySettings.set(detailSettingsKey, values);
          return { result: ctiResult, valuesBySettings };
        });
      } catch {
        varEvalFetchedRef.current.delete(requestKey);
      } finally {
        if (seq === varEvalSeqRef.current) {
          setLoadingState({ result: ctiResult, settingsKey: detailSettingsKey, fen: null });
        }
      }
    })();
  }, [variationState, ctiResult, acceptableDrop, detailSettingsKey]);

  return { varEvalCache, varEvalLoading };
}
