import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisMistakeDialog } from "../components/AnalysisMistakeDialog";
import { AnalysisChart } from "../components/AnalysisChart";
import { AnalysisChartLegend } from "../components/AnalysisChartLegend";
import { AnalysisHistoryPanel } from "../components/AnalysisHistoryPanel";
import { ChessBoard } from "../components/ChessBoard";
import { ConfigurationPanel } from "../components/ConfigurationPanel";
import { GameInfoPanel } from "../components/GameInfoPanel";
import { GameMetadataEditor } from "../components/GameMetadataEditor";
import { MoveNavigator } from "../components/MoveNavigator";
import { PgnViewer, type VariationData } from "../components/PgnViewer";
import { PositionEvaluationBar } from "../components/PositionEvaluationBar";
import { PositionInfoPanel } from "../components/PositionInfoPanel";
import { PgnImportNotice } from "../components/PgnImportNotice";
import { MistakeLibraryWorkspace } from "../components/mistakes/MistakeLibraryWorkspace";
import { SavedGameLibraryOverlay } from "../components/SavedGameLibraryOverlay";
import { DEFAULT_MAIA3_ELO, HISTORICAL_MAIA3_ELO } from "../constants/maia3";
import { useAnalyzerHandlers } from "../hooks/useAnalyzerHandler";
import { useAnalyzerKeyboard } from "../hooks/useAnalyzerKeyboard";
import { useExploration } from "../hooks/useExploration";
import { useGameAnalysis } from "../hooks/useGameAnalysis";
import { useMoveNavigation } from "../hooks/useMoveNavigation";
import { useVariationEvaluation } from "../hooks/useVariationEvaluation";
import { getAnalysisRun, getLogicalGame, openStoredGame } from "../api/mistakes";
import { bestLineFens } from "../utils/bestLineFens";
import { resolveDisplayedPositionEvaluation } from "../utils/displayedPositionEvaluation";
import { validateSavedGameSummaryResponse, validateStoredGameOpenResponse } from "../utils/storedGameValidation";
import { parsePgnHeaders } from "../utils/pgnHeaders";
import { parsePgnToMoves } from "../utils/pgnParser";
import { formatDisplayedGameDetails } from "../utils/pgnImportSummary";
import type { AnalysisHistoryEntry, PgnUploadResponse } from "../types";
import type { GameMetadata, StoredGame, StoredGameMetadata, StoredGameSummary } from "../types/mistakes";

type Theme = "dark" | "light";
type ApplicationView = "analysis" | "mistake-library";
type ActiveMetadata = GameMetadata & { id: string };

function metadataFromGame(game: Pick<StoredGameMetadata, 'id' | 'metadata' | 'metadata_sources' | 'metadata_missing' | 'metadata_updated_at' | 'source_headers' | 'imported_metadata' | 'metadata_overrides'>): ActiveMetadata {
  return { id: game.id, metadata: game.metadata ?? {}, metadata_sources: game.metadata_sources ?? { Event: 'missing', White: 'missing', Black: 'missing' }, metadata_missing: game.metadata_missing ?? ['Event', 'White', 'Black'], metadata_updated_at: game.metadata_updated_at ?? null, source_headers: game.source_headers ?? {}, imported_metadata: game.imported_metadata ?? {}, metadata_overrides: game.metadata_overrides ?? {} };
}

function storedNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? value as number : fallback
}

