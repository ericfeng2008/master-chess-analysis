import { useState, useCallback, useEffect } from 'react';

import type { ParsedMove } from '../types';

interface UseMoveNavigationOptions {
  externalIndex?: number | null;
  onIndexChange?: (index: number) => void;
}

export function useMoveNavigation(
  moves: ParsedMove[],
  options?: UseMoveNavigationOptions,
) {
  const { externalIndex, onIndexChange } = options ?? {};
  const isExternallyControlled =
    externalIndex !== undefined && onIndexChange !== undefined;

  const [internalIndex, setInternalIndex] = useState(0);

  const currentIndex = isExternallyControlled ? (externalIndex ?? 0) : internalIndex;

  const setIndex = useCallback(
    (index: number) => {
      if (isExternallyControlled) {
        onIndexChange?.(index);
      } else {
        setInternalIndex(index);
      }
    },
    [isExternallyControlled, onIndexChange],
  );

  const safeCurrentIndex =
    moves.length > 0 ? Math.max(0, Math.min(currentIndex, moves.length - 1)) : 0;
  const canGoBack = moves.length > 0 && safeCurrentIndex > 0;
  const canGoForward = moves.length > 0 && safeCurrentIndex < moves.length - 1;
  const currentFen = moves.length > 0 ? moves[safeCurrentIndex]?.fen : undefined;

  const goFirst = useCallback(() => {
    if (moves.length > 0) {
      setIndex(0);
    }
  }, [moves.length, setIndex]);

  const goBack = useCallback(() => {
    if (canGoBack) {
      setIndex(safeCurrentIndex - 1);
    }
  }, [canGoBack, safeCurrentIndex, setIndex]);

  const goForward = useCallback(() => {
    if (canGoForward) {
      setIndex(safeCurrentIndex + 1);
    }
  }, [canGoForward, safeCurrentIndex, setIndex]);

  const goLast = useCallback(() => {
    if (moves.length > 0) {
      setIndex(moves.length - 1);
    }
  }, [moves.length, setIndex]);

  const goTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < moves.length) {
        setIndex(index);
      }
    },
    [moves.length, setIndex],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (moves.length > 0 && safeCurrentIndex < moves.length - 1) {
          setIndex(safeCurrentIndex + 1);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (moves.length > 0 && safeCurrentIndex > 0) {
          setIndex(safeCurrentIndex - 1);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moves.length, safeCurrentIndex, setIndex]);

  return {
    currentIndex: moves.length > 0 ? safeCurrentIndex : null,
    currentFen,
    goFirst,
    goBack,
    goForward,
    goLast,
    goTo,
    canGoBack,
    canGoForward,
  };
}
