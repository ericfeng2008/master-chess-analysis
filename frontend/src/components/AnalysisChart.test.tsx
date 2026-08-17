import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisMoveResult } from "../types";
import { AnalysisChart } from "./AnalysisChart";
import { buildAnalysisChartData, type AnalysisMoveLike } from "./analysisChartData";

const chartHarness = vi.hoisted(() => ({
  areas: [] as Array<Record<string, unknown>>,
  lines: [] as Array<Record<string, unknown>>,
}));

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    Area: (props: Record<string, unknown>) => {
      chartHarness.areas.push(props);
      return null;
    },
    ComposedChart: Container,
    Line: (props: Record<string, unknown>) => {
      chartHarness.lines.push(props);
      return null;
    },
    ReferenceArea: Empty,
    ReferenceDot: Empty,
    ReferenceLine: Empty,
    ResponsiveContainer: Container,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

describe("AnalysisChart Stockfish series", () => {
  beforeEach(() => {
    chartHarness.areas.length = 0;
    chartHarness.lines.length = 0;
  });

  it("uses opaque semantic advantage fills and a separate evaluation-line color", () => {
    render(
      <AnalysisChart
        moves={[move(0.8), move(-1.25)]}
        minefields={[]}
        selectedIndex={0}
        onSelectMove={vi.fn()}
        perspective="white"
      />,
    );

    expect(chartHarness.areas.find((area) => area.dataKey === "evalPositive")).toMatchObject({
      fill: "var(--chart-eval-positive)",
      fillOpacity: 1,
      baseValue: 0,
    });
    expect(chartHarness.areas.find((area) => area.dataKey === "evalNegative")).toMatchObject({
      fill: "var(--chart-eval-negative)",
      fillOpacity: 1,
      baseValue: 0,
    });
    expect(chartHarness.lines.find((line) => line.dataKey === "stockfish_eval")).toMatchObject({
      stroke: "var(--chart-eval-line)",
    });
  });

  it("draws an explicit straight marker-free evaluation line for loaded analysis data", () => {
    render(
      <AnalysisChart
        moves={[move(0.8), move(-1.25)]}
        minefields={[]}
        selectedIndex={0}
        onSelectMove={vi.fn()}
        perspective="white"
      />,
    );

    const stockfishLine = chartHarness.lines.find((line) => line.dataKey === "stockfish_eval");
    expect(stockfishLine).toMatchObject({
      type: "linear",
      stroke: "var(--chart-eval-line)",
      strokeWidth: 1,
      dot: false,
      activeDot: false,
      connectNulls: false,
      isAnimationActive: false,
    });
  });

  it("normalizes fresh and restored finite evaluations identically and preserves invalid values as gaps", () => {
    const fresh = [move(0.8), { ...move(-8), epe_score: 43.43 }];
    const restored = JSON.parse(JSON.stringify(fresh)) as AnalysisMoveResult[];

    expect(buildAnalysisChartData(restored)).toEqual(buildAnalysisChartData(fresh));
    expect(buildAnalysisChartData(restored)[1]).toMatchObject({
      raw_eval: -8,
    });
    expect(buildAnalysisChartData(restored)[1]).not.toHaveProperty("raw_epe");

    const invalidRestored = [
      { ...move(0.8), eval_after: null },
      { ...move(-1.25), eval_after: Number.NaN },
    ] as unknown as AnalysisMoveLike[];
    expect(buildAnalysisChartData(invalidRestored).map((point) => point.stockfish_eval)).toEqual([null, null]);
    expect(buildAnalysisChartData(invalidRestored).map((point) => point.evalPositive)).toEqual([null, null]);
  });

  it("keeps timeline points when CTI is intentionally skipped", () => {
    const skipped = [
      { ...move(0.25), cti: null, cti_skip_reason: "initial_position" as const },
      { ...move(-0.4), side: "black", cti: null, cti_skip_reason: "side_not_selected" as const },
    ];

    expect(buildAnalysisChartData(skipped).map((point) => point.raw_eval)).toEqual([0.25, -0.4]);
    expect(buildAnalysisChartData(skipped).map((point) => [point.ctiWhite, point.ctiBlack])).toEqual([
      [null, null],
      [null, null],
    ]);
  });
});

function move(evalAfter: number): AnalysisMoveResult {
  return {
    move_number: 1,
    side: "white",
    move: "e4",
    fen: "start",
    stockfish_eval: 0,
    eval_after: evalAfter,
    cti: 0.2,
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
    best_line: [],
    best_line_evals: {},
    mate_in: null,
  };
}