export function AnalyzerPage() {
  const cti = useGameAnalysis();
  const exploration = useExploration();
  const { selectedMoveIndex, selectMove } = cti;

  const [pgn, setPgn] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryEntry[]>([]);
  const [importPersistenceWarning, setImportPersistenceWarning] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<PgnUploadResponse | null>(null);
  const [importNotice, setImportNotice] = useState<PgnUploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [savedLibraryOpen, setSavedLibraryOpen] = useState(false);
  const [metadataEditorGame, setMetadataEditorGame] = useState<ActiveMetadata | null>(null);
  const [activeMetadata, setActiveMetadata] = useState<ActiveMetadata | null>(null);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [savedGameOpenError, setSavedGameOpenError] = useState<string | null>(null);
  const [openingGameId, setOpeningGameId] = useState<string | null>(null);
  const boardColumnRef = useRef<HTMLElement>(null);
  const [boardColumnHeight, setBoardColumnHeight] = useState<number | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    return window.localStorage.getItem("masterprep-theme") === "dark" ? "dark" : "light";
  });
  const [applicationView, setApplicationView] = useState<ApplicationView>("analysis");
  const [mistakeCaptureOpen, setMistakeCaptureOpen] = useState(false);

  const expireImportNotice = useCallback(() => setImportNotice(null), []);

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
  const [maia3WhiteElo, setMaia3WhiteElo] = useState(DEFAULT_MAIA3_ELO);
  const [maia3BlackElo, setMaia3BlackElo] = useState(DEFAULT_MAIA3_ELO);

  const restoreStoredAnalysis = (game: StoredGame, selectedPly = 0) => {
    setAcceptableDrop(storedNumber(game.request.acceptable_drop, 0.5));
    setMinefieldThreshold(storedNumber(game.request.minefield_threshold, 0.8));
    setEngineDepth(storedNumber(game.request.engine_depth, 12));
    setBlunderThreshold(storedNumber(game.request.blunder_threshold, 1));
    setMbiTrapThreshold(storedNumber(game.request.mbi_trap_threshold, 0.4));
    setMbiOutlierThreshold(storedNumber(game.request.mbi_outlier_threshold, 0.05));
    setEigThreshold(storedNumber(game.request.eig_threshold, 2));
    setBriThreshold(storedNumber(game.request.bri_threshold, 0.05));
    setMaia3WhiteElo(storedNumber(game.request.maia3_white_elo, HISTORICAL_MAIA3_ELO));
    setMaia3BlackElo(storedNumber(game.request.maia3_black_elo, HISTORICAL_MAIA3_ELO));
    setGameId(game.game_id);
    setShowConfig(false);
    cti.restoreAnalysis(game, selectedPly);
  };

  const [variationState, setVariationState] = useState<{ moveIndex: number; varIndex: number } | null>(null);
  const [showGameInfo, setShowGameInfo] = useState(false);

  const parsedGame = useMemo(() => (pgn ? parsePgnToMoves(pgn) : null), [pgn]);
  const parsedMoves = parsedGame?.moves ?? [];
  const pgnHeaders = useMemo(() => (pgn ? parsePgnHeaders(pgn) : {}), [pgn]);
  const effectiveHeaders = useMemo(() => ({ ...pgnHeaders, ...(activeMetadata?.metadata ?? {}) }), [pgnHeaders, activeMetadata]);

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
    gameId: cti.result?.game_id ?? gameId,
    acceptableDrop,
    minefieldThreshold,
    engineDepth,
    blunderThreshold,
    mbiTrapThreshold,
    mbiOutlierThreshold,
    eigThreshold,
    briThreshold,
    maia3WhiteElo,
    maia3BlackElo,
    setPgn,
    setGameId,
    setAnalysisHistory,
    setImportPersistenceWarning,
    clearAnalysis: cti.clearAnalysis,
    restoreImportedAnalysis: restoreStoredAnalysis,
    setUploadSummary,
    setImportNotice,
    setUploadError,
    setUploading,
    setUploadedFileName,
    setShowConfig,
    variationState,
    setVariationState,
    onImportedGame: (result) => {
      exploration.clearExplorations();
      setVariationState(null);
      if (!result.preferred_analysis_run_id) {
        setMaia3WhiteElo(DEFAULT_MAIA3_ELO);
        setMaia3BlackElo(DEFAULT_MAIA3_ELO);
        setShowConfig(true);
      }
      if (result.num_games_saved > 0) setLibraryRefresh(value => value + 1);
      if (!result.game_id) { setActiveMetadata(null); return; }
      const metadata: ActiveMetadata = { id: result.game_id, metadata: result.metadata ?? {}, metadata_sources: (result.metadata_sources ?? { Event: 'missing', White: 'missing', Black: 'missing' }) as ActiveMetadata['metadata_sources'], metadata_missing: (result.metadata_missing ?? ['Event', 'White', 'Black']) as ActiveMetadata['metadata_missing'], metadata_updated_at: result.metadata_updated_at ?? null, source_headers: result.source_headers ?? {}, imported_metadata: result.imported_metadata ?? {}, metadata_overrides: result.metadata_overrides ?? {} };
      setActiveMetadata(metadata);
      setMetadataEditorGame(metadata.metadata_missing.length > 0 ? metadata : null);
    },
  });

  const applyMetadata = (game: StoredGameMetadata) => {
    if (activeMetadata?.id === game.id) setActiveMetadata(metadataFromGame(game));
    setUploadSummary(current => current && current.game_id === game.id ? { ...current, metadata: game.metadata, metadata_sources: game.metadata_sources, metadata_missing: game.metadata_missing, metadata_updated_at: game.metadata_updated_at, source_headers: game.source_headers, imported_metadata: game.imported_metadata, metadata_overrides: game.metadata_overrides } : current);
    setMetadataEditorGame(null);
    setLibraryRefresh(value => value + 1);
  };

  const loadSavedGame = async (summary: StoredGameSummary) => {
    if (cti.isAnalyzing) return;
    try {
      validateSavedGameSummaryResponse(summary);
    } catch (error) {
      setSavedGameOpenError(error instanceof Error ? error.message : String(error));
      return;
    }
    const isCurrentGame = summary.id === gameId;
    if (!isCurrentGame && (exploration.isExploring || exploration.savedExplorations.length > 0) && !window.confirm('Open another game? Your current variation exploration will be cleared.')) return;
    setSavedGameOpenError(null);
    setOpeningGameId(summary.id);
    try {
      const game = await openStoredGame(summary.id);
      validateStoredGameOpenResponse(game, summary.id);
      if (isCurrentGame) {
        setLibraryRefresh(value => value + 1);
        setSavedLibraryOpen(false);
        return;
      }
      exploration.clearExplorations();
      setVariationState(null);
      setPgn(game.normalized_pgn);
      setGameId(game.id);
      setAnalysisHistory(game.analysis_history);
      setImportPersistenceWarning(null);
      setImportNotice(null);
      setUploadError(null);
      setUploadedFileName(`${game.metadata.White ?? 'White'} — ${game.metadata.Black ?? 'Black'} · stored locally`);
      setUploadSummary({ pgn: game.normalized_pgn, num_games: 1, num_unique_games: 1, num_games_added: 0, num_games_existing: 1, num_duplicate_games: 0, num_games_saved: 1, num_variations: 0, max_depth: game.move_count, game_id: game.id, fingerprint_version: game.fingerprint_version, game_fingerprint: game.game_fingerprint, preferred_analysis_run_id: game.preferred_analysis_run_id, analysis_history: game.analysis_history, persistence_warning: null, metadata: game.metadata, metadata_sources: game.metadata_sources, metadata_missing: game.metadata_missing, metadata_updated_at: game.metadata_updated_at, source_headers: game.source_headers, imported_metadata: game.imported_metadata, metadata_overrides: game.metadata_overrides });
      setActiveMetadata(metadataFromGame(game));
      setLibraryRefresh(value => value + 1);
      if (game.analysis) restoreStoredAnalysis(game.analysis);
      else {
        cti.clearAnalysis();
        setMaia3WhiteElo(DEFAULT_MAIA3_ELO);
        setMaia3BlackElo(DEFAULT_MAIA3_ELO);
        setShowConfig(true);
      }
      setSavedLibraryOpen(false);
      if (game.metadata_missing.length) setMetadataEditorGame(metadataFromGame(game));
      else setMetadataEditorGame(null);
    } catch (error) {
      setSavedGameOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningGameId(null);
    }
  };

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
      const children = Array.from(node.children) as HTMLElement[];
      const rowGap = Number.parseFloat(window.getComputedStyle(node).rowGap) || 0;
      const contentHeight = children.reduce(
        (height, child) => height + child.getBoundingClientRect().height,
        rowGap * Math.max(0, children.length - 1),
      );
      setBoardColumnHeight(contentHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    const mutationObserver = new MutationObserver(updateHeight);
    observer.observe(node);
    mutationObserver.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
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

  const displayedPositionEvaluation = resolveDisplayedPositionEvaluation({
    boardFen,
    exploration,
    selectedMove,
    variationState,
    varEvalCache,
    varEvalLoading,
  });
  const showEvaluationBar = Boolean(
    cti.result &&
    cti.result.moves.length > 0 &&
    !cti.isAnalyzing &&
    displayedPositionEvaluation,
  );

  if (applicationView === "mistake-library") {
    const openStoredGame = (game: StoredGame, ply: number) => {
      const side = game.result.moves[ply]?.side === "black" ? "black" : "white";
      setPgn(game.normalized_pgn);
      setImportNotice(null);
      setUploadedFileName(`${game.headers.White ?? "White"} — ${game.headers.Black ?? "Black"} · stored locally`);
      setUploadSummary({
        pgn: game.normalized_pgn,
        num_games: 1,
        num_unique_games: 1,
        num_games_added: 0,
        num_games_existing: 1,
        num_duplicate_games: 0,
        num_games_saved: 1,
        num_variations: 0,
        max_depth: game.result.moves.length,
        game_id: game.game_id,
        fingerprint_version: null,
        game_fingerprint: null,
        preferred_analysis_run_id: game.id,
        analysis_history: [],
        persistence_warning: null,
      });
      setPerspective(side);
      setOrientation(side);
      restoreStoredAnalysis(game, ply);
      void getLogicalGame(game.game_id, game.id).then((logical) => {
        setAnalysisHistory(logical.analysis_history);
        setActiveMetadata(metadataFromGame(logical));
      }).catch(() => setAnalysisHistory([]));
      setApplicationView("analysis");
    };
    return <div className="app-shell"><MistakeLibraryWorkspace onBack={() => setApplicationView("analysis")} onOpenGame={openStoredGame} /></div>;
  }

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
            <button type="button" className="primary-button" onClick={() => setApplicationView("mistake-library")}>Mistake Library</button>
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

        {(cti.result?.persistence_warning || importPersistenceWarning) && <div className="review-alert analysis-persistence-warning">{cti.result?.persistence_warning || importPersistenceWarning}</div>}

        <div className={`workspace-grid ${cti.result ? "has-chart" : "no-chart"}`}>
          <aside ref={boardColumnRef} className="board-column">
            <div className="board-frame">
              <div className="main-board-stage">
                <div className="main-board-stage__board">
                  <ChessBoard
                    fen={boardFen}
                    orientation={orientation}
                    interactive={hasResult && !cti.isAnalyzing}
                    onMove={handlers.handleBoardMove}
                  />
                </div>
                {showEvaluationBar && displayedPositionEvaluation && (
                  <PositionEvaluationBar
                    evaluation={displayedPositionEvaluation.evaluation}
                    mateIn={displayedPositionEvaluation.mateIn}
                    orientation={orientation}
                    status={displayedPositionEvaluation.status}
                  />
                )}
              </div>
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
                <button type="button" className="text-button shrink-0" disabled={cti.isAnalyzing} onClick={() => setSavedLibraryOpen(true)}>Open Saved Game</button>
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
                  {formatDisplayedGameDetails(uploadSummary)}
                </p>
              )}
              <PgnImportNotice summary={importNotice} onExpire={expireImportNotice} />
            </div>

            <AnalysisHistoryPanel
              history={cti.result?.analysis_history ?? analysisHistory}
              activeRunId={cti.result?.analysis_run_id ?? null}
              cacheHit={Boolean(cti.result?.cache_hit)}
              disabled={cti.isAnalyzing}
              onSelect={(runId) => {
                setUploadError(null);
                void getAnalysisRun(runId)
                  .then((run) => restoreStoredAnalysis(run))
                  .catch((error: unknown) => setUploadError(error instanceof Error ? error.message : String(error)));
              }}
            />
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
                  headers={effectiveHeaders}
                  showGameInfo={showGameInfo}
                  setShowGameInfo={setShowGameInfo}
                  maia3WhiteElo={maia3WhiteElo}
                  setMaia3WhiteElo={setMaia3WhiteElo}
                  maia3BlackElo={maia3BlackElo}
                  setMaia3BlackElo={setMaia3BlackElo}
                  onEditMetadata={activeMetadata ? () => setMetadataEditorGame(activeMetadata) : undefined}
                  metadataEditingUnavailableReason={!activeMetadata && importPersistenceWarning ? 'Game details cannot be edited until local storage is available.' : undefined}
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
                      moves: se.moves.map((m) => ({
                        san: m.san,
                        fen: m.fen,
                        side: m.side,
                        moveNumber: m.moveNumber,
                      })),
                    }));

                    if (
                      exploration.isExploring &&
                      exploration.activeSavedIndex < 0 &&
                      exploration.exploredMoves.length > 0
                    ) {
                      all.push({
                        branchPointIndex: exploration.branchPointIndex,
                        moves: exploration.exploredMoves.map((m) => ({
                          san: m.san,
                          fen: m.fen,
                          side: m.side,
                          moveNumber: m.moveNumber,
                        })),
                      });
                    }

                    if (
                      exploration.isExploring &&
                      exploration.activeSavedIndex >= 0 &&
                      all[exploration.activeSavedIndex]
                    ) {
                      all[exploration.activeSavedIndex] = {
                        branchPointIndex: exploration.branchPointIndex,
                        moves: exploration.exploredMoves.map((m) => ({
                          san: m.san,
                          fen: m.fen,
                          side: m.side,
                          moveNumber: m.moveNumber,
                        })),
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
              onOpenMistakes={cti.result?.analysis_run_id && !cti.isAnalyzing ? () => setMistakeCaptureOpen(true) : undefined}
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
              analysisMaia3WhiteElo={cti.analysisMaia3WhiteElo}
              analysisMaia3BlackElo={cti.analysisMaia3BlackElo}
              error={cti.error}
              handleAnalyze={handlers.handleAnalyze}
              hasPgn={!!pgn}
            />

            {cti.result && (
              <PositionInfoPanel
                selectedMove={selectedMove}
                exploration={exploration}
                variationState={variationState}
                varEvalCache={varEvalCache}
                varEvalLoading={varEvalLoading}
                ctiResult={cti.result}
              />
            )}
          </aside>
        </div>
      </div>
      <SavedGameLibraryOverlay open={savedLibraryOpen} disabled={cti.isAnalyzing} refreshToken={libraryRefresh} openError={savedGameOpenError} openingGameId={openingGameId} onClose={() => { setSavedLibraryOpen(false); setSavedGameOpenError(null) }} onPreviewGame={() => setSavedGameOpenError(null)} onOpenGame={(game) => void loadSavedGame(game)} onEditMetadata={(game) => {
        setSavedGameOpenError(null);
        try {
          validateSavedGameSummaryResponse(game);
          setMetadataEditorGame(metadataFromGame(game));
        } catch (error) {
          setSavedGameOpenError(error instanceof Error ? error.message : String(error));
        }
      }} />
      <AnalysisMistakeDialog
        open={mistakeCaptureOpen && Boolean(cti.result?.analysis_run_id)}
        analysisRunId={cti.result?.analysis_run_id ?? ""}
        studySide={perspective}
        players={{ white: effectiveHeaders.White, black: effectiveHeaders.Black }}
        onStudySideChange={setPerspective}
        onJumpToMove={(ply) => { cti.selectMove(ply); nav.goTo(ply) }}
        onOpenLibrary={() => {
          setMistakeCaptureOpen(false);
          setApplicationView("mistake-library");
        }}
        onClose={() => setMistakeCaptureOpen(false)}
      />
      {metadataEditorGame && <GameMetadataEditor game={metadataEditorGame} onClose={() => setMetadataEditorGame(null)} onSaved={applyMetadata} />}
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
          Review PGN games with objective Stockfish evaluation and Maia3 human move-likelihood
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
