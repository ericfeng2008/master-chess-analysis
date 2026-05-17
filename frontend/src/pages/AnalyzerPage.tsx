import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisChart } from "../components/AnalysisChart";
import { AnalysisChartLegend } from "../components/AnalysisChartLegend";
import { AnalyzeControlsPanel } from "../components/AnalyzeControlsPanel";
import { ChessBoard } from "../components/ChessBoard";
import { ConfigurationPanel } from "../components/ConfigurationPanel";
import { GameInfoPanel } from "../components/GameInfoPanel";
import { MoveNavigator } from "../components/MoveNavigator";
import { PgnViewer, type VariationData } from "../components/PgnViewer";
import { PositionInfoPanel } from "../components/PositionInfoPanel";
import { useAnalyzerHandlers } from "../hooks/useAnalyzerHandler";
import { useAnalyzerKeyboard } from "../hooks/useAnalyzerKeyboard";
import { useExploration } from "../hooks/useExploration";
import { useGameAnalysis } from "../hooks/useGameAnalysis";
import { useMoveNavigation } from "../hooks/useMoveNavigation";
import { useVariationEvaluation } from "../hooks/useVariationEvaluation";
import { bestLineFens } from "../utils/bestLineFens";
import { parsePgnHeaders } from "../utils/pgnHeaders";
import { parsePgnToMoves } from "../utils/pgnParser";

type PgnUploadResponse = {
  pgn: string;
  num_games: number;
  num_variations: number;
  max_depth: number;
};

