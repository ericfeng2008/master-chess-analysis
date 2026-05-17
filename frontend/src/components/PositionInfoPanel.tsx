import { Chess } from "chess.js";

type AnalysisMoveLike = {
  move_number: number;
  side: string;
  move: string;
  fen: string;
  stockfish_eval: number;
  eval_after: number;
  cti: number | null;
  best_move: string | null;
  good_moves: string[];
  good_moves_with_eval: Record<string, number>;
  is_minefield: boolean;
  mbi_classification: string | null;
  mbi_maia_prob: number | null;
  eig_value: number | null;
  is_eig_flagged: boolean;
  is_brilliant: boolean;
  bri_maia_prob: number | null;
  epe_score: number | null;
  best_line: string[];
  best_line_evals?: Record<string, PositionEvalResult>;
  mate_in: number | null;
};

type PositionEvalResult = {
  eval: number;
  best_move: string;
  good_moves: string[];
  good_moves_with_eval: Record<string, number>;
  cti: number | null;
  mate_in: number | null;
};

interface ExplorationMoveInfo {
  san: string;
  fen: string;
  evalResult: PositionEvalResult | null;
}

interface PositionInfoPanelProps {
  selectedMove: AnalysisMoveLike | null;
  exploration: {
    isExploring: boolean;
    currentExplorationIndex: number;
    exploredMoves: ExplorationMoveInfo[];
    isEvaluating: boolean;
    exitExploration: () => void;
  };
  variationState: { moveIndex: number; varIndex: number } | null;
  varEvalCache: Map<string, PositionEvalResult>;
  varEvalLoading: string | null;
  ctiResult: { moves: AnalysisMoveLike[] } | null;
}

export function PositionInfoPanel({
  selectedMove,
  exploration,
  variationState,
  varEvalCache,
  varEvalLoading,
  ctiResult,
}: PositionInfoPanelProps) {
  if (!selectedMove && !exploration.isExploring && !variationState) {
    return null;
  }

  return (
    <div className="shrink-0 rounded-lg border border-gray-700 p-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-400">Position Info</h3>
        {exploration.isExploring && (
          <div className="flex items-center gap-1">
            <button
              onClick={exploration.exitExploration}
              className="text-xs text-teal-400 hover:text-teal-300"
            >
              Exit
            </button>
          </div>
        )}
        {!exploration.isExploring && variationState && (
          <span className="rounded bg-green-800 px-2 py-0.5 text-xs font-medium text-green-200">
            Variation
          </span>
        )}
      </div>

      {exploration.isExploring ? (
        <ExplorationInfo exploration={exploration} />
      ) : variationState && ctiResult ? (
        <VariationInfo
          variationState={variationState}
          ctiResult={ctiResult}
          varEvalCache={varEvalCache}
          varEvalLoading={varEvalLoading}
        />
      ) : selectedMove ? (
        <MainlineInfo selectedMove={selectedMove} />
      ) : null}
    </div>
  );
}

function fenToMovePrefix(fen: string) {
  const p = fen.split(" ");
  const activeColor = p[1];
  const fullmove = parseInt(p[5] ?? "1", 10);
  const side = activeColor === "w" ? "black" : "white";
  const num = activeColor === "w" ? fullmove - 1 : fullmove;
  return { prefix: `${num}${side === "white" ? "." : "..."}`, side };
}

function EvalDisplay({ ev }: { ev: PositionEvalResult }) {
  return <span className="text-blue-400">{ev.mate_in !== null ? `#${ev.mate_in}` : ev.eval.toFixed(2)}</span>;
}

function GoodMoves({ ev }: { ev: PositionEvalResult }) {
  const others = (ev.good_moves ?? []).filter((m) => m !== ev.best_move);
  if (others.length === 0) {
    return null;
  }

  return (
    <div className="col-span-2">
      <span className="text-gray-500">Good moves: </span>
      <span className="font-mono">
        {others
          .map((m) => {
            const d = ev.good_moves_with_eval[m];
            return d != null ? `${m}(${d >= 0 ? "+" : ""}${d.toFixed(2)})` : m;
          })
          .join(", ")}
      </span>
    </div>
  );
}

