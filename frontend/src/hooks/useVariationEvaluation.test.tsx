import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalyzeResult, AnalysisMoveResult, PositionEvalResult } from '../types';
import { bestLineFens } from '../utils/bestLineFens';
import { useVariationEvaluation } from './useVariationEvaluation';

const api = vi.hoisted(() => ({ evaluatePosition: vi.fn() }));
vi.mock('../api/client', () => ({
  evaluatePosition: (...args: unknown[]) => api.evaluatePosition(...args),
}));

const evaluation = (value: number): PositionEvalResult => ({
  eval: value,
  best_move: 'e4',
  good_moves: ['e4'],
  good_moves_with_eval: { e4: 0 },
  cti: null,
  mate_in: null,
});

function analysis(precomputed: Record<string, PositionEvalResult> = {}): AnalyzeResult {
  const move: AnalysisMoveResult = {
    move_number: 1,
    side: 'white',
    move: 'd4',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    stockfish_eval: 0.2,
    eval_after: 0.1,
    cti: 0.2,
    best_move: 'e4',
    good_moves: ['e4'],
    good_moves_with_eval: { e4: 0 },
    is_minefield: true,
    mbi_classification: 'cognitive_trap',
    mbi_maia_prob: 0.5,
    eig_value: null,
    is_eig_flagged: false,
    is_brilliant: false,
    bri_maia_prob: null,
    epe_score: null,
    best_line: ['e4', 'e5'],
    best_line_evals: precomputed,
    mate_in: null,
  };
  return { moves: [move], minefields: [0] };
}

describe('useVariationEvaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.evaluatePosition.mockResolvedValueOnce(evaluation(0.2)).mockResolvedValueOnce(evaluation(0.1));
  });

  it('loads missing details at depth 10 once and reuses the result-scoped FEN cache', async () => {
    const ctiResult = analysis();
    const fenAfter = bestLineFens(ctiResult.moves[0].fen, ctiResult.moves[0].best_line)[0];
    const { result, rerender } = renderHook(
      ({ variationState }) => useVariationEvaluation({ variationState, ctiResult, acceptableDrop: 0.5 }),
      { initialProps: { variationState: { moveIndex: 0, varIndex: 0 } as { moveIndex: number; varIndex: number } | null } },
    );

    await waitFor(() => expect(result.current.varEvalCache.get(fenAfter)?.eval).toBe(0.1));
    expect(api.evaluatePosition).toHaveBeenCalledTimes(2);
    expect(api.evaluatePosition).toHaveBeenNthCalledWith(1, ctiResult.moves[0].fen, 10, 0.5, 'variation_detail');

    rerender({ variationState: null });
    rerender({ variationState: { moveIndex: 0, varIndex: 0 } });
    await waitFor(() => expect(result.current.varEvalLoading).toBeNull());
    expect(api.evaluatePosition).toHaveBeenCalledTimes(2);
  });

  it('prefers historical precomputed details without an engine request', async () => {
    const shell = analysis();
    const fenAfter = bestLineFens(shell.moves[0].fen, shell.moves[0].best_line)[0];
    const historical = evaluation(3.4);
    const ctiResult = analysis({ [fenAfter]: historical });
    const { result } = renderHook(() =>
      useVariationEvaluation({
        variationState: { moveIndex: 0, varIndex: 0 },
        ctiResult,
        acceptableDrop: 0.5,
      }),
    );

    await waitFor(() => expect(result.current.varEvalCache.get(fenAfter)).toEqual(historical));
    expect(api.evaluatePosition).not.toHaveBeenCalled();
  });

  it('allows retry after a failed lazy request', async () => {
    api.evaluatePosition.mockReset().mockRejectedValueOnce(new Error('engine stopped'));
    const ctiResult = analysis();
    const fenAfter = bestLineFens(ctiResult.moves[0].fen, ctiResult.moves[0].best_line)[0];
    const { result, rerender } = renderHook(
      ({ variationState }) => useVariationEvaluation({ variationState, ctiResult, acceptableDrop: 0.5 }),
      { initialProps: { variationState: { moveIndex: 0, varIndex: 0 } as { moveIndex: number; varIndex: number } | null } },
    );
    await waitFor(() => expect(result.current.varEvalLoading).toBeNull());

    api.evaluatePosition.mockResolvedValueOnce(evaluation(0.2)).mockResolvedValueOnce(evaluation(0.1));
    rerender({ variationState: null });
    rerender({ variationState: { moveIndex: 0, varIndex: 0 } });

    await waitFor(() => expect(result.current.varEvalCache.get(fenAfter)?.eval).toBe(0.1));
    expect(api.evaluatePosition).toHaveBeenCalledTimes(3);
  });

  it('keeps separate deduplicated values for each detail setting', async () => {
    const ctiResult = analysis();
    const fenAfter = bestLineFens(ctiResult.moves[0].fen, ctiResult.moves[0].best_line)[0];
    const { result, rerender } = renderHook(
      ({ acceptableDrop }) => useVariationEvaluation({
        variationState: { moveIndex: 0, varIndex: 0 }, ctiResult, acceptableDrop,
      }),
      { initialProps: { acceptableDrop: 0.5 } },
    );
    await waitFor(() => expect(result.current.varEvalCache.get(fenAfter)?.eval).toBe(0.1));

    api.evaluatePosition.mockResolvedValueOnce(evaluation(1.2)).mockResolvedValueOnce(evaluation(1.1));
    rerender({ acceptableDrop: 0.75 });
    await waitFor(() => expect(result.current.varEvalCache.get(fenAfter)?.eval).toBe(1.1));
    expect(api.evaluatePosition).toHaveBeenCalledTimes(4);

    rerender({ acceptableDrop: 0.5 });
    await waitFor(() => expect(result.current.varEvalCache.get(fenAfter)?.eval).toBe(0.1));
    expect(api.evaluatePosition).toHaveBeenCalledTimes(4);
  });
});
