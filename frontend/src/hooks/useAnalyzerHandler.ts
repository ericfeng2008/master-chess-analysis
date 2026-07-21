import { useCallback, type ChangeEvent } from 'react';
import { Chess } from 'chess.js';

import { apiPostForm } from '../api/client';
import { getAnalysisRun } from '../api/mistakes';
import type { AnalysisHistoryEntry, PgnUploadResponse, ParsedMove, AnalyzeResult, PositionEvalResult } from '../types';
import type { StoredGame } from '../types/mistakes';
import { bestLineFens } from '../utils/bestLineFens';

type ExplorationMoveInput = {
  san: string;
  fen: string;
  side: 'white' | 'black';
  moveNumber: number;
  evalResult: PositionEvalResult | null;
};

export interface AnalyzerHandlersDeps {
  ctiResult: AnalyzeResult | null;
  selectMove: (index: number) => void;
  startAnalysis: (
    pgn: string,
    gameId: string | null,
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
  ) => void;
  isExploring: boolean;
  currentExplorationIndex: number;
  exploredMoves: { san: string; fen: string }[];
  startNewExploration: (
    branchIndex: number,
    initialMoves?: ExplorationMoveInput[],
  ) => void;
  addExploredMove: (
    san: string,
    preFen: string,
    fenAfter: string,
    depth: number,
    drop: number,
  ) => void;
  exitExploration: () => void;
  navigateExploration: (index: number) => void;
  savedExplorations: { branchPointIndex: number; moves: { san: string; fen: string }[] }[];
  activeSavedIndex: number;
  enterSavedExploration: (savedIndex: number, moveIndex: number) => void;
  goTo: (index: number) => void;
  hasResult: boolean;
  activeIndex: number | null;
  parsedMoves: ParsedMove[];
  pgn: string | null;
  gameId: string | null;
  acceptableDrop: number;
  minefieldThreshold: number;
  engineDepth: number;
  blunderThreshold: number;
  mbiTrapThreshold: number;
  mbiOutlierThreshold: number;
  eigThreshold: number;
  briThreshold: number;
  maia3WhiteElo: number;
  maia3BlackElo: number;
  setPgn: (v: string | null) => void;
  setGameId: (v: string | null) => void;
  setAnalysisHistory: (v: AnalysisHistoryEntry[]) => void;
  setImportPersistenceWarning: (v: string | null) => void;
  clearAnalysis: () => void;
  restoreImportedAnalysis: (game: StoredGame) => void;
  setUploadSummary: (v: PgnUploadResponse | null) => void;
  setImportNotice: (v: PgnUploadResponse | null) => void;
  setUploadError: (v: string | null) => void;
  setUploading: (v: boolean) => void;
  setUploadedFileName: (v: string | null) => void;
  setShowConfig: (v: boolean | ((prev: boolean) => boolean)) => void;
  variationState: { moveIndex: number; varIndex: number } | null;
  varEvalCache: Map<string, PositionEvalResult>;
  setVariationState: (v: { moveIndex: number; varIndex: number } | null) => void;
  onImportedGame?: (result: PgnUploadResponse) => void;
}

function normalizeEvalResult(ev: PositionEvalResult | undefined): PositionEvalResult | null {
  if (!ev) {
    return null;
  }

  return {
    eval: ev.eval,
    best_move: ev.best_move ?? "",
    good_moves: ev.good_moves ?? [],
    good_moves_with_eval: ev.good_moves_with_eval ?? {},
    cti: ev.cti ?? null,
    mate_in: ev.mate_in ?? null,
  };
}

