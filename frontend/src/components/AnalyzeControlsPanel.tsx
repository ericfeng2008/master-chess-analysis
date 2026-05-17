import { ProgressBar } from "./ProgressBar";

interface AnalyzeControlsPanelProps {
  isAnalyzing: boolean;
  cancelAnalysis: () => void;
  movesAnalyzed: number;
  totalMoves: number;
  minefieldsFound: number;
  error: string | null;
  handleAnalyze: () => void;
  hasPgn: boolean;
}

export function AnalyzeControlsPanel({
  isAnalyzing,
  cancelAnalysis,
  movesAnalyzed,
  totalMoves,
  minefieldsFound,
  error,
  handleAnalyze,
  hasPgn,
}: AnalyzeControlsPanelProps) {
  return (
    <>
      <div className="flex items-center gap-3">
        {isAnalyzing ? (
          <>
            <button
              onClick={cancelAnalysis}
              className="w-1/2 shrink-0 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-500"
            >
              Cancel
            </button>
            <div className="min-w-0 flex-1">
              <ProgressBar
                positionsAnalyzed={movesAnalyzed}
                totalPositions={totalMoves}
                minefieldsFound={minefieldsFound}
              />
            </div>
          </>
        ) : (
          <button
            onClick={handleAnalyze}
            disabled={!hasPgn}
            className="w-1/2 rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Analyze
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </>
  );
}
