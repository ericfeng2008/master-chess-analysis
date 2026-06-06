import { useState, useRef, useCallback } from 'react';

import { ssePost } from '../api/client';
import type { AnalyzeResult, AnalysisMoveResult, AnalysisSSEEvent } from '../types';

interface GameAnalysisState {
  isAnalyzing: boolean;
  movesAnalyzed: number;
  totalMoves: number;
  minefieldsFound: number;
  result: AnalyzeResult | null;
  selectedMoveIndex: number | null;
  error: string | null;
  analysisMaia3WhiteElo: number | null;
  analysisMaia3BlackElo: number | null;
}

export function useGameAnalysis() {
  const [state, setState] = useState<GameAnalysisState>({
    isAnalyzing: false,
    movesAnalyzed: 0,
    totalMoves: 0,
    minefieldsFound: 0,
    result: null,
    selectedMoveIndex: null,
    error: null,
    analysisMaia3WhiteElo: null,
    analysisMaia3BlackElo: null,
  });

  const controllerRef = useRef<AbortController | null>(null);

  const startAnalysis = useCallback(
    (
      pgn: string,
      acceptableDrop: number,
      minefieldThreshold: number,
      engineDepth: number,
      blunderThreshold: number,
      mbiTrapThreshold: number,
      mbiOutlierThreshold: number,
      eigThreshold: number,
      briThreshold: number,
      maia3WhiteElo: number,
      maia3BlackElo: number,
    ) => {
      controllerRef.current?.abort();

      setState({
        isAnalyzing: true,
        movesAnalyzed: 0,
        totalMoves: 0,
        minefieldsFound: 0,
        result: null,
        selectedMoveIndex: null,
        error: null,
        analysisMaia3WhiteElo: maia3WhiteElo,
        analysisMaia3BlackElo: maia3BlackElo,
      });

      const controller = ssePost(
        '/api/analyze',
        {
          pgn,
          acceptable_drop: acceptableDrop,
          minefield_threshold: minefieldThreshold,
          engine_depth: engineDepth,
          blunder_threshold: blunderThreshold,
          mbi_trap_threshold: mbiTrapThreshold,
          mbi_outlier_threshold: mbiOutlierThreshold,
          eig_threshold: eigThreshold,
          bri_threshold: briThreshold,
          maia3_white_elo: maia3WhiteElo,
          maia3_black_elo: maia3BlackElo,
        },
        (data) => {
          const event = data as AnalysisSSEEvent;
          if (event.type === 'progress') {
            setState((s: GameAnalysisState) => ({
              ...s,
              movesAnalyzed: event.moves_analyzed,
              totalMoves: event.total_moves,
              minefieldsFound: event.minefields_found,
            }));
          } else if (event.type === 'complete') {
            setState((s: GameAnalysisState) => ({
              ...s,
              isAnalyzing: false,
              result: {
                moves: event.moves as AnalysisMoveResult[],
                minefields: event.minefields,
              },
              selectedMoveIndex: event.moves.length > 0 ? 0 : null,
            }));
          }
        },
        (err) => {
          setState((s: GameAnalysisState) => ({ ...s, isAnalyzing: false, error: err.message }));
        },
      );

      controllerRef.current = controller;
    },
    [],
  );

  const cancelAnalysis = useCallback(() => {
    controllerRef.current?.abort();
    setState((s: GameAnalysisState) => ({ ...s, isAnalyzing: false }));
  }, []);

  const selectMove = useCallback((index: number) => {
    setState((s: GameAnalysisState) => ({ ...s, selectedMoveIndex: index }));
  }, []);

  return { ...state, startAnalysis, cancelAnalysis, selectMove };
}