export function AnalyzerPage() {
  const cti = useGameAnalysis();
  const exploration = useExploration();
  const { selectedMoveIndex, selectMove } = cti;

  const [pgn, setPgn] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<PgnUploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [perspective, setPerspective] = useState<"white" | "black">("white");

  const [acceptableDrop, setAcceptableDrop] = useState(0.5);
  const [minefieldThreshold, setMinefieldThreshold] = useState(0.8);
  const [engineDepth, setEngineDepth] = useState(20);
  const [showConfig, setShowConfig] = useState(true);

  const [blunderThreshold, setBlunderThreshold] = useState(1.0);
  const [mbiTrapThreshold, setMbiTrapThreshold] = useState(0.4);
  const [mbiOutlierThreshold, setMbiOutlierThreshold] = useState(0.05);
  const [eigThreshold, setEigThreshold] = useState(2.0);
  const [briThreshold, setBriThreshold] = useState(0.05);

  const [variationState, setVariationState] = useState<{ moveIndex: number; varIndex: number } | null>(null);
  const [showGameInfo, setShowGameInfo] = useState(false);

  const parsedGame = useMemo(() => (pgn ? parsePgnToMoves(pgn) : null), [pgn]);
  const parsedMoves = parsedGame?.moves ?? [];
  const pgnHeaders = useMemo(() => (pgn ? parsePgnHeaders(pgn) : {}), [pgn]);

  const variations = useMemo<Array<VariationData | null>>(() => {
    if (!cti.result) {
      return [];
    }

    return cti.result.moves.map((m) => {
      if (!m.best_line || m.best_line.length < 2) {
        return null;
      }
      if (m.best_move === null || m.move === m.best_move) {
        return null;
      }

      const evalAfter = m.eval_after;
      const bestEval = m.stockfish_eval;
      const drop = m.side === "white" ? bestEval - evalAfter : evalAfter - bestEval;
      if (drop < blunderThreshold) {
        return null;
      }

      return { line: m.best_line, fens: bestLineFens(m.fen, m.best_line) };
    });
  }, [cti.result, blunderThreshold]);

  const hasResult = cti.result != null;

  const navOptions = useMemo(
    () =>
      hasResult
        ? {
            externalIndex: selectedMoveIndex,
            onIndexChange: (index: number) => {
              setVariationState(null);
              selectMove(index);
            },
          }
        : undefined,
    [hasResult, selectedMoveIndex, selectMove],
  );

  const nav = useMoveNavigation(parsedMoves, navOptions);
  const activeIndex = nav.currentIndex;
  const selectedMove = activeIndex !== null && cti.result ? cti.result.moves[activeIndex] ?? null : null;

  const handlers = useAnalyzerHandlers({
    ctiResult: cti.result,
    selectMove: cti.selectMove,
    startAnalysis: cti.startAnalysis,
    isExploring: exploration.isExploring,
    currentExplorationIndex: exploration.currentExplorationIndex,
    exploredMoves: exploration.exploredMoves,
    startNewExploration: exploration.startNewExploration,
    addExploredMove: exploration.addExploredMove,
    exitExploration: exploration.exitExploration,
    navigateExploration: exploration.navigateExploration,
    savedExplorations: exploration.savedExplorations,
    activeSavedIndex: exploration.activeSavedIndex,
    enterSavedExploration: exploration.enterSavedExploration,
    goTo: nav.goTo,
    hasResult,
    activeIndex,
    parsedMoves,
    pgn,
    acceptableDrop,
    minefieldThreshold,
    engineDepth,
    blunderThreshold,
    mbiTrapThreshold,
    mbiOutlierThreshold,
    eigThreshold,
    briThreshold,
    setPgn,
    setUploadSummary,
    setUploadError,
    setUploading,
    setUploadedFileName,
    setShowConfig,
    variationState,
    setVariationState,
  });

  const { varEvalCache, varEvalLoading } = useVariationEvaluation({
    variationState,
    ctiResult: cti.result,
    engineDepth,
    acceptableDrop,
  });

  useAnalyzerKeyboard({
    exploration,
    variationState,
    setVariationState,
    ctiResult: cti.result,
  });

  const boardRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const node = boardRef.current;
    if (!node) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBoardHeight(entry.contentRect.height);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const boardFen =
    exploration.isExploring && exploration.currentExplorationIndex >= 0
      ? exploration.exploredMoves[exploration.currentExplorationIndex]?.fen
      : variationState != null
        ? (() => {
            const m = cti.result?.moves[variationState.moveIndex];
            if (!m) {
              return undefined;
            }
            return bestLineFens(m.fen, m.best_line)[variationState.varIndex];
          })()
        : activeIndex !== null
          ? parsedMoves[activeIndex]?.fen ?? cti.result?.moves[activeIndex]?.fen
          : undefined;

  return (
    <div className="min-h-screen overflow-x-hidden bg-gray-900 text-gray-100">
      <div className="mx-auto max-w-7xl p-6">
        <h1 className="mb-6 text-2xl font-bold">Master Chess Game Analyzer</h1>

        {cti.result && (
          <div className="mb-4">
            <div className="mb-2 flex gap-2">
              <button
                onClick={() => setPerspective("white")}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  perspective === "white" ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400"
                }`}
              >
                White Player
              </button>
              <button
                onClick={() => setPerspective("black")}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  perspective === "black" ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-400"
                }`}
              >
                Black Player
              </button>
            </div>

            <AnalysisChart
              moves={cti.result.moves}
              minefields={cti.result.minefields}
              selectedIndex={cti.selectedMoveIndex}
              onSelectMove={handlers.handleChartSelectMoveWithExit}
              perspective={perspective}
            />
            <h2 className="mt-1 text-center text-sm font-semibold text-gray-400">Evaluation and Metrics Chart</h2>
            <AnalysisChartLegend />
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[auto_1fr]">
          <div className="space-y-4">
            <div ref={boardRef}>
              <ChessBoard
                fen={boardFen}
                orientation={orientation}
                interactive={hasResult && !cti.isAnalyzing}
                onMove={handlers.handleBoardMove}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <MoveNavigator
                onFirst={nav.goFirst}
                onBack={nav.goBack}
                onForward={nav.goForward}
                onLast={nav.goLast}
                onFlip={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
                canGoBack={nav.canGoBack}
                canGoForward={nav.canGoForward}
              />

              <label className="shrink-0 cursor-pointer rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                Upload PGN File
                <input
                  type="file"
                  accept=".pgn"
                  onChange={handlers.handleFile}
                  disabled={uploading}
                  className="hidden"
                />
              </label>

              {uploadedFileName && (
                <span className="max-w-[160px] truncate text-sm text-gray-400" title={uploadedFileName}>
                  {uploadedFileName}
                </span>
              )}
            </div>

            {uploading && <p className="text-sm text-gray-400">Uploading...</p>}
            {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}
            {uploadSummary && (
              <p className="text-sm text-gray-300">
                {uploadSummary.num_games} game{uploadSummary.num_games !== 1 && "s"},{" "}
                {uploadSummary.num_variations} variation{uploadSummary.num_variations !== 1 && "s"}, max depth {uploadSummary.max_depth}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4" style={boardHeight ? { height: boardHeight } : undefined}>
            <div className="shrink-0 space-y-2">
              <ConfigurationPanel
                showConfig={showConfig}
                setShowConfig={setShowConfig}
                engineDepth={engineDepth}
                setEngineDepth={setEngineDepth}
                acceptableDrop={acceptableDrop}
                setAcceptableDrop={setAcceptableDrop}
                minefieldThreshold={minefieldThreshold}
                setMinefieldThreshold={setMinefieldThreshold}
                blunderThreshold={blunderThreshold}
                setBlunderThreshold={setBlunderThreshold}
                mbiTrapThreshold={mbiTrapThreshold}
                setMbiTrapThreshold={setMbiTrapThreshold}
                mbiOutlierThreshold={mbiOutlierThreshold}
                setMbiOutlierThreshold={setMbiOutlierThreshold}
                eigThreshold={eigThreshold}
                setEigThreshold={setEigThreshold}
                briThreshold={briThreshold}
                setBriThreshold={setBriThreshold}
              />

              <AnalyzeControlsPanel
                isAnalyzing={cti.isAnalyzing}
                cancelAnalysis={cti.cancelAnalysis}
                movesAnalyzed={cti.movesAnalyzed}
                totalMoves={cti.totalMoves}
                minefieldsFound={cti.minefieldsFound}
                error={cti.error}
                handleAnalyze={handlers.handleAnalyze}
                hasPgn={!!pgn}
              />

              <PositionInfoPanel
                selectedMove={selectedMove}
                exploration={exploration}
                variationState={variationState}
                varEvalCache={varEvalCache}
                varEvalLoading={varEvalLoading}
                ctiResult={cti.result}
              />

              <GameInfoPanel
                headers={pgnHeaders}
                showGameInfo={showGameInfo}
                setShowGameInfo={setShowGameInfo}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <PgnViewer
                moves={parsedMoves}
                activeMoveIndex={activeIndex}
                onMoveClick={handlers.handlePgnClick}
                className="h-full overflow-y-auto rounded-lg border border-gray-700 p-4"
                variations={variations}
                activeVariation={variationState}
                onVariationClick={handlers.handleVariationClick}
                exploredVariations={(() => {
                  const all = exploration.savedExplorations.map((se) => ({
                    branchPointIndex: se.branchPointIndex,
                    moves: se.moves.map((m) => ({ san: m.san, fen: m.fen })),
                  }));

                  if (
                    exploration.isExploring &&
                    exploration.activeSavedIndex < 0 &&
                    exploration.exploredMoves.length > 0
                  ) {
                    all.push({
                      branchPointIndex: exploration.branchPointIndex,
                      moves: exploration.exploredMoves.map((m) => ({ san: m.san, fen: m.fen })),
                    });
                  }

                  if (
                    exploration.isExploring &&
                    exploration.activeSavedIndex >= 0 &&
                    all[exploration.activeSavedIndex]
                  ) {
                    all[exploration.activeSavedIndex] = {
                      branchPointIndex: exploration.branchPointIndex,
                      moves: exploration.exploredMoves.map((m) => ({ san: m.san, fen: m.fen })),
                    };
                  }

                  return all;
                })()}
                activeExploration={
                  exploration.isExploring
                    ? {
                        explorationIndex:
                          exploration.activeSavedIndex >= 0
                            ? exploration.activeSavedIndex
                            : exploration.savedExplorations.length,
                        moveIndex: exploration.currentExplorationIndex,
                      }
                    : null
                }
                onExplorationClick={handlers.handleExplorationClick}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
