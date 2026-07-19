import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzeResult, AnalysisMoveResult, PositionEvalResult } from "../types";
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
}

interface TestHarness {
  game: HarnessGameState;
  exploration: HarnessExplorationState;
  varEvalCache: Map<string, PositionEvalResult>;
  varEvalLoading: string | null;
  setVariationState: ((state: VariationState) => void) | null;
}

const harness = vi.hoisted(() => ({
  game: null,
  exploration: null,
  varEvalCache: new Map(),
  varEvalLoading: null,
  setVariationState: null,
})) as unknown as TestHarness;

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
  useAnalyzerHandlers: (deps: { setVariationState: (state: VariationState) => void }) => {
    harness.setVariationState = deps.setVariationState;
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
vi.mock("../components/GameInfoPanel", () => ({ GameInfoPanel: () => null }));
vi.mock("../components/MoveNavigator", () => ({
  MoveNavigator: ({ onFlip }: { onFlip: () => void }) => (
    <button type="button" onClick={onFlip}>Flip board</button>
  ),
}));
vi.mock("../components/PgnViewer", () => ({ PgnViewer: () => null }));
vi.mock("../components/PositionInfoPanel", () => ({ PositionInfoPanel: () => null }));
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
    window.localStorage.clear();
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
