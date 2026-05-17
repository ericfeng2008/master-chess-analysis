interface ProgressBarProps {
  positionsAnalyzed: number;
  totalPositions: number;
  minefieldsFound: number;
}

export function ProgressBar({ positionsAnalyzed, totalPositions, minefieldsFound }: ProgressBarProps) {
  const pct = totalPositions > 0 ? (positionsAnalyzed / totalPositions) * 100 : 0;

  return (
    <div className="w-full">
      <div className="-mb-1 flex justify-between text-sm text-gray-400">
        <span>
          {positionsAnalyzed}/{totalPositions} positions analyzed
        </span>
        <span>{minefieldsFound} minefields found</span>
      </div>
      <div className="h-3 w-full rounded-full bg-gray-700">
        <div
          className="h-3 rounded-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
