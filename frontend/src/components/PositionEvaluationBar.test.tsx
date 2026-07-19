import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { pawnScoreToWhiteShare } from "../utils/evaluationBar";
import { PositionEvaluationBar } from "./PositionEvaluationBar";

describe("PositionEvaluationBar", () => {
  it("uses a fixed symmetric, monotonic, bounded pawn-score mapping", () => {
    expect(pawnScoreToWhiteShare(0)).toBe(50);
    expect(pawnScoreToWhiteShare(1)).toBeGreaterThan(50);
    expect(pawnScoreToWhiteShare(3)).toBeGreaterThan(pawnScoreToWhiteShare(1));
    expect(pawnScoreToWhiteShare(3) + pawnScoreToWhiteShare(-3)).toBeCloseTo(100, 10);
    expect(pawnScoreToWhiteShare(Number.MAX_VALUE)).toBe(100);
    expect(pawnScoreToWhiteShare(-Number.MAX_VALUE)).toBe(0);
  });

  it.each([
    {
      evaluation: 0,
      accessibleName: /equal position/i,
      notation: "0.00",
      whiteLarger: false,
      blackLarger: false,
    },
    {
      evaluation: 1.25,
      accessibleName: /white advantage 1\.25 pawns/i,
      notation: "+1.25",
      whiteLarger: true,
      blackLarger: false,
    },
    {
      evaluation: -2.5,
      accessibleName: /black advantage 2\.50 pawns/i,
      notation: "-2.50",
      whiteLarger: false,
      blackLarger: true,
    },
    {
      evaluation: 1_000,
      accessibleName: /white advantage 1000\.00 pawns/i,
      notation: "+1000.00",
      whiteLarger: true,
      blackLarger: false,
    },
  ])(
    "reveals the $notation pawn evaluation only on hover with complementary shares",
    ({ evaluation, accessibleName, notation, whiteLarger, blackLarger }) => {
      render(
        <PositionEvaluationBar
          evaluation={evaluation}
          mateIn={null}
          orientation="white"
        />,
      );

      const meter = screen.getByRole("meter", { name: accessibleName });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      expect(screen.queryByText(notation)).not.toBeInTheDocument();
      expectHoverTooltip(meter, notation);
      const whiteShare = segmentShare(meter, "white");
      const blackShare = segmentShare(meter, "black");
      expect(whiteShare + blackShare).toBeCloseTo(100, 4);
      expect(whiteShare > blackShare).toBe(whiteLarger);
      expect(blackShare > whiteShare).toBe(blackLarger);
    },
  );

  it("preserves signed mate notation and uses compact terminal results", () => {
    const { rerender } = render(
      <PositionEvaluationBar evaluation={100} mateIn={3} orientation="white" />,
    );

    let meter = screen.getByRole("meter", { name: /white mate in 3/i });
    expectHoverTooltip(meter, "#3");
    expect(segmentShare(meter, "white")).toBe(100);
    expect(segmentShare(meter, "black")).toBe(0);

    rerender(<PositionEvaluationBar evaluation={-100} mateIn={-2} orientation="white" />);
    meter = screen.getByRole("meter", { name: /black mate in 2/i });
    expectHoverTooltip(meter, "#-2");
    expect(segmentShare(meter, "white")).toBe(0);
    expect(segmentShare(meter, "black")).toBe(100);

    rerender(<PositionEvaluationBar evaluation={-100} mateIn={0} orientation="white" />);
    meter = screen.getByRole("meter", { name: /black wins, 0-1/i });
    expectHoverTooltip(meter, "0-1");
    expect(segmentShare(meter, "white")).toBe(0);
    expect(segmentShare(meter, "black")).toBe(100);

    rerender(<PositionEvaluationBar evaluation={100} mateIn={0} orientation="white" />);
    meter = screen.getByRole("meter", { name: /white wins, 1-0/i });
    expectHoverTooltip(meter, "1-0");
    expect(screen.queryByText(/checkmate|unavailable/i)).not.toBeInTheDocument();
  });

  it("uses a text-free striped pending state and no unavailable presentation", () => {
    const { rerender } = render(
      <PositionEvaluationBar
        evaluation={4.2}
        mateIn={null}
        orientation="white"
        status="pending"
      />,
    );

    const meter = screen.getByRole("meter", { name: /evaluation pending/i });
    expect(meter).toHaveAttribute("aria-busy", "true");
    expect(meter).toHaveAttribute("data-status", "pending");
    expect(meter).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
    expectHoverTooltip(meter, "pending");
    expect(segmentShare(meter, "white")).toBe(50);
    expect(segmentShare(meter, "black")).toBe(50);

    rerender(
      <PositionEvaluationBar
        evaluation={Number.POSITIVE_INFINITY}
        mateIn={null}
        orientation="white"
      />,
    );
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/n\/a|unavailable/i)).not.toBeInTheDocument();

    rerender(
      <PositionEvaluationBar
        evaluation={null}
        mateIn={null}
        orientation="white"
      />,
    );
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("keeps color identity stable while matching segment order to board orientation", () => {
    const { rerender } = render(
      <PositionEvaluationBar evaluation={0.5} mateIn={null} orientation="white" />,
    );

    let meter = screen.getByRole("meter");
    expect(segmentOrder(meter)).toEqual(["black", "white"]);
    expect(meter).not.toHaveAttribute("tabindex");

    rerender(<PositionEvaluationBar evaluation={0.5} mateIn={null} orientation="black" />);
    meter = screen.getByRole("meter");
    expect(segmentOrder(meter)).toEqual(["white", "black"]);
    expectHoverTooltip(meter, "+0.50");
    expect(meter).toHaveAccessibleName(/white advantage 0\.50 pawns/i);
  });
});

function expectHoverTooltip(meter: HTMLElement, value: string): void {
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(meter);
  expect(screen.getByRole("tooltip")).toHaveTextContent(value);
  fireEvent.mouseLeave(meter);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
}

function segmentShare(meter: HTMLElement, side: "white" | "black"): number {
  const segment = meter.querySelector<HTMLElement>(`[data-side="${side}"].position-evaluation-bar__segment`);
  return Number(segment?.dataset.share ?? Number.NaN);
}

function segmentOrder(meter: HTMLElement): string[] {
  return Array.from(meter.querySelectorAll<HTMLElement>(".position-evaluation-bar__segment")).map(
    (segment) => segment.dataset.side ?? "",
  );
}
