import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzeResult, AnalysisMoveResult, PgnUploadResponse, PositionEvalResult } from "../types";
import type { LogicalStoredGame, StoredGame, StoredGameSummary } from "../types/mistakes";
import { bestLineFens } from "../utils/bestLineFens";
import { AnalyzerPage } from "./AnalyzerPage";

type VariationState = { moveIndex: number; varIndex: number } | null;

interface HarnessGameState {
  isAnalyzing: boolean;
  movesAnalyzed: number;
  totalMoves: number;
  minefieldsFound: number;
  result: AnalyzeResult | null;
  selectedMoveIndex: number | null;
  error: string | null;
  analysisMaia3WhiteElo: number | null;
  analysisMaia3BlackElo: number | null;
  startAnalysis: () => void;
  cancelAnalysis: () => void;
  clearAnalysis: () => void;
  selectMove: (index: number) => void;
  restoreAnalysis: () => void;
}

interface HarnessExplorationState {
  isExploring: boolean;
  branchPointIndex: number;
  exploredMoves: Array<{
    san: string;
    fen: string;
    side: "white" | "black";
    moveNumber: number;
    evalResult: PositionEvalResult | null;
  }>;
  currentExplorationIndex: number;
  isEvaluating: boolean;
  activeSavedIndex: number;
  savedExplorations: [];
  startNewExploration: () => void;
  addExploredMove: () => void;
  navigateExploration: () => void;
  exitExploration: () => void;
  enterSavedExploration: () => void;
  clearExplorations: () => void;
}

interface TestHarness {
  game: HarnessGameState;
  exploration: HarnessExplorationState;
  varEvalCache: Map<string, PositionEvalResult>;
  varEvalLoading: string | null;
  setVariationState: ((state: VariationState) => void) | null;
  onImportedGame: ((result: PgnUploadResponse) => void) | null;
  activateImportedGame: ((result: PgnUploadResponse) => void) | null;
  onOpenSavedGame: ((game: StoredGameSummary) => void) | null;
}

const harness = vi.hoisted(() => ({
  game: null,
  exploration: null,
  varEvalCache: new Map(),
  varEvalLoading: null,
  setVariationState: null,
  onImportedGame: null,
  activateImportedGame: null,
  onOpenSavedGame: null,
})) as unknown as TestHarness;

const pageApi = vi.hoisted(() => ({
  getAnalysisRun: vi.fn(),
  getLogicalGame: vi.fn(),
  openStoredGame: vi.fn(),
}));

vi.mock("../api/mistakes", () => ({
  getAnalysisRun: (...args: unknown[]) => pageApi.getAnalysisRun(...args),
  getLogicalGame: (...args: unknown[]) => pageApi.getLogicalGame(...args),
  openStoredGame: (...args: unknown[]) => pageApi.openStoredGame(...args),
}));

vi.mock("../hooks/useGameAnalysis", () => ({
  useGameAnalysis: () => harness.game,
}));

vi.mock("../hooks/useExploration", () => ({
  useExploration: () => harness.exploration,
}));

vi.mock("../hooks/useMoveNavigation", () => ({
  useMoveNavigation: () => ({
    currentIndex: harness.game.result ? harness.game.selectedMoveIndex : null,
    currentFen: undefined,
    goFirst: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    goLast: vi.fn(),
    goTo: vi.fn(),
    canGoBack: false,
    canGoForward: false,
  }),
}));

vi.mock("../hooks/useAnalyzerHandler", () => ({
  useAnalyzerHandlers: (deps: {
    setPgn: (pgn: string) => void;
    setVariationState: (state: VariationState) => void;
    onImportedGame: (result: PgnUploadResponse) => void;
  }) => {
    harness.setVariationState = deps.setVariationState;
    harness.onImportedGame = deps.onImportedGame;
    harness.activateImportedGame = (result) => {
      deps.setPgn(result.pgn);
      deps.onImportedGame(result);
    };
    return {
      handleBoardMove: vi.fn(() => false),
      handleChartSelectMoveWithExit: vi.fn(),
      handleFile: vi.fn(),
      handlePgnClick: vi.fn(),
      handleVariationClick: vi.fn(),
      handleExplorationClick: vi.fn(),
      handleAnalyze: vi.fn(),
    };
  },
}));

vi.mock("../hooks/useAnalyzerKeyboard", () => ({
  useAnalyzerKeyboard: vi.fn(),
}));

vi.mock("../hooks/useVariationEvaluation", () => ({
  useVariationEvaluation: () => ({
    varEvalCache: harness.varEvalCache,
    varEvalLoading: harness.varEvalLoading,
  }),
}));

