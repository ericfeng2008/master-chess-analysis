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
});