function ExplorationInfo({ exploration }: { exploration: PositionInfoPanelProps["exploration"] }) {
  const expMove = exploration.exploredMoves[exploration.currentExplorationIndex];
  const ev = expMove?.evalResult;

  if (!ev) {
    if (exploration.isEvaluating) {
      return <div className="animate-pulse text-sm text-teal-400">Evaluating...</div>;
    }
    return <div className="text-sm text-gray-500">No evaluation data</div>;
  }

  const { prefix } = fenToMovePrefix(expMove.fen);

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm">
      <div>
        <span className="text-gray-500">Move:</span> <span className="font-mono text-teal-300">{prefix} {expMove.san}</span>
      </div>
      <div>
        <span className="text-gray-500">Eval:</span> <EvalDisplay ev={ev} />
      </div>
      {ev.best_move && (
        <div className="col-span-2">
          <span className="text-gray-500">Best move:</span> <span className="font-mono">{prefix} {ev.best_move}</span>
        </div>
      )}
      <GoodMoves ev={ev} />
      {ev.cti != null && (
        <div className="col-span-2">
          <span className="text-gray-500">CTI:</span> <span className="text-teal-400">{ev.cti.toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}

function VariationInfo({
  variationState,
  ctiResult,
  varEvalCache,
  varEvalLoading,
}: {
  variationState: { moveIndex: number; varIndex: number };
  ctiResult: { moves: AnalysisMoveLike[] };
  varEvalCache: Map<string, PositionEvalResult>;
  varEvalLoading: string | null;
}) {
  const am = ctiResult.moves[variationState.moveIndex];
  if (!am) {
    return null;
  }

  const san = am.best_line[variationState.varIndex];
  const varFens = buildBestLineFens(am.fen, am.best_line);
  const fenAfter = varFens[variationState.varIndex];
  if (!san || !fenAfter) {
    return null;
  }

  const { prefix } = fenToMovePrefix(fenAfter);
  const ev = varEvalCache.get(fenAfter);

  if (!ev) {
    if (varEvalLoading === fenAfter) {
      return <div className="animate-pulse text-sm text-green-400">Evaluating...</div>;
    }
    return (
      <div className="text-sm text-gray-500">
        <span className="text-gray-500">Move:</span> <span className="font-mono text-green-300">{prefix} {san}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm">
      <div>
        <span className="text-gray-500">Move:</span> <span className="font-mono text-green-300">{prefix} {san}</span>
      </div>
      <div>
        <span className="text-gray-500">Eval:</span> <EvalDisplay ev={ev} />
      </div>
      {ev.best_move && (
        <div className="col-span-2">
          <span className="text-gray-500">Best move:</span> <span className="font-mono">{prefix} {ev.best_move}</span>
        </div>
      )}
      <GoodMoves ev={ev} />
    </div>
  );
}

function MainlineInfo({ selectedMove: s }: { selectedMove: AnalysisMoveLike }) {
  const mPrefix = `${s.move_number}${s.side === "white" ? "." : "..."}`;
  const goodOthers = s.good_moves.filter((m) => m !== s.best_move);

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm">
      <div>
        <span className="text-gray-500">Move:</span> <span className="font-mono">{mPrefix} {s.move}</span>
      </div>
      <div>
        <span className="text-gray-500">Side:</span> {s.side}
      </div>
      <div>
        <span className="text-gray-500">Eval:</span>{" "}
        <span className="text-blue-400">{s.mate_in !== null ? `#${s.mate_in}` : s.eval_after.toFixed(2)}</span>
      </div>
      <div>
        <span className="text-gray-500">CTI:</span>{" "}
        <span style={{ color: s.side === "white" ? "#22c55e" : "#f97316" }}>
          {s.cti !== null ? s.cti.toFixed(4) : "N/A"}
        </span>
      </div>
      <div>
        <span className="text-gray-500">Minefield:</span>{" "}
        {s.is_minefield ? (
          <span className="font-semibold text-amber-400">Yes</span>
        ) : (
          <span className="text-gray-400">No</span>
        )}
      </div>
      {s.best_move && (
        <div className="col-span-2">
          <span className="text-gray-500">Best move:</span> <span className="font-mono">{s.best_move}</span>
        </div>
      )}
      {s.best_move && goodOthers.length > 0 && (
        <div className="col-span-2">
          <span className="text-gray-500">Good moves:</span>{" "}
          <span className="font-mono">
            {goodOthers
              .map((m) => {
                const d = s.good_moves_with_eval[m];
                return d != null ? `${m}(${d >= 0 ? "+" : ""}${d.toFixed(2)})` : m;
              })
              .join(", ")}
          </span>
        </div>
      )}
      {s.mbi_classification && (
        <div className="col-span-2">
          <span className="text-gray-500">MBI:</span>{" "}
          <span
            className={
              s.mbi_classification === "cognitive_trap"
                ? "font-semibold text-fuchsia-400"
                : s.mbi_classification === "random_oversight"
                  ? "font-semibold text-red-400"
                  : "text-gray-300"
            }
          >
            {s.mbi_classification === "cognitive_trap"
              ? "Cognitive Trap"
              : s.mbi_classification === "random_oversight"
                ? "Random Oversight"
                : "Unclassified Blunder"}
          </span>
          {s.mbi_maia_prob !== null && (
            <span className="ml-1 text-gray-500">(Maia: {(s.mbi_maia_prob * 100).toFixed(1)}%)</span>
          )}
        </div>
      )}
      {s.eig_value !== null && (
        <div className="col-span-2">
          <span className="text-gray-500">EIG:</span>{" "}
          <span className={s.is_eig_flagged ? "font-semibold text-cyan-400" : "text-gray-300"}>
            {s.eig_value.toFixed(2)}
          </span>
          {s.is_eig_flagged && <span className="ml-1 text-cyan-400">Flagged</span>}
        </div>
      )}
      {s.is_brilliant && (
        <div className="col-span-2">
          <span className="text-gray-500">BRI:</span>{" "}
          <span className="font-semibold text-yellow-400">Brilliant</span>
          {s.bri_maia_prob !== null && (
            <span className="ml-1 text-gray-500">(Maia: {(s.bri_maia_prob * 100).toFixed(1)}%)</span>
          )}
        </div>
      )}
      {s.epe_score !== null && (
        <div className="col-span-2">
          <span className="text-gray-500">EPE:</span>{" "}
          <span className="text-purple-400">{s.epe_score.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

function buildBestLineFens(startFen: string, line: readonly string[]) {
  const fens: string[] = [];
  try {
    const chess = new Chess(startFen);
    for (const san of line) {
      const moved = chess.move(san);
      if (!moved) {
        break;
      }
      fens.push(chess.fen());
    }
  } catch {
    return fens;
  }
  return fens;
}
