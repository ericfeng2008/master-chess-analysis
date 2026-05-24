interface ProgressBarProps {
  positionsAnalyzed: number;
  totalPositions: number;
  minefieldsFound: number;
}

export function ProgressBar({ positionsAnalyzed, totalPositions, minefieldsFound }: ProgressBarProps) {
  const pct = totalPositions > 0 ? (positionsAnalyzed / totalPositions) * 100 : 0;

  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between gap-3 text-xs muted">
        <span>
          {positionsAnalyzed}/{totalPositions} positions analyzed
        </span>
        <span>{minefieldsFound} minefields found</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg-soft)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
