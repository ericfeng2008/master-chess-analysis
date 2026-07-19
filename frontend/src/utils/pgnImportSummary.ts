import type { PgnUploadResponse } from '../types';

function countPhrase(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatPgnImportSummary(summary: PgnUploadResponse): string {
  if (summary.persistence_warning || summary.num_games_saved === 0) {
    if (summary.num_games === 1) {
      return 'Loaded 1 game in memory. It was not saved to the Local Game Library.';
    }

    const trailingGames = Math.max(0, summary.num_games - 1);
    return `Loaded ${summary.num_games} games. Showing the first game in memory; ${countPhrase(trailingGames, 'trailing game')} ${trailingGames === 1 ? 'was' : 'were'} not retained because the Local Game Library is unavailable.`;
  }

  const introduction = summary.num_games === 1
    ? 'Loaded 1 game. Showing it now.'
    : `Loaded ${summary.num_games} games. Showing the first game.`;
  const outcomes: string[] = [];

  if (summary.num_games_added > 0) {
    outcomes.push(`${countPhrase(summary.num_games_added, 'game')} added to the Local Game Library`);
  }
  if (summary.num_games_existing > 0) {
    outcomes.push(`${countPhrase(summary.num_games_existing, 'game')} already saved`);
  }
  if (summary.num_duplicate_games > 0) {
    outcomes.push(`${countPhrase(summary.num_duplicate_games, 'duplicate entry', 'duplicate entries')} skipped`);
  }

  return outcomes.length > 0 ? `${introduction} ${outcomes.join('; ')}.` : introduction;
}

export function formatDisplayedGameDetails(summary: PgnUploadResponse): string {
  const subject = summary.num_games > 1
    ? `Displayed game (first of ${summary.num_games})`
    : 'Displayed game';
  return `${subject} · ${countPhrase(summary.num_variations, 'variation')} · maximum depth ${summary.max_depth}`;
}
