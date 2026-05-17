interface ConfigurationPanelProps {
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
}

export function ConfigurationPanel({
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
}: ConfigurationPanelProps) {
  return (
    <div className="rounded-lg border border-gray-700 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Analysis Configuration</h3>
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          {showConfig ? "Hide settings" : "Show settings"}
        </button>
      </div>

      {showConfig && (
        <div className="mt-2 flex items-start gap-4">
          <div className="flex-1 space-y-2">
            <Slider
              label="Stockfish Engine Depth"
              value={engineDepth}
              display={String(engineDepth)}
              min={5}
              max={30}
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
          </div>

          <div className="flex-1 space-y-2">
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
        </div>
      )}
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
      <label className="-mb-0.5 flex justify-between text-sm text-gray-400">
        <span>{label}</span>
        <span>{display}</span>
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
