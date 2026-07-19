import { useState, type CSSProperties } from "react";

import { pawnScoreToWhiteShare } from "../utils/evaluationBar";

export type EvaluationBarStatus = "available" | "pending";

export interface PositionEvaluationBarProps {
  evaluation: number | null;
  mateIn: number | null;
  orientation: "white" | "black";
  status?: EvaluationBarStatus;
}

type Side = "white" | "black";

interface EvaluationBarPresentation {
  accessibleLabel: string;
  effectiveStatus: EvaluationBarStatus;
  tooltipText: string;
  whiteShare: number;
}

export function PositionEvaluationBar({
  evaluation,
  mateIn,
  orientation,
  status = "available",
}: PositionEvaluationBarProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const presentation = getPresentation(evaluation, mateIn, status);
  if (presentation === null) {
    return null;
  }

  const blackShare = 100 - presentation.whiteShare;
  const topSide: Side = orientation === "white" ? "black" : "white";
  const orderedSides: Side[] = topSide === "black" ? ["black", "white"] : ["white", "black"];
  const topShare = topSide === "white" ? presentation.whiteShare : blackShare;
  const tooltipPosition = Math.min(96, Math.max(4, topShare));
  const tooltipStyle = { "--tooltip-position": `${tooltipPosition}%` } as CSSProperties;

  const meterProps =
    presentation.effectiveStatus === "available"
      ? {
          "aria-valuemax": 100,
          "aria-valuemin": 0,
          "aria-valuenow": Number(presentation.whiteShare.toFixed(2)),
        }
      : {};

  return (
    <div
      className="position-evaluation-bar"
      role="meter"
      aria-label={presentation.accessibleLabel}
      aria-busy={presentation.effectiveStatus === "pending" || undefined}
      data-orientation={orientation}
      data-status={presentation.effectiveStatus}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      {...meterProps}
    >
      <div className="position-evaluation-bar__track" aria-hidden="true">
        {orderedSides.map((side) => {
          const share = side === "white" ? presentation.whiteShare : blackShare;
          const style = { "--segment-share": `${share}%` } as CSSProperties;

          return (
            <div
              key={side}
              className="position-evaluation-bar__segment"
              data-side={side}
              data-share={share.toFixed(4)}
              style={style}
            />
          );
        })}
      </div>
      {tooltipVisible && (
        <span
          className="position-evaluation-bar__tooltip"
          role="tooltip"
          style={tooltipStyle}
        >
          {presentation.tooltipText}
        </span>
      )}
    </div>
  );
}

function getPresentation(
  evaluation: number | null,
  mateIn: number | null,
  status: EvaluationBarStatus,
): EvaluationBarPresentation | null {
  if (status === "pending") {
    return {
      accessibleLabel: "Position evaluation pending",
      effectiveStatus: "pending",
      tooltipText: "pending",
      whiteShare: 50,
    };
  }

  if (mateIn !== null) {
    if (!Number.isFinite(mateIn)) {
      return null;
    }

    const winner = mateWinner(mateIn, evaluation);
    if (winner === null) {
      return null;
    }

    const isTerminal = mateIn === 0;
    const terminalResult = winner === "white" ? "1-0" : "0-1";
    return {
      accessibleLabel: isTerminal
        ? `Position evaluation: ${capitalize(winner)} wins, ${terminalResult}`
        : `Position evaluation: ${capitalize(winner)} mate in ${Math.abs(mateIn)}`,
      effectiveStatus: "available",
      tooltipText: isTerminal ? terminalResult : `#${mateIn}`,
      whiteShare: winner === "white" ? 100 : 0,
    };
  }

  if (evaluation === null || !Number.isFinite(evaluation)) {
    return null;
  }

  const normalizedEvaluation = Object.is(evaluation, -0) ? 0 : evaluation;
  const pawnAmount = Math.abs(normalizedEvaluation).toFixed(2);
  const pawnUnit = pawnAmount === "1.00" ? "pawn" : "pawns";

  if (normalizedEvaluation === 0) {
    return {
      accessibleLabel: "Position evaluation: Equal position",
      effectiveStatus: "available",
      tooltipText: formatSignedPawnScore(normalizedEvaluation),
      whiteShare: 50,
    };
  }

  const labelSide: Side = normalizedEvaluation > 0 ? "white" : "black";

  return {
    accessibleLabel: `Position evaluation: ${capitalize(labelSide)} advantage ${pawnAmount} ${pawnUnit}`,
    effectiveStatus: "available",
    tooltipText: formatSignedPawnScore(normalizedEvaluation),
    whiteShare: pawnScoreToWhiteShare(normalizedEvaluation),
  };
}

function mateWinner(mateIn: number, evaluation: number | null): Side | null {
  if (mateIn > 0) {
    return "white";
  }
  if (mateIn < 0) {
    return "black";
  }
  if (evaluation !== null && Number.isFinite(evaluation) && evaluation !== 0) {
    return evaluation > 0 ? "white" : "black";
  }
  return null;
}

function formatSignedPawnScore(evaluation: number): string {
  if (evaluation > 0) {
    return `+${evaluation.toFixed(2)}`;
  }
  if (evaluation < 0) {
    return `-${Math.abs(evaluation).toFixed(2)}`;
  }
  return "0.00";
}

function capitalize(side: Side): "White" | "Black" {
  return side === "white" ? "White" : "Black";
}
