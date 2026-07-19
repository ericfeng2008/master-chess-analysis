import { useState, useCallback, useRef } from 'react';

import { evaluatePosition } from '../api/client';
import type { PositionEvalResult } from '../types';

export interface ExploredMove {
  san: string;
  fen: string;
  side: "white" | "black";
  moveNumber: number;
  evalResult: PositionEvalResult | null;
}

export interface SavedExploration {
  branchPointIndex: number;
  moves: ExploredMove[];
}

interface ExplorationState {
  isExploring: boolean;
  branchPointIndex: number;
  exploredMoves: ExploredMove[];
  currentExplorationIndex: number;
  isEvaluating: boolean;
  activeSavedIndex: number;
}

const INITIAL_ACTIVE: ExplorationState = {
  isExploring: false,
  branchPointIndex: -1,
  exploredMoves: [],
  currentExplorationIndex: -1,
  isEvaluating: false,
  activeSavedIndex: -1,
};

export function useExploration() {
  const [state, setState] = useState<ExplorationState>(INITIAL_ACTIVE);
  const [savedExplorations, setSavedExplorations] = useState<SavedExploration[]>([]);
  const evalSeqRef = useRef(0);

  const saveNewExploration = useCallback((snapshot: SavedExploration) => {
    setSavedExplorations((saved: SavedExploration[]) => {
      const isMovePrefix = (shorter: ExploredMove[], longer: ExploredMove[]) =>
        shorter.length <= longer.length &&
        shorter.every((m, i) => m.san === longer[i]?.san);

      for (let i = 0; i < saved.length; i += 1) {
        const se = saved[i];
        if (se.branchPointIndex !== snapshot.branchPointIndex) {
          continue;
        }

        if (isMovePrefix(snapshot.moves, se.moves)) {
          const hasNewEval = snapshot.moves.some(
            (m, mi) => m.evalResult && !se.moves[mi]?.evalResult,
          );
          if (!hasNewEval) {
            return saved;
          }

          const merged = se.moves.map((m: ExploredMove, mi: number) =>
            mi < snapshot.moves.length && snapshot.moves[mi]?.evalResult && !m.evalResult
              ? { ...m, evalResult: snapshot.moves[mi].evalResult }
              : m,
          );

          return saved.map((entry: SavedExploration, si: number) =>
            si === i ? { ...se, moves: merged } : entry,
          );
        }

        if (isMovePrefix(se.moves, snapshot.moves)) {
          const merged = snapshot.moves.map((m, mi) => {
            if (mi < se.moves.length && se.moves[mi]?.evalResult && !m.evalResult) {
              return { ...m, evalResult: se.moves[mi].evalResult };
            }
            return m;
          });

          return saved.map((entry: SavedExploration, si: number) =>
            si === i ? { ...snapshot, moves: merged } : entry,
          );
        }
      }

      return [...saved, snapshot];
    });
  }, []);

  const startNewExploration = useCallback(
    (branchIndex: number, initialMoves: ExploredMove[] = []) => {
      evalSeqRef.current += 1;

      setState((s: ExplorationState) => {
        if (s.isExploring && s.exploredMoves.length > 0) {
          const snapshot: SavedExploration = {
            branchPointIndex: s.branchPointIndex,
            moves: [...s.exploredMoves],
          };

          if (s.activeSavedIndex >= 0) {
            setSavedExplorations((saved: SavedExploration[]) =>
              saved.map((se: SavedExploration, i: number) => (i === s.activeSavedIndex ? snapshot : se)),
            );
          } else {
            saveNewExploration(snapshot);
          }
        }

        return {
          isExploring: true,
          branchPointIndex: branchIndex,
          exploredMoves: [...initialMoves],
          currentExplorationIndex: initialMoves.length - 1,
          isEvaluating: false,
          activeSavedIndex: -1,
        };
      });
    },
    [saveNewExploration],
  );

  const addExploredMove = useCallback(
    async (
      san: string,
      preFen: string,
      fenAfter: string,
      depth: number = 12,
      acceptableDrop: number = 0.5,
    ) => {
      const seq = ++evalSeqRef.current;
      const box = { idx: -1 };

      setState((s: ExplorationState) => {
        const { side, moveNumber } = moveNotationFromPreFen(preFen);
        const newMove: ExploredMove = { san, fen: fenAfter, side, moveNumber, evalResult: null };
        const trimmed = s.exploredMoves.slice(0, s.currentExplorationIndex + 1);
        box.idx = trimmed.length;

        return {
          ...s,
          isExploring: true,
          exploredMoves: [...trimmed, newMove],
          currentExplorationIndex: box.idx,
          isEvaluating: true,
        };
      });

      try {
        const [preResult, postResult] = await Promise.all([
          evaluatePosition(preFen, depth, acceptableDrop),
          evaluatePosition(fenAfter, depth, acceptableDrop),
        ]);

        const merged: PositionEvalResult = {
          eval: postResult.eval,
          best_move: preResult.best_move,
          good_moves: preResult.good_moves,
          good_moves_with_eval: preResult.good_moves_with_eval,
          cti: preResult.cti,
          mate_in: postResult.mate_in,
        };

        setState((s: ExplorationState) => {
          if (box.idx < 0 || box.idx >= s.exploredMoves.length) {
            return {
              ...s,
              isEvaluating: seq === evalSeqRef.current ? false : s.isEvaluating,
            };
          }

          const exploredMoves = s.exploredMoves.map((move, i) =>
            i === box.idx ? { ...move, evalResult: merged } : move,
          );

          return {
            ...s,
            exploredMoves,
            isEvaluating: seq === evalSeqRef.current ? false : s.isEvaluating,
          };
        });
      } catch {
        setState((s: ExplorationState) => ({
          ...s,
          isEvaluating: seq === evalSeqRef.current ? false : s.isEvaluating,
        }));
      }
    },
    [],
  );

  const navigateExploration = useCallback((index: number) => {
    setState((s: ExplorationState) => {
      if (index < 0 || index >= s.exploredMoves.length) {
        return s;
      }
      return { ...s, isExploring: true, currentExplorationIndex: index };
    });
  }, []);

  const exitExploration = useCallback(() => {
    evalSeqRef.current += 1;

    setState((s: ExplorationState) => {
      if (s.isExploring && s.exploredMoves.length > 0) {
        const snapshot: SavedExploration = {
          branchPointIndex: s.branchPointIndex,
          moves: [...s.exploredMoves],
        };

        if (s.activeSavedIndex >= 0) {
          setSavedExplorations((saved: SavedExploration[]) =>
            saved.map((se: SavedExploration, i: number) => (i === s.activeSavedIndex ? snapshot : se)),
          );
        } else {
          saveNewExploration(snapshot);
        }
      }

      return INITIAL_ACTIVE;
    });
  }, [saveNewExploration]);

  const clearExplorations = useCallback(() => {
    evalSeqRef.current += 1;
    setState(INITIAL_ACTIVE);
    setSavedExplorations([]);
  }, []);

  const enterSavedExploration = useCallback(
    (savedIndex: number, moveIndex: number) => {
      const snapshot = savedExplorations[savedIndex];
      if (!snapshot) {
        return;
      }

      const clampedIndex = Math.max(0, Math.min(moveIndex, snapshot.moves.length - 1));
      evalSeqRef.current += 1;

      setState({
        isExploring: true,
        branchPointIndex: snapshot.branchPointIndex,
        exploredMoves: [...snapshot.moves],
        currentExplorationIndex: clampedIndex,
        isEvaluating: false,
        activeSavedIndex: savedIndex,
      });
    },
    [savedExplorations],
  );

  return {
    ...state,
    savedExplorations,
    startNewExploration,
    addExploredMove,
    navigateExploration,
    exitExploration,
    clearExplorations,
    enterSavedExploration,
  };
}

function moveNotationFromPreFen(fen: string): { side: "white" | "black"; moveNumber: number } {
  const parts = fen.split(" ");
  const side = parts[1] === "b" ? "black" : "white";
  const moveNumber = parseInt(parts[5] ?? "1", 10) || 1;
  return { side, moveNumber };
}
