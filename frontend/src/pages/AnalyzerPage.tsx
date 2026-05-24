import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisChart } from "../components/AnalysisChart";
import { AnalysisChartLegend } from "../components/AnalysisChartLegend";
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

type Theme = "dark" | "light";

export function AnalyzerPage() {
  const cti = useGameAnalysis();
  const exploration = useExploration();
  const { selectedMoveIndex, selectMove } = cti;

  const [pgn, setPgn] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<PgnUploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const boardColumnRef = useRef<HTMLElement>(null);
  const [boardColumnHeight, setBoardColumnHeight] = useState<number | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    return window.localStorage.getItem("masterprep-theme") === "dark" ? "dark" : "light";
  });

  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [perspective, setPerspective] = useState<"white" | "black">("white");

  const [acceptableDrop, setAcceptableDrop] = useState(0.5);
  const [minefieldThreshold, setMinefieldThreshold] = useState(0.8);
  const [engineDepth, setEngineDepth] = useState(12);
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("masterprep-theme", theme);
  }, [theme]);

  useEffect(() => {
    const node = boardColumnRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      setBoardColumnHeight(node.getBoundingClientRect().height);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
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
    <div className="app-shell">
      <div className="workbench">
        <header className="app-header">
          <div className="title-cluster">
            <div className="title-row">
              <h1 className="app-title">Master Chess Game Analyzer</h1>
              <div className="segment-control" aria-label="Theme">
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className="segment-button"
                  data-active={theme === "dark"}
                >
                  Dark
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className="segment-button"
                  data-active={theme === "light"}
                >
                  Light
                </button>
              </div>
            </div>
            <p className="app-subtitle">
              Engine timeline, PGN branches, and position diagnostics for serious game review.
            </p>
          </div>
          <div className="header-controls">
            {hasResult && (
              <div className="segment-control" aria-label="Analysis perspective">
                <button
                  type="button"
                  onClick={() => setPerspective("white")}
                  className="segment-button"
                  data-active={perspective === "white"}
                >
                  White
                </button>
                <button
                  type="button"
                  onClick={() => setPerspective("black")}
                  className="segment-button"
                  data-active={perspective === "black"}
                >
                  Black
                </button>
              </div>
            )}
          </div>
        </header>

        <div className={`workspace-grid ${cti.result ? "has-chart" : "no-chart"}`}>
          <aside ref={boardColumnRef} className="board-column">
            <div className="board-frame">
              <ChessBoard
                fen={boardFen}
                orientation={orientation}
                interactive={hasResult && !cti.isAnalyzing}
                onMove={handlers.handleBoardMove}
              />
            </div>

            <div className="panel panel-radius panel-pad">
              <div className="toolbar">
                <MoveNavigator
                  onFirst={nav.goFirst}
                  onBack={nav.goBack}
                  onForward={nav.goForward}
                  onLast={nav.goLast}
                  onFlip={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
                  canGoBack={nav.canGoBack}
                  canGoForward={nav.canGoForward}
                />

                <label className={`primary-button shrink-0 ${uploading ? "button-disabled" : "cursor-pointer"}`}>
                  Upload PGN
                  <input
                    type="file"
                    accept=".pgn"
                    onChange={handlers.handleFile}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              </div>

              {uploadedFileName && (
                <p className="status-line mt-3 truncate" title={uploadedFileName}>
                  {uploadedFileName}
                </p>
              )}
              {uploading && <p className="status-line mt-3">Uploading...</p>}
              {uploadError && <p className="status-line status-error mt-3">{uploadError}</p>}
              {uploadSummary && (
                <p className="status-line mt-3">
                  {uploadSummary.num_games} game{uploadSummary.num_games !== 1 && "s"},{" "}
                  {uploadSummary.num_variations} variation{uploadSummary.num_variations !== 1 && "s"}, max depth {uploadSummary.max_depth}
                </p>
              )}
            </div>
          </aside>

          {cti.result && (
            <section className="timeline-column panel panel-radius chart-panel">
              <div className="chart-shell">
                <div className="chart-title-row">
                  <h2 className="section-title">Evaluation Timeline</h2>
                  <span className="status-line">Perspective: {perspective}</span>
                </div>
                <AnalysisChart
                  moves={cti.result.moves}
                  minefields={cti.result.minefields}
                  selectedIndex={cti.selectedMoveIndex}
                  onSelectMove={handlers.handleChartSelectMoveWithExit}
                  perspective={perspective}
                />
                <AnalysisChartLegend />
              </div>
            </section>
          )}

          <main className="notation-column">
            {pgn ? (
              <section className="panel panel-radius panel-pad notation-box">
                <GameInfoPanel
                  headers={pgnHeaders}
                  showGameInfo={showGameInfo}
                  setShowGameInfo={setShowGameInfo}
                />

                <PgnViewer
                  moves={parsedMoves}
                  activeMoveIndex={activeIndex}
                  onMoveClick={handlers.handlePgnClick}
                  className="pgn-panel"
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
              </section>
            ) : (
              <IntroPanel height={boardColumnHeight} />
            )}
          </main>

          <aside className="analysis-column">
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
          </aside>
        </div>
      </div>
    </div>
  );
}

function IntroPanel({ height }: { height: number | null }) {
  return (
    <section className="panel panel-radius panel-pad intro-panel" style={height ? { height } : undefined}>
      <div className="intro-hero">
        <span className="intro-kicker">Local analysis</span>
        <h2>Chess Review With Engine and Intuition</h2>
        <p>
          Review PGN games with objective Stockfish evaluation and Maia-2200 human move-likelihood
          modeling. The analysis highlights practical difficulty, natural mistakes, intuition gaps,
          and brilliant moves that are hard for humans to find.
        </p>
      </div>

      <div className="intro-metric-strip" aria-label="Analysis metrics">
        <span>CTI</span>
        <span>Minefields</span>
        <span>MBI</span>
        <span>EIG</span>
        <span>BRI</span>
        <span>EPE</span>
      </div>

      <div className="intro-grid">
        <div>
          <h3>1. Load a PGN</h3>
          <p>Use Upload PGN below the board. The notation panel will show the game moves and PGN metadata.</p>
        </div>
        <div>
          <h3>2. Run analysis</h3>
          <p>Tune analysis settings if needed, then click Analyze. Everything runs locally on this machine.</p>
        </div>
        <div>
          <h3>3. Review both players</h3>
          <p>
            After analysis, the timeline chart appears with CTI, minefields, MBI, EIG, BRI, and EPE metrics
            for White and Black perspectives.
          </p>
        </div>
      </div>
    </section>
  );
}