export function useAnalyzerHandler(d: AnalyzerHandlersDeps) {
  const {
    ctiResult,
    selectMove,
    startAnalysis,
    isExploring,
    currentExplorationIndex,
    exploredMoves,
    startNewExploration,
    addExploredMove,
    exitExploration,
    navigateExploration,
    savedExplorations,
    activeSavedIndex,
    enterSavedExploration,
    goTo,
    hasResult,
    activeIndex,
    parsedMoves,
    pgn,
    gameId,
    acceptableDrop,
    minefieldThreshold,
    engineDepth,
    blunderThreshold,
    mbiTrapThreshold,
    mbiOutlierThreshold,
    eigThreshold,
    briThreshold,
    maia3WhiteElo,
    maia3BlackElo,
    setPgn,
    setGameId,
    setAnalysisHistory,
    setImportPersistenceWarning,
    clearAnalysis,
    restoreImportedAnalysis,
    setUploadSummary,
    setImportNotice,
    setUploadError,
    setUploading,
    setUploadedFileName,
    setShowConfig,
    variationState,
    varEvalCache,
    setVariationState,
    onImportedGame,
  } = d;

  const handleNavIndexChange = useCallback(
    (index: number) => {
      if (hasResult) {
        selectMove(index);
      }
    },
    [hasResult, selectMove],
  );

  const handleChartSelectMove = useCallback(
    (index: number) => {
      const n = Number(index);
      if (Number.isFinite(n) && n >= 0) {
        selectMove(n);
      }
    },
    [selectMove],
  );

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadError(null);
    setUploadSummary(null);
    setImportNotice(null);
    setUploadedFileName(file.name);
    setUploading(true);

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiPostForm<PgnUploadResponse>('/api/upload-pgn', form);
      clearAnalysis();
      setUploadSummary(res);
      setImportNotice(res);
      setPgn(res.pgn);
      setGameId(res.game_id);
      setAnalysisHistory(res.analysis_history);
      setImportPersistenceWarning(res.persistence_warning);
      onImportedGame?.(res);
      if (res.preferred_analysis_run_id) {
        const saved = await getAnalysisRun(res.preferred_analysis_run_id);
        restoreImportedAnalysis(saved);
        setShowConfig(false);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function handleAnalyze() {
    if (!pgn) {
      return;
    }

    setShowConfig(false);
    startAnalysis(
      pgn,
      gameId,
      acceptableDrop,
      minefieldThreshold,
      engineDepth,
      blunderThreshold,
      mbiTrapThreshold,
      mbiOutlierThreshold,
      eigThreshold,
      briThreshold,
      maia3WhiteElo,
      maia3BlackElo,
    );
  }

  const handleBoardMove = useCallback(
    (sourceSquare: string, targetSquare: string): boolean => {
      if (!hasResult || activeIndex === null) {
        return false;
      }

      let currentFen: string | undefined;
      if (isExploring && currentExplorationIndex >= 0) {
        currentFen = exploredMoves[currentExplorationIndex]?.fen;
      } else {
        currentFen = parsedMoves[activeIndex]?.fen ?? ctiResult?.moves[activeIndex]?.fen;
      }

      const activeVariationMove =
        variationState != null ? ctiResult?.moves[variationState.moveIndex] : null;
      const activeVariationFens =
        activeVariationMove != null ? bestLineFens(activeVariationMove.fen, activeVariationMove.best_line) : null;

      if (variationState != null && activeVariationMove && activeVariationFens) {
        currentFen = activeVariationFens[variationState.varIndex];
      }

      if (!currentFen) {
        return false;
      }

      const chess = new Chess(currentFen);
      const move = (() => {
        try {
          return chess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
        } catch {
          return null;
        }
      })();
      if (!move) {
        return false;
      }

      const fenAfter = chess.fen();
      const san = move.san;

      if (variationState != null && activeVariationMove && activeVariationFens) {
        const prefixMoves: ExplorationMoveInput[] = [];
        for (let i = 0; i <= variationState.varIndex; i += 1) {
          const lineSan = activeVariationMove.best_line[i];
          const fen = activeVariationFens[i];
          const preMoveFen = i === 0 ? activeVariationMove.fen : activeVariationFens[i - 1];
          if (lineSan && fen) {
            const { side, moveNumber } = moveNotationFromPreFen(preMoveFen);
            prefixMoves.push({
              san: lineSan,
              fen,
              side,
              moveNumber,
              evalResult: normalizeEvalResult(
                varEvalCache.get(fen) ?? activeVariationMove.best_line_evals?.[fen],
              ),
            });
          }
        }

        startNewExploration(variationState.moveIndex, prefixMoves);
        setVariationState(null);
        addExploredMove(san, currentFen, fenAfter, engineDepth, acceptableDrop);
        return true;
      }

      if (!isExploring) {
        const nextMainlineIndex = activeIndex + 1;
        const nextMainlineMove = parsedMoves[nextMainlineIndex];

        if (nextMainlineMove && nextMainlineMove.san === san) {
          if (hasResult) {
            selectMove(nextMainlineIndex);
          } else {
            goTo(nextMainlineIndex);
          }
          return true;
        }

        const branchIndex = nextMainlineMove ? nextMainlineIndex : activeIndex;
        startNewExploration(branchIndex);
      }

      addExploredMove(san, currentFen, fenAfter, engineDepth, acceptableDrop);
      return true;
    },
    [
      hasResult,
      activeIndex,
      parsedMoves,
      ctiResult,
      isExploring,
      currentExplorationIndex,
      exploredMoves,
      variationState,
      varEvalCache,
      selectMove,
      goTo,
      startNewExploration,
      addExploredMove,
      setVariationState,
      acceptableDrop,
      engineDepth,
    ],
  );

  const handlePgnClick = useCallback(
    (index: number) => {
      setVariationState(null);
      exitExploration();
      if (hasResult) {
        selectMove(index);
      } else {
        goTo(index);
      }
    },
    [hasResult, selectMove, goTo, exitExploration, setVariationState],
  );

  const handleVariationClick = useCallback(
    (moveIndex: number, varIndex: number) => {
      exitExploration();
      setVariationState({ moveIndex, varIndex });
    },
    [exitExploration, setVariationState],
  );

  const handleExplorationClick = useCallback(
    (explorationIndex: number, moveIndex: number) => {
      const savedCount = savedExplorations.length;
      const activeExpIdx = activeSavedIndex >= 0 ? activeSavedIndex : isExploring ? savedCount : -1;

      if (isExploring && explorationIndex === activeExpIdx) {
        navigateExploration(moveIndex);
      } else if (explorationIndex < savedCount) {
        enterSavedExploration(explorationIndex, moveIndex);
      } else {
        navigateExploration(moveIndex);
      }
    },
    [
      isExploring,
      activeSavedIndex,
      savedExplorations.length,
      enterSavedExploration,
      navigateExploration,
    ],
  );

  const handleChartSelectMoveWithExit = useCallback(
    (index: number) => {
      exitExploration();
      handleChartSelectMove(index);
    },
    [exitExploration, handleChartSelectMove],
  );

  return {
    handleNavIndexChange,
    handleChartSelectMove,
    handleFile,
    handleAnalyze,
    handleBoardMove,
    handlePgnClick,
    handleVariationClick,
    handleExplorationClick,
    handleChartSelectMoveWithExit,
  };
}

function moveNotationFromPreFen(fen: string): { side: 'white' | 'black'; moveNumber: number } {
  const parts = fen.split(' ');
  const side = parts[1] === 'b' ? 'black' : 'white';
  const moveNumber = parseInt(parts[5] ?? '1', 10) || 1;
  return { side, moveNumber };
}

export const useAnalyzerHandlers = useAnalyzerHandler;
