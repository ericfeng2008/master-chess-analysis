import { useEffect, useRef } from "react";

type PgnHeaders = Record<string, string>;

interface GameInfoPanelProps {
  headers: PgnHeaders;
  showGameInfo: boolean;
  setShowGameInfo: (v: boolean) => void;
}

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

export function GameInfoPanel({ headers, showGameInfo, setShowGameInfo }: GameInfoPanelProps) {
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

  if (!hasHeaders) {
    return null;
  }

  const white = headers.White;
  const black = headers.Black;
  const result = headers.Result;
  const title = [white, black].filter(Boolean).join(" vs. ") || "Game Info";

  return (
    <div ref={panelRef} className="shrink-0">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="truncate text-sm font-medium text-gray-400">
          {title}
          {result && <span className="-ml-1 text-gray-500"> ({result})</span>}
        </h3>
        <button
          onClick={() => setShowGameInfo(!showGameInfo)}
          className="ml-2 shrink-0 text-xs text-indigo-400 hover:text-indigo-300"
        >
          {showGameInfo ? "Hide game info" : "Show game info"}
        </button>
      </div>

      {showGameInfo && (
        <div className="rounded-lg border border-gray-700 p-3">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            {TAG_DISPLAY_ORDER.filter(({ key }) => headers[key]).map(({ key, label }) => (
              <div key={key} className="contents">
                <span className="text-gray-500">{label}:</span>
                <span className="text-gray-300">{headers[key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
