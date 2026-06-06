import { useEffect, useRef, type RefObject } from "react";

export interface ParsedMove {
  index: number;
  moveNumber: number;
  side: "white" | "black";
  san: string;
  fen: string;
}

export interface VariationData {
  line: string[];
  fens: string[];
}

export interface ExploredVariationData {
  branchPointIndex: number;
  moves: Array<{ san: string; fen: string; side?: "white" | "black"; moveNumber?: number }>;
}

interface PgnViewerProps {
  moves?: ParsedMove[];
  activeMoveIndex: number | null;
  onMoveClick: (index: number) => void;
  className?: string;
  variations?: Array<VariationData | null>;
  activeVariation?: { moveIndex: number; varIndex: number } | null;
  onVariationClick?: (moveIndex: number, varIndex: number) => void;
  exploredVariations?: ExploredVariationData[];
  activeExploration?: { explorationIndex: number; moveIndex: number } | null;
  onExplorationClick?: (explorationIndex: number, moveIndex: number) => void;
}

export function PgnViewer({
  moves,
  activeMoveIndex,
  onMoveClick,
  className,
  variations,
  activeVariation,
  onVariationClick,
  exploredVariations,
  activeExploration,
  onExplorationClick,
}: PgnViewerProps) {
  const activeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeMoveIndex, activeVariation, activeExploration]);

  if (!moves?.length) {
    return null;
  }

  return (
    <div className={className ?? "panel panel-radius panel-pad max-h-48 overflow-y-auto"}>
      <div className="pgn-flow mono">
        {moves.map((move) => {
          const variation = variations?.[move.index] ?? null;
          const isActiveVar = activeVariation?.moveIndex === move.index;
          const branchExplorations = (exploredVariations ?? [])
            .map((ev, idx) => ({ ev, idx }))
            .filter(({ ev }) => ev.branchPointIndex === move.index && ev.moves.length > 0);
          const variationMerged =
            variation && branchExplorations.some(({ ev }) => ev.moves[0]?.san === variation.line[0]);
          const showVariation = Boolean(variation && !variationMerged);

          return (
            <span key={move.index} className="pgn-move-unit">
              {move.side === "white" && <span className="move-number">{move.moveNumber}.</span>}
              <span
                ref={
                  move.index === activeMoveIndex && !activeVariation && activeExploration == null
                    ? activeRef
                    : undefined
                }
                onClick={() => onMoveClick(move.index)}
                className="pgn-move"
                data-active={move.index === activeMoveIndex && !activeVariation && activeExploration == null}
              >
                {move.san}
              </span>

              {showVariation && variation && (
                <span className="variation-group">
                  (
                  {variation.line.map((san, vi) => {
                    const isFirst = vi === 0;
                    const varSide: "white" | "black" =
                      move.side === "white"
                        ? vi % 2 === 0
                          ? "white"
                          : "black"
                        : vi % 2 === 0
                          ? "black"
                          : "white";
                    const showNumber = isFirst || varSide === "white";
                    const actualMoveNum =
                      move.side === "white"
                        ? move.moveNumber + Math.floor(vi / 2)
                        : move.moveNumber + Math.floor((vi + 1) / 2);

                    return (
                      <span key={vi}>
                        {showNumber && (
                          <span className="move-number">
                            {actualMoveNum}
                            {isFirst && varSide === "black" ? "..." : "."}
                          </span>
                        )}
                        <span
                          ref={isActiveVar && activeVariation?.varIndex === vi ? activeRef : undefined}
                          onClick={() => onVariationClick?.(move.index, vi)}
                          className="variation-move"
                          data-active={isActiveVar && activeVariation?.varIndex === vi}
                        >
                          {san}
                        </span>
                        {vi < variation.line.length - 1 && " "}
                      </span>
                    );
                  })}
                  )
                </span>
              )}

              {renderExplorationGroups(
                branchExplorations,
                move,
                activeExploration,
                activeRef,
                onExplorationClick,
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function renderExplorationGroups(
  branchExplorations: Array<{ ev: ExploredVariationData; idx: number }>,
  move: ParsedMove,
  activeExploration: { explorationIndex: number; moveIndex: number } | null | undefined,
  activeRef: RefObject<HTMLSpanElement | null>,
  onExplorationClick?: (explorationIndex: number, moveIndex: number) => void,
) {
  if (!branchExplorations.length) {
    return null;
  }

  const groups = new Map<string, Array<{ ev: ExploredVariationData; idx: number }>>();
  for (const item of branchExplorations) {
    const key = item.ev.moves[0]?.san ?? "";
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const firstMove = group[0].ev.moves[0];
    const fallback = firstMove ? inferMoveNotationFromPostFen(firstMove.fen, move) : {
      side: move.side,
      moveNumber: move.moveNumber,
    };

    const getExpSide = (ei: number) =>
      group[0].ev.moves[ei]?.side ??
      (fallback.side === "white" ? (ei % 2 === 0 ? "white" : "black") : ei % 2 === 0 ? "black" : "white");
    const getExpMoveNum = (ei: number) =>
      group[0].ev.moves[ei]?.moveNumber ??
      (fallback.side === "white"
        ? fallback.moveNumber + Math.floor(ei / 2)
        : fallback.moveNumber + Math.floor((ei + 1) / 2));

    let prefixLen = group[0].ev.moves.length;
    for (let g = 1; g < group.length; g += 1) {
      const line = group[g].ev.moves;
      prefixLen = Math.min(prefixLen, line.length);
      for (let k = 0; k < prefixLen; k += 1) {
        if (line[k].san !== group[0].ev.moves[k].san) {
          prefixLen = k;
          break;
        }
      }
    }

    const tails = group.map(({ ev, idx }) => ({ moves: ev.moves.slice(prefixLen), expIdx: idx }));
    const hasTails = tails.some((t) => t.moves.length > 0);
    const primaryExpIdx = group[0].idx;
    const activeGroupItem = group.find(({ idx }) => activeExploration?.explorationIndex === idx);

    return (
      <span
        key={`exp-group-${group.map((g) => g.idx).join("_")}`}
        className="exploration-group"
      >
        (
        {group[0].ev.moves.slice(0, prefixLen).map((expMove, ei) => {
          const expSide = getExpSide(ei);
          const showNumber = ei === 0 || expSide === "white";
          const actualMoveNum = getExpMoveNum(ei);
          const isThisActive =
            activeGroupItem != null && activeExploration?.moveIndex === ei && activeExploration.explorationIndex === activeGroupItem.idx;

          return (
            <span key={ei}>
              {showNumber && (
                <span className="move-number">
                  {actualMoveNum}
                  {ei === 0 && expSide === "black" ? "..." : "."}
                </span>
              )}
              <span
                ref={isThisActive ? activeRef : undefined}
                onClick={() => onExplorationClick?.(activeGroupItem?.idx ?? primaryExpIdx, ei)}
                className="exploration-move"
                data-active={isThisActive}
              >
                {expMove.san}
              </span>
              {(ei < prefixLen - 1 || hasTails) && " "}
            </span>
          );
        })}
        {hasTails &&
          tails.map((tail, ti) => {
            if (!tail.moves.length) {
              return null;
            }

            return (
              <span key={`tail-${tail.expIdx}`}>
                {ti > 0 && ", "}
                {tail.moves.map((tailMove, tmi) => {
                  const globalMoveIdx = prefixLen + tmi;
                  const expSide = getExpSide(globalMoveIdx);
                  const showNumber = tmi === 0 || expSide === "white";
                  const actualMoveNum = getExpMoveNum(globalMoveIdx);
                  const isThisActive =
                    activeExploration?.explorationIndex === tail.expIdx &&
                    activeExploration.moveIndex === globalMoveIdx;

                  return (
                    <span key={tmi}>
                      {showNumber && (
                        <span className="move-number">
                          {actualMoveNum}
                          {tmi === 0 && expSide === "black" ? "..." : "."}
                        </span>
                      )}
                      <span
                        ref={isThisActive ? activeRef : undefined}
                        onClick={() => onExplorationClick?.(tail.expIdx, globalMoveIdx)}
                        className="exploration-move"
                        data-active={isThisActive}
                      >
                        {tailMove.san}
                      </span>
                      {tmi < tail.moves.length - 1 && " "}
                    </span>
                  );
                })}
              </span>
            );
          })}
        )
      </span>
    );
  });
}

function inferMoveNotationFromPostFen(
  fen: string,
  fallbackMove: ParsedMove,
): { side: "white" | "black"; moveNumber: number } {
  const parts = fen.split(" ");
  const activeColor = parts[1] ?? "w";
  const side: "white" | "black" = activeColor === "w" ? "black" : "white";
  const fenFullmove = parseInt(parts[5] ?? String(fallbackMove.moveNumber), 10) || fallbackMove.moveNumber;
  const moveNumber = activeColor === "w" ? fenFullmove - 1 : fenFullmove;
  return { side, moveNumber };
}
