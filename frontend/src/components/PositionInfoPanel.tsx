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
    <div className="panel panel-radius panel-pad shrink-0">
      <div className="panel-header mb-3">
        <h3 className="section-title">Position Info</h3>
        {exploration.isExploring && (
          <div className="flex items-center gap-1">
            <button
              onClick={exploration.exitExploration}
              className="text-button"
            >
              Exit
            </button>
          </div>
        )}
        {!exploration.isExploring && variationState && (
          <span className="rounded border border-[var(--variation-pill-border)] bg-[var(--variation-active-bg)] px-2 py-0.5 text-xs font-medium text-[var(--variation-active-text)]">
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
  return <span className="text-[var(--insight)]">{ev.mate_in !== null ? `#${ev.mate_in}` : ev.eval.toFixed(2)}</span>;
}

function GoodMoves({ ev }: { ev: PositionEvalResult }) {
  const others = (ev.good_moves ?? []).filter((m) => m !== ev.best_move);
  if (others.length === 0) {
    return null;
  }

  return (
    <div className="col-span-2">
      <span className="metric-label">Good moves: </span>
      <span className="mono">
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
      return <div className="animate-pulse text-sm text-[var(--teal)]">Evaluating...</div>;
    }
    return <div className="text-sm muted">No evaluation data</div>;
  }

  const { prefix } = fenToMovePrefix(expMove.fen);

  return (
    <div className="compact-grid text-sm">
      <div>
        <span className="metric-label">Move:</span> <span className="mono text-[var(--teal-soft)]">{prefix} {expMove.san}</span>
      </div>
      <div>
        <span className="metric-label">Eval:</span> <EvalDisplay ev={ev} />
      </div>
      {ev.best_move && (
        <div className="col-span-2">
          <span className="metric-label">Best move:</span> <span className="mono">{prefix} {ev.best_move}</span>
        </div>
      )}
      <GoodMoves ev={ev} />
      {ev.cti != null && (
        <div className="col-span-2">
          <span className="metric-label">CTI:</span> <span className="text-[var(--teal)]">{ev.cti.toFixed(4)}</span>
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
      return <div className="animate-pulse text-sm text-[var(--success)]">Evaluating...</div>;
    }
    return (
      <div className="text-sm muted">
        <span className="metric-label">Move:</span> <span className="mono text-[var(--variation-active-text)]">{prefix} {san}</span>
      </div>
    );
  }

  return (
    <div className="compact-grid text-sm">
      <div>
        <span className="metric-label">Move:</span> <span className="mono text-[var(--variation-active-text)]">{prefix} {san}</span>
      </div>
      <div>
        <span className="metric-label">Eval:</span> <EvalDisplay ev={ev} />
      </div>
      {ev.best_move && (
        <div className="col-span-2">
          <span className="metric-label">Best move:</span> <span className="mono">{prefix} {ev.best_move}</span>
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
    <div className="compact-grid text-sm">
      <div>
        <span className="metric-label">Move:</span> <span className="mono">{mPrefix} {s.move}</span>
      </div>
      <div>
        <span className="metric-label">Side:</span> <span className="info-value">{s.side}</span>
      </div>
      <div>
        <span className="metric-label">Eval:</span>{" "}
        <span className="text-[var(--insight)]">{s.mate_in !== null ? `#${s.mate_in}` : s.eval_after.toFixed(2)}</span>
      </div>
      <div>
        <span className="metric-label">CTI:</span>{" "}
        <span style={{ color: s.side === "white" ? "var(--success)" : "var(--warning)" }}>
          {s.cti !== null ? s.cti.toFixed(4) : "N/A"}
        </span>
      </div>
      <div>
        <span className="metric-label">Minefield:</span>{" "}
        {s.is_minefield ? (
          <span className="font-semibold text-[var(--warning)]">Yes</span>
        ) : (
          <span className="muted">No</span>
        )}
      </div>
      {s.best_move && (
        <div className="col-span-2">
          <span className="metric-label">Best move:</span> <span className="mono">{s.best_move}</span>
        </div>
      )}
      {s.best_move && goodOthers.length > 0 && (
        <div className="col-span-2">
          <span className="metric-label">Good moves:</span>{" "}
          <span className="mono">
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
          <span className="metric-label">MBI:</span>{" "}
          <span
            className={
              s.mbi_classification === "cognitive_trap"
                ? "font-semibold text-[var(--violet)]"
                : s.mbi_classification === "random_oversight"
                  ? "font-semibold text-[var(--danger)]"
                  : "info-value"
            }
          >
            {s.mbi_classification === "cognitive_trap"
              ? "Cognitive Trap"
              : s.mbi_classification === "random_oversight"
                ? "Random Oversight"
                : "Unclassified Blunder"}
          </span>
          {s.mbi_maia_prob !== null && (
            <span className="ml-1 muted">(Maia: {(s.mbi_maia_prob * 100).toFixed(1)}%)</span>
          )}
        </div>
      )}
      {s.eig_value !== null && (
        <div className="col-span-2">
          <span className="metric-label">EIG:</span>{" "}
          <span className={s.is_eig_flagged ? "font-semibold text-[var(--insight)]" : "info-value"}>
            {s.eig_value.toFixed(2)}
          </span>
          {s.is_eig_flagged && <span className="ml-1 text-[var(--insight)]">Flagged</span>}
        </div>
      )}
      {s.is_brilliant && (
        <div className="col-span-2">
          <span className="metric-label">BRI:</span>{" "}
          <span className="font-semibold text-[var(--accent-strong)]">Brilliant</span>
          {s.bri_maia_prob !== null && (
            <span className="ml-1 muted">(Maia: {(s.bri_maia_prob * 100).toFixed(1)}%)</span>
          )}
        </div>
      )}
      {s.epe_score !== null && (
        <div className="col-span-2">
          <span className="metric-label">EPE:</span>{" "}
          <span className="text-[var(--violet)]">{s.epe_score.toFixed(2)}</span>
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
