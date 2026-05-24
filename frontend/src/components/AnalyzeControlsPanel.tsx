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
    <div className="panel panel-radius panel-pad">
      <div className="panel-header mb-3">
        <h3 className="section-title">Run Analysis</h3>
        {!isAnalyzing && <span className="status-line">{hasPgn ? "Ready" : "PGN required"}</span>}
      </div>

      <div className="flex items-center gap-3">
        {isAnalyzing ? (
          <>
            <button
              onClick={cancelAnalysis}
              className="danger-button w-1/3 shrink-0"
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
            className="primary-button w-full"
          >
            Analyze
          </button>
        )}
      </div>

      {error && <p className="status-line status-error mt-3">{error}</p>}
    </div>
  );
}
