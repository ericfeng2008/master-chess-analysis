export interface ChartDataPoint {
  index: number;
  label: string;
  stockfish_eval: number;
  evalPositive: number;
  evalNegative: number;
  ctiWhite: number | null;
  ctiBlack: number | null;
  epe: number | null;
  mbi_classification: string | null;
  mbi_maia_prob: number | null;
  eig_value: number | null;
  is_eig_flagged: boolean;
  move: string;
  side: string;
  move_number: number;
  mate_in: number | null;
  raw_eval: number;
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
    <div className="rounded border border-gray-600 bg-gray-800 p-2 text-sm shadow-lg">
      <p className="text-gray-300">
        Move {d.move_number} ({d.side}): <span className="font-mono">{d.move}</span>
      </p>
      <p className="text-blue-400">Eval: {d.mate_in !== null ? `#${d.mate_in}` : d.raw_eval.toFixed(2)}</p>
      <p style={{ color: d.side === "white" ? "#22c55e" : "#f97316" }}>
        CTI: {ctiValue !== null ? ctiValue.toFixed(4) : "N/A"}
      </p>
      {d.epe !== null && <p className="text-purple-400">EPE: {d.epe.toFixed(2)}</p>}
      {d.mbi_classification !== null && (
        <p className="text-fuchsia-400">
          MBI: {d.mbi_classification === "cognitive_trap"
            ? "Cognitive Trap"
            : d.mbi_classification === "random_oversight"
              ? "Random Oversight"
              : "Unclassified Blunder"}
          {d.mbi_maia_prob !== null ? ` (${(d.mbi_maia_prob * 100).toFixed(1)}%)` : ""}
        </p>
      )}
      {d.eig_value !== null && (
        <p className="text-cyan-400">
          EIG: {d.eig_value.toFixed(2)}{d.is_eig_flagged ? " Flagged" : ""}
        </p>
      )}
    </div>
  );
}
