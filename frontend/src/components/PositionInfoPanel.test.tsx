import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AnalysisMoveResult } from '../types';
import { PositionInfoPanel } from './PositionInfoPanel';

describe('PositionInfoPanel historical compatibility', () => {
  it('accepts a numeric historical EPE field without rendering the retired metric', () => {
    const selectedMove = {
      move_number: 1, side: 'white', move: 'e4',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      stockfish_eval: 0.2, eval_after: 0.1, cti: 0.2,
      best_move: 'e4', good_moves: ['e4'], good_moves_with_eval: { e4: 0 },
      is_minefield: false, mbi_classification: null, mbi_maia_prob: null,
      eig_value: null, is_eig_flagged: false, is_brilliant: false, bri_maia_prob: null,
      epe_score: 7.77, best_line: ['e4'], best_line_evals: {}, mate_in: null,
    } satisfies AnalysisMoveResult;

    render(
      <PositionInfoPanel
        selectedMove={selectedMove}
        exploration={{ isExploring: false, currentExplorationIndex: -1, exploredMoves: [], isEvaluating: false, exitExploration: () => undefined }}
        variationState={null}
        varEvalCache={new Map()}
        varEvalLoading={null}
        ctiResult={{ moves: [selectedMove] }}
      />,
    );

    expect(screen.queryByText(/EPE/i)).not.toBeInTheDocument();
    expect(screen.queryByText('7.77')).not.toBeInTheDocument();
  });

  it.each(['white', 'black'] as const)(
    'renders coherent mover-perspective deltas without signed zero for %s',
    (side) => {
      const selectedMove = {
        move_number: 19, side, move: 'Nf5',
        fen: 'r1br2k1/pp2nppp/1qn1p3/4P3/4N3/P2B1N1P/1P3PP1/R1QR2K1 b - - 2 19',
        stockfish_eval: 2.07, eval_after: 2.36, cti: 0.5,
        best_move: 'Kf8', good_moves: ['Kf8', 'Nf5', 'h6'],
        good_moves_with_eval: { Kf8: 0, Nf5: -0.05, h6: -0.004 },
        is_minefield: false, mbi_classification: null, mbi_maia_prob: null,
        played_move_eval_drop: 0.05, matched_best_eval: -2.07,
        matched_played_eval: -2.12, comparison_depth: 18,
        comparison_method: 'coherent_restricted_multipv_v1' as const,
        comparison_status: 'complete' as const,
        eig_value: null, is_eig_flagged: false, is_brilliant: false, bri_maia_prob: null,
        epe_score: null, best_line: ['Kf8'], best_line_evals: {}, mate_in: null,
      } satisfies AnalysisMoveResult;

      render(
        <PositionInfoPanel
          selectedMove={selectedMove}
          exploration={{ isExploring: false, currentExplorationIndex: -1, exploredMoves: [], isEvaluating: false, exitExploration: () => undefined }}
          variationState={null}
          varEvalCache={new Map()}
          varEvalLoading={null}
          ctiResult={{ moves: [selectedMove] }}
        />,
      );

      expect(screen.getByText('Nf5(-0.05), h6(0.00)')).toBeInTheDocument();
      expect(screen.getByText('0.05 pawns')).toBeInTheDocument();
      expect(screen.queryByText(/\+0\.00|-0\.00/)).not.toBeInTheDocument();
    },
  );

  it('uses the shared delta formatter for explored position details', () => {
    render(
      <PositionInfoPanel
        selectedMove={null}
        exploration={{
          isExploring: true,
          currentExplorationIndex: 0,
          exploredMoves: [{
            san: 'Nf5',
            fen: 'r1br2k1/pp2nppp/1qn1p3/4P3/4N3/P2B1N1P/1P3PP1/R1QR2K1 w - - 3 20',
            evalResult: {
              eval: 2.1, best_move: 'Kf8', good_moves: ['Kf8', 'h6'],
              good_moves_with_eval: { Kf8: 0, h6: -0.004 }, cti: null, mate_in: null,
            },
          }],
          isEvaluating: false,
          exitExploration: () => undefined,
        }}
        variationState={null}
        varEvalCache={new Map()}
        varEvalLoading={null}
        ctiResult={null}
      />,
    );

    expect(screen.getByText('h6(0.00)')).toBeInTheDocument();
    expect(screen.queryByText(/\+0\.00|-0\.00/)).not.toBeInTheDocument();
  });

  it.each([
    ['initial_position', 'Decision analysis was skipped for the standard initial position.'],
    ['side_not_selected', 'CTI was not analyzed for black in this run.'],
  ] as const)('keeps evaluation but explains the %s CTI omission', (reason, message) => {
    const selectedMove = {
      move_number: 1, side: reason === 'side_not_selected' ? 'black' : 'white', move: 'e4',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      stockfish_eval: 0.2, eval_after: 0.15, cti: null,
      best_move: null, good_moves: [], good_moves_with_eval: {},
      is_minefield: false, mbi_classification: null, mbi_maia_prob: null,
      comparison_status: 'not_applicable' as const, cti_skip_reason: reason,
      eig_value: null, is_eig_flagged: false, is_brilliant: false, bri_maia_prob: null,
      epe_score: null, best_line: [], best_line_evals: {}, mate_in: null,
    } satisfies AnalysisMoveResult;

    render(
      <PositionInfoPanel
        selectedMove={selectedMove}
        exploration={{ isExploring: false, currentExplorationIndex: -1, exploredMoves: [], isEvaluating: false, exitExploration: () => undefined }}
        variationState={null}
        varEvalCache={new Map()}
        varEvalLoading={null}
        ctiResult={{ moves: [selectedMove] }}
      />,
    );

    expect(screen.getByText('0.15')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('CTI:')).not.toBeInTheDocument();
    expect(screen.queryByText('Minefield:')).not.toBeInTheDocument();
    expect(screen.queryByText('Best move:')).not.toBeInTheDocument();
    expect(screen.queryByText('Good moves:')).not.toBeInTheDocument();
  });
});
