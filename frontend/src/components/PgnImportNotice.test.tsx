import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PgnUploadResponse } from '../types';
import { PgnImportNotice, PGN_IMPORT_NOTICE_DURATION_MS } from './PgnImportNotice';

function summary(overrides: Partial<PgnUploadResponse> = {}): PgnUploadResponse {
  return {
    pgn: '[Event "Test"]\n\n1. e4 *',
    num_games: 2,
    num_unique_games: 2,
    num_games_added: 2,
    num_games_existing: 0,
    num_duplicate_games: 0,
    num_games_saved: 2,
    num_variations: 0,
    max_depth: 1,
    game_id: 'game-1',
    fingerprint_version: 1,
    game_fingerprint: 'fingerprint-1',
    preferred_analysis_run_id: null,
    analysis_history: [],
    persistence_warning: null,
    ...overrides,
  };
}

describe('PgnImportNotice', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders successful feedback as a polite live status and expires after eight seconds', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<PgnImportNotice summary={summary()} onExpire={onExpire} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Loaded 2 games. Showing the first game.');

    act(() => vi.advanceTimersByTime(PGN_IMPORT_NOTICE_DURATION_MS - 1));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('replaces the prior timer when a new result arrives', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { rerender } = render(<PgnImportNotice summary={summary()} onExpire={onExpire} />);

    act(() => vi.advanceTimersByTime(4_000));
    rerender(<PgnImportNotice summary={summary({ num_games: 3 })} onExpire={onExpire} />);
    act(() => vi.advanceTimersByTime(4_000));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(4_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('keeps persistence warnings visible and clears success timers on unmount', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { rerender, unmount } = render(<PgnImportNotice summary={summary({
      num_games_added: 0,
      num_games_saved: 0,
      persistence_warning: 'Database unavailable',
    })} onExpire={onExpire} />);

    act(() => vi.advanceTimersByTime(PGN_IMPORT_NOTICE_DURATION_MS * 2));
    expect(onExpire).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Showing the first game in memory');

    rerender(<PgnImportNotice summary={summary()} onExpire={onExpire} />);
    unmount();
    act(() => vi.advanceTimersByTime(PGN_IMPORT_NOTICE_DURATION_MS));
    expect(onExpire).not.toHaveBeenCalled();
  });
});
