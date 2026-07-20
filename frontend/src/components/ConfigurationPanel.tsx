import { ProgressBar } from "./ProgressBar";

interface ConfigurationPanelProps {
  onOpenMistakes?: () => void;
  showConfig: boolean;
  setShowConfig: (v: boolean | ((prev: boolean) => boolean)) => void;
  engineDepth: number;
  setEngineDepth: (v: number) => void;
  acceptableDrop: number;
  setAcceptableDrop: (v: number) => void;
  minefieldThreshold: number;
  setMinefieldThreshold: (v: number) => void;
  blunderThreshold: number;
  setBlunderThreshold: (v: number) => void;
  mbiTrapThreshold: number;
  setMbiTrapThreshold: (v: number) => void;
  mbiOutlierThreshold: number;
  setMbiOutlierThreshold: (v: number) => void;
  eigThreshold: number;
  setEigThreshold: (v: number) => void;
  briThreshold: number;
  setBriThreshold: (v: number) => void;
  isAnalyzing: boolean;
  cancelAnalysis: () => void;
  movesAnalyzed: number;
  totalMoves: number;
  minefieldsFound: number;
  analysisMaia3WhiteElo: number | null;
  analysisMaia3BlackElo: number | null;
  error: string | null;
  handleAnalyze: () => void;
  hasPgn: boolean;
}

export function ConfigurationPanel({
  onOpenMistakes,
  showConfig,
  setShowConfig,
  engineDepth,
  setEngineDepth,
  acceptableDrop,
  setAcceptableDrop,
  minefieldThreshold,
  setMinefieldThreshold,
  blunderThreshold,
  setBlunderThreshold,
  mbiTrapThreshold,
  setMbiTrapThreshold,
  mbiOutlierThreshold,
  setMbiOutlierThreshold,
  eigThreshold,
  setEigThreshold,
  briThreshold,
  setBriThreshold,
  isAnalyzing,
  cancelAnalysis,
  movesAnalyzed,
  totalMoves,
  minefieldsFound,
  analysisMaia3WhiteElo,
  analysisMaia3BlackElo,
  error,
  handleAnalyze,
  hasPgn,
}: ConfigurationPanelProps) {
  return (
    <div className="configuration-panel panel panel-radius panel-pad">
      <div className="panel-header">
        <div>
          <h3 className="section-title">Run Analysis</h3>
          <p className="status-line mt-1">
            {hasPgn ? "Ready" : "PGN required"} · Depth {engineDepth}
            {analysisMaia3WhiteElo !== null && analysisMaia3BlackElo !== null &&
              ` · Maia3 ${analysisMaia3WhiteElo}/${analysisMaia3BlackElo}`}
          </p>
        </div>
        {onOpenMistakes && (
          <button type="button" className="analysis-mistake-launch text-button" onClick={onOpenMistakes}>
            Save Mistakes
          </button>
        )}
      </div>

      <div className="settings-summary">
        <span>Analysis settings</span>
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="text-button"
        >
          {showConfig ? "Fold Settings" : "Tune Settings"}
        </button>
      </div>

      {showConfig && (
        <div className="settings-grid">
          <Slider
            label="Stockfish Engine Depth"
            value={engineDepth}
            display={String(engineDepth)}
            min={10}
            max={20}
            step={1}
            onChange={setEngineDepth}
          />
          <Slider
            label="CTI: Acceptable Drop"
            value={acceptableDrop}
            display={acceptableDrop.toFixed(1)}
            min={0.1}
            max={2}
            step={0.1}
            onChange={setAcceptableDrop}
          />
          <Slider
            label="CTI: Minefield Threshold"
            value={minefieldThreshold}
            display={minefieldThreshold.toFixed(2)}
            min={0.5}
            max={1}
            step={0.05}
            onChange={setMinefieldThreshold}
          />
          <Slider
            label="MBI: Blunder Threshold"
            value={blunderThreshold}
            display={blunderThreshold.toFixed(1)}
            min={0.5}
            max={3}
            step={0.1}
            onChange={setBlunderThreshold}
          />
          <Slider
            label="MBI: Trap Probability"
            value={mbiTrapThreshold}
            display={`${(mbiTrapThreshold * 100).toFixed(0)}%`}
            min={0.1}
            max={0.8}
            step={0.05}
            onChange={setMbiTrapThreshold}
          />
          <Slider
            label="MBI: Outlier Probability"
            value={mbiOutlierThreshold}
            display={`${(mbiOutlierThreshold * 100).toFixed(0)}%`}
            min={0.01}
            max={0.2}
            step={0.01}
            onChange={setMbiOutlierThreshold}
          />
          <Slider
            label="EIG: Gap Threshold"
            value={eigThreshold}
            display={eigThreshold.toFixed(1)}
            min={0.5}
            max={5}
            step={0.1}
            onChange={setEigThreshold}
          />
          <Slider
            label="BRI: Brilliancy Threshold"
            value={briThreshold}
            display={`${(briThreshold * 100).toFixed(0)}%`}
            min={0.01}
            max={0.2}
            step={0.01}
            onChange={setBriThreshold}
          />
        </div>
      )}

      <div className="analysis-action">
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
    </div>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="settings-slider-label">
        <span>{label}</span>
        <span className="mono muted">{display}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
