import { useEffect } from 'react';

import type { PgnUploadResponse } from '../types';
import { formatPgnImportSummary } from '../utils/pgnImportSummary';

export const PGN_IMPORT_NOTICE_DURATION_MS = 8_000;

interface PgnImportNoticeProps {
  summary: PgnUploadResponse | null;
  onExpire: () => void;
}

export function PgnImportNotice({ summary, onExpire }: PgnImportNoticeProps) {
  useEffect(() => {
    if (!summary || summary.persistence_warning || summary.num_games_saved === 0) {
      return;
    }

    const timer = window.setTimeout(onExpire, PGN_IMPORT_NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onExpire, summary]);

  if (!summary) {
    return null;
  }

  const isPersistenceWarning = Boolean(summary.persistence_warning || summary.num_games_saved === 0);
  return (
    <p
      role="status"
      aria-live="polite"
      className={`pgn-import-notice mt-3${isPersistenceWarning ? ' pgn-import-notice-warning' : ''}`}
    >
      {formatPgnImportSummary(summary)}
    </p>
  );
}
