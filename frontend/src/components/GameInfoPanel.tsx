import { useEffect, useRef } from "react";

type PgnHeaders = Record<string, string>;

interface GameInfoPanelProps {
  headers: PgnHeaders;
  showGameInfo: boolean;
  setShowGameInfo: (v: boolean) => void;
  maia3WhiteElo: number;
  setMaia3WhiteElo: (v: number) => void;
  maia3BlackElo: number;
  setMaia3BlackElo: (v: number) => void;
}

const MAIA3_ELO_OPTIONS = [2000, 2200, 2400, 2600];

const TAG_DISPLAY_ORDER: Array<{ key: string; label: string }> = [
  { key: "Event", label: "Event" },
  { key: "Site", label: "Site" },
  { key: "Date", label: "Date" },
  { key: "Round", label: "Round" },
  { key: "White", label: "White" },
  { key: "WhiteElo", label: "White Elo" },
  { key: "WhiteTitle", label: "White Title" },
  { key: "Black", label: "Black" },
  { key: "BlackElo", label: "Black Elo" },
  { key: "BlackTitle", label: "Black Title" },
  { key: "Result", label: "Result" },
  { key: "ECO", label: "ECO" },
  { key: "Opening", label: "Opening" },
  { key: "Variation", label: "Variation" },
  { key: "TimeControl", label: "Time Control" },
  { key: "Termination", label: "Termination" },
  { key: "UTCDate", label: "UTC Date" },
  { key: "UTCTime", label: "UTC Time" },
  { key: "WhiteRatingDiff", label: "White Rating Diff" },
  { key: "BlackRatingDiff", label: "Black Rating Diff" },
  { key: "WhiteTeam", label: "White Team" },
  { key: "BlackTeam", label: "Black Team" },
  { key: "Board", label: "Board" },
];

export function GameInfoPanel({
  headers,
  showGameInfo,
  setShowGameInfo,
  maia3WhiteElo,
  setMaia3WhiteElo,
  maia3BlackElo,
  setMaia3BlackElo,
}: GameInfoPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const hasHeaders = Object.keys(headers).length > 0;

  useEffect(() => {
    if (!showGameInfo) {
      return;
    }

    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowGameInfo(false);
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [showGameInfo, setShowGameInfo]);

  const white = headers.White;
  const black = headers.Black;
  const result = headers.Result;
  const title = [white, black].filter(Boolean).join(" vs. ") || "Game Info";

  return (
    <div ref={panelRef} className="shrink-0">
      <div className="panel-header mb-2">
        <h3 className="section-title truncate">
          {title}
          {result && <span className="muted"> ({result})</span>}
        </h3>
        <button
          onClick={() => setShowGameInfo(!showGameInfo)}
          className="text-button shrink-0"
        >
          {showGameInfo ? "Fold" : "Game Info"}
        </button>
      </div>

      <div className="game-info-elo-row">
        <EloSelect
          id="maia3-white-elo"
          label="White Maia3"
          value={maia3WhiteElo}
          onChange={setMaia3WhiteElo}
        />
        <EloSelect
          id="maia3-black-elo"
          label="Black Maia3"
          value={maia3BlackElo}
          onChange={setMaia3BlackElo}
        />
      </div>

      {showGameInfo && (
        <div className="game-info-detail">
          {hasHeaders ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              {TAG_DISPLAY_ORDER.filter(({ key }) => headers[key]).map(({ key, label }) => (
                <div key={key} className="contents">
                  <span className="metric-label">{label}:</span>
                  <span className="info-value">{headers[key]}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="status-line">No PGN tags found.</p>
          )}
        </div>
      )}
    </div>
  );
}

function EloSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="game-info-elo-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="settings-select game-info-elo-select"
      >
        {MAIA3_ELO_OPTIONS.map((elo) => (
          <option key={elo} value={elo}>
            {elo}
          </option>
        ))}
      </select>
    </label>
  );
}