vi.mock("../components/AnalysisChart", () => ({ AnalysisChart: () => null }));
vi.mock("../components/AnalysisChartLegend", () => ({ AnalysisChartLegend: () => null }));
vi.mock("../components/ChessBoard", () => ({
  ChessBoard: ({ orientation }: { orientation: "white" | "black" }) => (
    <div data-testid="main-chessboard" data-orientation={orientation} />
  ),
}));
vi.mock("../components/ConfigurationPanel", () => ({ ConfigurationPanel: () => null }));
vi.mock("../components/GameInfoPanel", () => ({
  GameInfoPanel: ({
    maia3WhiteElo,
    setMaia3WhiteElo,
    maia3BlackElo,
    setMaia3BlackElo,
  }: {
    maia3WhiteElo: number;
    setMaia3WhiteElo: (value: number) => void;
    maia3BlackElo: number;
    setMaia3BlackElo: (value: number) => void;
  }) => (
    <div>
      <output data-testid="white-maia3-elo">{maia3WhiteElo}</output>
      <output data-testid="black-maia3-elo">{maia3BlackElo}</output>
      <button type="button" onClick={() => setMaia3WhiteElo(2000)}>Set White 2000</button>
      <button type="button" onClick={() => setMaia3BlackElo(2400)}>Set Black 2400</button>
    </div>
  ),
}));
vi.mock("../components/MoveNavigator", () => ({
  MoveNavigator: ({ onFlip }: { onFlip: () => void }) => (
    <button type="button" onClick={onFlip}>Flip board</button>
  ),
}));
vi.mock("../components/PgnViewer", () => ({ PgnViewer: () => null }));
vi.mock("../components/PositionInfoPanel", () => ({ PositionInfoPanel: () => null }));
vi.mock("../components/SavedGameLibraryOverlay", () => ({
  SavedGameLibraryOverlay: ({
    refreshToken,
    onOpenGame,
  }: {
    refreshToken: number;
    onOpenGame: (game: StoredGameSummary) => void;
  }) => {
    harness.onOpenSavedGame = onOpenGame;
    return <output data-testid="library-refresh-token">{refreshToken}</output>;
  },
}));
vi.mock("../components/mistakes/MistakeCapturePanel", () => ({ MistakeCapturePanel: () => null }));
vi.mock("../components/mistakes/MistakeLibraryWorkspace", () => ({
  MistakeLibraryWorkspace: () => <div data-testid="mistake-library-secondary-board">Secondary chessboard</div>,
}));

class TestResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

