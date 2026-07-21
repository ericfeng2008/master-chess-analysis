export interface ChartDataPoint {
  index: number;
  label: string;
  stockfish_eval: number | null;
  evalPositive: number | null;
  evalNegative: number | null;
  ctiWhite: number | null;
  ctiBlack: number | null;
  ctiApproximate: boolean;
  mbi_classification: string | null;
  mbi_maia_prob: number | null;
  eig_value: number | null;
  is_eig_flagged: boolean;
  move: string;
  side: string;
  move_number: number;
  mate_in: number | null;
  raw_eval: number | null;
}

export function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDataPoint }>;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const d = payload[0].payload;
  const ctiValue = d.side === "white" ? d.ctiWhite : d.ctiBlack;

  return (
    <div className="tooltip-panel">
      <p>
        Move {d.move_number} ({d.side}): <span className="mono">{d.move}</span>
      </p>
      <p className="text-[var(--insight)]">
        Eval: {d.mate_in !== null ? `#${d.mate_in}` : d.raw_eval !== null ? d.raw_eval.toFixed(2) : "N/A"}
      </p>
      <p style={{ color: d.side === "white" ? "var(--success)" : "var(--warning)" }}>
        CTI: {ctiValue !== null ? `${d.ctiApproximate ? "≈" : ""}${ctiValue.toFixed(d.ctiApproximate ? 3 : 4)}` : "N/A"}
      </p>
      {d.mbi_classification !== null && (
        <p className="text-[var(--violet)]">
          MBI: {d.mbi_classification === "cognitive_trap"
            ? "Cognitive Trap"
            : d.mbi_classification === "random_oversight"
              ? "Random Oversight"
              : "Unclassified Blunder"}
          {d.mbi_maia_prob !== null ? ` (${(d.mbi_maia_prob * 100).toFixed(1)}%)` : ""}
        </p>
      )}
      {d.eig_value !== null && (
        <p className="text-[var(--insight)]">
          EIG: {d.eig_value.toFixed(2)}{d.is_eig_flagged ? " Flagged" : ""}
        </p>
      )}
    </div>
  );
}
