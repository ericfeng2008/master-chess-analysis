import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PgnViewer } from './PgnViewer';

describe('PgnViewer best lines', () => {
  it('renders and navigates a mistake line without any evaluation detail map', () => {
    const onVariationClick = vi.fn();
    render(
      <PgnViewer
        moves={[{ index: 0, moveNumber: 1, side: 'white', san: 'd4', fen: 'start' }]}
        activeMoveIndex={null}
        onMoveClick={vi.fn()}
        variations={[{ line: ['e4', 'e5', 'Nf3'], fens: [] }]}
        onVariationClick={onVariationClick}
      />,
    );

    expect(screen.getByText('e4')).toBeInTheDocument();
    expect(screen.getByText('e5')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Nf3'));
    expect(onVariationClick).toHaveBeenCalledWith(0, 2);
  });
});