describe("AnalyzerPage evaluation bar integration", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    harness.game = makeGameState(null);
    harness.exploration = makeExplorationState();
    harness.varEvalCache = new Map();
    harness.varEvalLoading = null;
    harness.setVariationState = null;
    harness.onImportedGame = null;
    harness.activateImportedGame = null;
    harness.onOpenSavedGame = null;
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("uses 2600/2600 for a newly imported first game instead of carrying prior selections", () => {
    render(<AnalyzerPage />);
    act(() => harness.activateImportedGame?.(importedGameResponse()));
    expect(screen.getByTestId("white-maia3-elo")).toHaveTextContent("2600");
    expect(screen.getByTestId("black-maia3-elo")).toHaveTextContent("2600");

    fireEvent.click(screen.getByRole("button", { name: "Set White 2000" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Black 2400" }));
    expect(screen.getByTestId("white-maia3-elo")).toHaveTextContent("2000");
    expect(screen.getByTestId("black-maia3-elo")).toHaveTextContent("2400");

    act(() => harness.activateImportedGame?.({ ...importedGameResponse(), game_id: "game-2" }));
    expect(screen.getByTestId("white-maia3-elo")).toHaveTextContent("2600");
    expect(screen.getByTestId("black-maia3-elo")).toHaveTextContent("2600");
  });

  it("uses 2600/2600 when an unanalyzed trailing import is opened from the library", async () => {
    pageApi.openStoredGame.mockResolvedValue(logicalGame(null));
    render(<AnalyzerPage />);
    act(() => harness.activateImportedGame?.(importedGameResponse()));
    fireEvent.click(screen.getByRole("button", { name: "Set White 2000" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Black 2400" }));

    act(() => harness.onOpenSavedGame?.(storedGameSummary(0)));
    await waitFor(() => {
      expect(screen.getByTestId("white-maia3-elo")).toHaveTextContent("2600");
      expect(screen.getByTestId("black-maia3-elo")).toHaveTextContent("2600");
    });
  });

  it("preserves explicit Maia3 ratings when a saved analysis is opened", async () => {
    pageApi.openStoredGame.mockResolvedValue(logicalGame(storedAnalysis(2200, 2400)));
    render(<AnalyzerPage />);

    act(() => harness.onOpenSavedGame?.(storedGameSummary(1)));
    await waitFor(() => {
      expect(screen.getByTestId("white-maia3-elo")).toHaveTextContent("2200");
      expect(screen.getByTestId("black-maia3-elo")).toHaveTextContent("2400");
    });
  });

  it("refreshes the saved-game library once per persisted import batch", () => {
    render(<AnalyzerPage />);
    expect(screen.getByTestId("library-refresh-token")).toHaveTextContent("0");

    const imported: PgnUploadResponse = {
      pgn: '[Event "Batch"]\n\n1. e4 *',
      num_games: 4,
      num_unique_games: 3,
      num_games_added: 2,
      num_games_existing: 1,
      num_duplicate_games: 1,
      num_games_saved: 3,
      num_variations: 0,
      max_depth: 1,
      game_id: "game-1",
      fingerprint_version: 1,
      game_fingerprint: "fingerprint-1",
      preferred_analysis_run_id: null,
      analysis_history: [],
      persistence_warning: null,
      metadata: { Event: "Batch", White: "White", Black: "Black" },
      metadata_sources: { Event: "imported", White: "imported", Black: "imported" },
      metadata_missing: [],
    };
    act(() => harness.onImportedGame?.(imported));
    expect(screen.getByTestId("library-refresh-token")).toHaveTextContent("1");

    act(() => harness.onImportedGame?.({
      ...imported,
      game_id: null,
      num_games_added: 0,
      num_games_existing: 0,
      num_games_saved: 0,
      persistence_warning: "Database unavailable",
    }));
    expect(screen.getByTestId("library-refresh-token")).toHaveTextContent("1");
  });

  it("stays hidden before and during analysis, appears for completed/restored data, and is absent in the Mistake Library", () => {
    const { rerender } = render(<AnalyzerPage />);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();

    harness.game = makeGameState(makeResult());
    harness.game.isAnalyzing = true;
    rerender(<AnalyzerPage />);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();

    harness.game.isAnalyzing = false;
    rerender(<AnalyzerPage />);
    expect(screen.getByRole("meter", { name: /white advantage 0\.25 pawns/i })).toBeInTheDocument();

    harness.game.result = { ...makeResult(), analysis_run_id: "restored-game" };
    rerender(<AnalyzerPage />);
    expect(screen.getByRole("meter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mistake Library" }));
    expect(screen.getByTestId("mistake-library-secondary-board")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("updates with mainline resulting-position evaluations and reorders segments on board flip", () => {
    harness.game = makeGameState(makeResult());
    const { rerender } = render(<AnalyzerPage />);

    let meter = screen.getByRole("meter");
    expect(screen.queryByText("+0.25")).not.toBeInTheDocument();
    expectHoverTooltip(meter, "+0.25");
    harness.game.selectedMoveIndex = 1;
    rerender(<AnalyzerPage />);
    meter = screen.getByRole("meter");
    expectHoverTooltip(meter, "-1.75");

    expect(segmentOrder(meter)).toEqual(["black", "white"]);
    expect(meter.previousElementSibling).toHaveClass("main-board-stage__board");
    expect(meter.parentElement).toHaveClass("main-board-stage");
    expect(meter).not.toHaveAttribute("tabindex");
    fireEvent.click(screen.getByRole("button", { name: "Flip board" }));
    meter = screen.getByRole("meter");
    expect(segmentOrder(meter)).toEqual(["white", "black"]);
    expect(screen.getByTestId("main-chessboard")).toHaveAttribute("data-orientation", "black");
    expect(meter).toHaveAccessibleName(/black advantage 1\.75 pawns/i);
  });

  it("prefers the displayed exploration evaluation, shows pending, and hides missing idle data", () => {
    harness.game = makeGameState(makeResult());
    harness.exploration = makeExplorationState({
      isExploring: true,
      currentExplorationIndex: 0,
      exploredMoves: [exploredMove(positionEvaluation(2.4))],
    });
    const { rerender } = render(<AnalyzerPage />);

    let meter = screen.getByRole("meter", { name: /white advantage 2\.40 pawns/i });
    expectHoverTooltip(meter, "+2.40");
    expect(screen.queryByText("+0.25")).not.toBeInTheDocument();

    harness.exploration.exploredMoves = [exploredMove(null)];
    harness.exploration.isEvaluating = true;
    rerender(<AnalyzerPage />);
    meter = screen.getByRole("meter", { name: /evaluation pending/i });
    expect(meter).toHaveAttribute("data-status", "pending");
    expectHoverTooltip(meter, "pending");
    expect(screen.queryByText("+2.40")).not.toBeInTheDocument();

    harness.exploration.isEvaluating = false;
    rerender(<AnalyzerPage />);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable|n\/a/i)).not.toBeInTheDocument();
  });

  it("uses the current variation FEN cache and gives exploration precedence over variation", () => {
    const result = makeResult();
    harness.game = makeGameState(result);
    const variationFen = bestLineFens(result.moves[0].fen, result.moves[0].best_line)[0];
    expect(variationFen).toBeDefined();
    harness.varEvalLoading = variationFen ?? null;
    const { rerender } = render(<AnalyzerPage />);

    act(() => {
      harness.setVariationState?.({ moveIndex: 0, varIndex: 0 });
    });
    let meter = screen.getByRole("meter", { name: /evaluation pending/i });
    expectHoverTooltip(meter, "pending");
    expect(screen.queryByText("+0.25")).not.toBeInTheDocument();

    if (variationFen) {
      harness.varEvalCache.set(variationFen, positionEvaluation(-3.2));
    }
    harness.varEvalLoading = null;
    rerender(<AnalyzerPage />);
    meter = screen.getByRole("meter", { name: /black advantage 3\.20 pawns/i });
    expectHoverTooltip(meter, "-3.20");

    harness.exploration = makeExplorationState({
      isExploring: true,
      currentExplorationIndex: 0,
      exploredMoves: [exploredMove(positionEvaluation(1.1))],
    });
    rerender(<AnalyzerPage />);
    meter = screen.getByRole("meter", { name: /white advantage 1\.10 pawns/i });
    expectHoverTooltip(meter, "+1.10");
    expect(screen.queryByText("-3.20")).not.toBeInTheDocument();
  });
});

function importedGameResponse(): PgnUploadResponse {
  return {
    pgn: '[Event "Batch"]\n\n1. e4 *',
    num_games: 3,
    num_unique_games: 3,
    num_games_added: 3,
    num_games_existing: 0,
    num_duplicate_games: 0,
    num_games_saved: 3,
    num_variations: 0,
    max_depth: 1,
    game_id: "game-1",
    fingerprint_version: 1,
    game_fingerprint: "fingerprint-1",
    preferred_analysis_run_id: null,
    analysis_history: [],
    persistence_warning: null,
    metadata: { Event: "Batch", White: "White", Black: "Black" },
    metadata_sources: { Event: "imported", White: "imported", Black: "imported" },
    metadata_missing: [],
  };
}

function storedGameSummary(analysisCount: number): StoredGameSummary {
  return {
    id: "game-1",
    headers: { Event: "Batch", White: "White", Black: "Black" },
    metadata: { Event: "Batch", White: "White", Black: "Black" },
    metadata_sources: { Event: "imported", White: "imported", Black: "imported" },
    metadata_missing: [],
    metadata_updated_at: "2026-07-19T12:00:00Z",
    source_headers: { Event: "Batch", White: "White", Black: "Black" },
    imported_metadata: { Event: "Batch", White: "White", Black: "Black" },
    metadata_overrides: {},
    created_at: "2026-07-19T12:00:00Z",
    updated_at: "2026-07-19T12:00:00Z",
    mistake_count: 0,
    move_count: 1,
    analysis_count: analysisCount,
    preferred_analysis_run_id: analysisCount ? "run-1" : null,
    last_opened_at: "2026-07-19T12:00:00Z",
    result: "*",
  };
}

function storedAnalysis(whiteElo: number, blackElo: number): StoredGame {
  return {
    id: "run-1",
    game_id: "game-1",
    analysis_fingerprint: "analysis-1",
    cacheable: true,
    normalized_pgn: '[Event "Batch"]\n\n1. e4 *',
    headers: { Event: "Batch", White: "White", Black: "Black" },
    request: {
      pgn: '[Event "Batch"]\n\n1. e4 *',
      game_id: "game-1",
      acceptable_drop: 0.5,
      minefield_threshold: 0.8,
      engine_depth: 12,
      blunder_threshold: 1,
      mbi_trap_threshold: 0.4,
      mbi_outlier_threshold: 0.05,
      eig_threshold: 2,
      bri_threshold: 0.05,
      maia3_white_elo: whiteElo,
      maia3_black_elo: blackElo,
    },
    engine: {},
    maia: {},
    metric_schema_version: 2,
    result: makeResult(),
    created_at: "2026-07-19T12:00:00Z",
    updated_at: "2026-07-19T12:00:00Z",
  };
}

function logicalGame(analysis: StoredGame | null): LogicalStoredGame {
  return {
    id: "game-1",
    fingerprint_version: 1,
    game_fingerprint: "fingerprint-1",
    canonical_initial_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    mainline_uci: ["e2e4"],
    normalized_pgn: '[Event "Batch"]\n\n1. e4 *',
    headers: { Event: "Batch", White: "White", Black: "Black" },
    move_count: 1,
    created_at: "2026-07-19T12:00:00Z",
    updated_at: "2026-07-19T12:00:00Z",
    last_opened_at: "2026-07-19T12:00:00Z",
    analysis_history: [],
    preferred_analysis_run_id: analysis?.id ?? null,
    analysis,
    metadata: { Event: "Batch", White: "White", Black: "Black" },
    metadata_sources: { Event: "imported", White: "imported", Black: "imported" },
    metadata_missing: [],
    metadata_updated_at: "2026-07-19T12:00:00Z",
    source_headers: { Event: "Batch", White: "White", Black: "Black" },
    imported_metadata: { Event: "Batch", White: "White", Black: "Black" },
    metadata_overrides: {},
  };
}

function makeGameState(result: AnalyzeResult | null): HarnessGameState {
  return {
    isAnalyzing: false,
    movesAnalyzed: result?.moves.length ?? 0,
    totalMoves: result?.moves.length ?? 0,
    minefieldsFound: 0,
    result,
    selectedMoveIndex: result?.moves.length ? 0 : null,
    error: null,
    analysisMaia3WhiteElo: null,
    analysisMaia3BlackElo: null,
    startAnalysis: vi.fn(),
    cancelAnalysis: vi.fn(),
    clearAnalysis: vi.fn(),
    selectMove: vi.fn((index: number) => {
      harness.game.selectedMoveIndex = index;
    }),
    restoreAnalysis: vi.fn(),
  };
}

function makeExplorationState(
  overrides: Partial<HarnessExplorationState> = {},
): HarnessExplorationState {
  return {
    isExploring: false,
    branchPointIndex: -1,
    exploredMoves: [],
    currentExplorationIndex: -1,
    isEvaluating: false,
    activeSavedIndex: -1,
    savedExplorations: [],
    startNewExploration: vi.fn(),
    addExploredMove: vi.fn(),
    navigateExploration: vi.fn(),
    exitExploration: vi.fn(),
    enterSavedExploration: vi.fn(),
    clearExplorations: vi.fn(),
    ...overrides,
  };
}

function makeResult(): AnalyzeResult {
  return {
    moves: [analysisMove(0.25, null), analysisMove(-1.75, null, ["d4"])],
    minefields: [],
  };
}

function analysisMove(
  evalAfter: number,
  mateIn: number | null,
  bestLine: string[] = ["e4"],
): AnalysisMoveResult {
  return {
    move_number: 1,
    side: "white",
    move: "e4",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    stockfish_eval: 0,
    eval_after: evalAfter,
    cti: null,
    best_move: "e4",
    good_moves: ["e4"],
    good_moves_with_eval: { e4: 0 },
    is_minefield: false,
    mbi_classification: null,
    mbi_maia_prob: null,
    eig_value: null,
    is_eig_flagged: false,
    is_brilliant: false,
    bri_maia_prob: null,
    epe_score: null,
    best_line: bestLine,
    best_line_evals: {},
    mate_in: mateIn,
  };
}

function positionEvaluation(evaluation: number): PositionEvalResult {
  return {
    eval: evaluation,
    best_move: "e4",
    good_moves: ["e4"],
    good_moves_with_eval: { e4: 0 },
    cti: null,
    mate_in: null,
  };
}

function exploredMove(evalResult: PositionEvalResult | null) {
  return {
    san: "e4",
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    side: "white" as const,
    moveNumber: 1,
    evalResult,
  };
}

function segmentOrder(meter: HTMLElement): string[] {
  return Array.from(meter.querySelectorAll<HTMLElement>(".position-evaluation-bar__segment")).map(
    (segment) => segment.dataset.side ?? "",
  );
}

function expectHoverTooltip(meter: HTMLElement, value: string): void {
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(meter);
  expect(screen.getByRole("tooltip")).toHaveTextContent(value);
  fireEvent.mouseLeave(meter);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
}
