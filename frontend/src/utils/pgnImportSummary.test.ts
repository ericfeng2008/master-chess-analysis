import { describe, expect, it } from 'vitest';

import type { PgnUploadResponse } from '../types';
import { formatDisplayedGameDetails, formatPgnImportSummary } from './pgnImportSummary';

function summary(overrides: Partial<PgnUploadResponse> = {}): PgnUploadResponse {
  return {
    pgn: '[Event "Test"]\n\n1. e4 *',
    num_games: 1,
    num_unique_games: 1,
    num_games_added: 1,
    num_games_existing: 0,
    num_duplicate_games: 0,
    num_games_saved: 1,
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

describe('PGN import summary formatting', () => {
  it('uses a concise singular confirmation', () => {
    expect(formatPgnImportSummary(summary())).toBe(
      'Loaded 1 game. Showing it now. 1 game added to the Local Game Library.',
    );
  });

  it('reports added, existing, and duplicate outcomes without zero-value clauses', () => {
    expect(formatPgnImportSummary(summary({
      num_games: 5,
      num_unique_games: 4,
      num_games_added: 2,
      num_games_existing: 2,
      num_duplicate_games: 1,
      num_games_saved: 4,
    }))).toBe(
      'Loaded 5 games. Showing the first game. 2 games added to the Local Game Library; 2 games already saved; 1 duplicate entry skipped.',
    );

    expect(formatPgnImportSummary(summary({
      num_games: 2,
      num_unique_games: 2,
      num_games_added: 0,
      num_games_existing: 2,
      num_games_saved: 2,
    }))).toBe(
      'Loaded 2 games. Showing the first game. 2 games already saved.',
    );
  });

  it('states which games are not durable when persistence is unavailable', () => {
    expect(formatPgnImportSummary(summary({
      num_games: 3,
      num_unique_games: 3,
      num_games_added: 0,
      num_games_saved: 0,
      persistence_warning: 'Database unavailable',
    }))).toBe(
      'Loaded 3 games. Showing the first game in memory; 2 trailing games were not retained because the Local Game Library is unavailable.',
    );
    expect(formatPgnImportSummary(summary({
      num_games_added: 0,
      num_games_saved: 0,
      persistence_warning: 'Database unavailable',
    }))).toBe(
      'Loaded 1 game in memory. It was not saved to the Local Game Library.',
    );
  });

  it('scopes durable variation and depth details to the displayed game', () => {
    expect(formatDisplayedGameDetails(summary({ num_variations: 0, max_depth: 42 }))).toBe(
      'Displayed game · 0 variations · maximum depth 42',
    );
    expect(formatDisplayedGameDetails(summary({ num_games: 4, num_variations: 1, max_depth: 21 }))).toBe(
      'Displayed game (first of 4) · 1 variation · maximum depth 21',
    );
  });
});
