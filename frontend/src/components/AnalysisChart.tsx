import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { evalInverseTransform, evalTransform } from "./chartTransform";
import { DiamondShape, SquareShape, StarShape, XMarkShape } from "./ChartMarkerShapes";
import { CustomTooltip, type ChartDataPoint } from "./ChartTooltip";

type AnalysisMoveLike = {
  move_number: number;
  side: string;
  move: string;
  fen: string;
  stockfish_eval: number;
  eval_after: number;
  cti: number | null;
  cti_is_approximate?: boolean;
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
  mate_in: number | null;
};

interface AnalysisChartProps {
  moves: AnalysisMoveLike[];
  minefields: number[];
  selectedIndex: number | null;
  onSelectMove: (index: number) => void;
  perspective: "white" | "black";
}

const CHART = {
  axis: "var(--chart-axis)",
  evalBg: "var(--chart-eval-bg)",
  evalPositive: "var(--chart-eval-positive)",
  evalNegative: "var(--chart-eval-negative)",
  zero: "var(--chart-zero)",
  selected: "var(--chart-selected)",
  ctiWhite: "var(--chart-cti-white)",
  ctiBlack: "var(--chart-cti-black)",
  epe: "var(--chart-epe)",
  mineBest: "var(--chart-mine-best)",
  mineBestStroke: "var(--chart-mine-best-stroke)",
  mineGood: "var(--chart-mine-good)",
  mineGoodStroke: "var(--chart-mine-good-stroke)",
  mineMissed: "var(--chart-mine-missed)",
  mineMissedStroke: "var(--chart-mine-missed-stroke)",
  trap: "var(--chart-trap)",
  trapStroke: "var(--chart-trap-stroke)",
  intuition: "var(--chart-intuition)",
  intuitionStroke: "var(--chart-intuition-stroke)",
};

export function AnalysisChart({
  moves,
  minefields,
  selectedIndex,
  onSelectMove,
  perspective,
}: AnalysisChartProps) {
  const data: ChartDataPoint[] = moves.map((m, i) => {
    const transformed = evalTransform(m.eval_after);
    return {
      index: i,
      label: `${m.move_number}${m.side === "white" ? "." : "..."}`,
      stockfish_eval: transformed,
      evalPositive: Math.max(0, transformed),
      evalNegative: Math.min(0, transformed),
      ctiWhite: m.side === "white" ? m.cti : null,
      ctiBlack: m.side === "black" ? m.cti : null,
      ctiApproximate: m.cti_is_approximate ?? false,
      epe: m.epe_score !== null ? evalTransform(m.epe_score) : null,
      mbi_classification: m.mbi_classification,
      mbi_maia_prob: m.mbi_maia_prob,
      eig_value: m.eig_value,
      is_eig_flagged: m.is_eig_flagged,
      move: m.move,
      side: m.side,
      move_number: m.move_number,
      mate_in: m.mate_in,
      raw_eval: m.eval_after,
    };
  });

  const maxTransformed = Math.max(3, ...data.map((d) => Math.abs(d.stockfish_eval)));
  const evalDomainBound = maxTransformed * 1.15;
  const evalDomain: [number, number] = [-evalDomainBound, evalDomainBound];

  const niceValues = [0, 1, 2, 3, 5, 10, 20, 50, 100];
  const evalTicks: number[] = [];
  for (const v of niceValues) {
    const tv = evalTransform(v);
    if (tv <= evalDomainBound) {
      evalTicks.push(tv);
      if (v > 0) {
        evalTicks.push(-tv);
      }
    }
  }
  evalTicks.sort((a, b) => a - b);

  return (
    <div className="flex items-stretch">
      <div className="flex w-8 shrink-0 items-center justify-center">
        <span className="-rotate-90 select-none whitespace-nowrap text-xs tracking-wide muted">
          Eval (pawns)
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart
            data={data}
            margin={{ left: 0, right: 0 }}
            onClick={(e) => {
              if (e?.activeTooltipIndex != null) {
                onSelectMove(Number(e.activeTooltipIndex));
              }
            }}
          >
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.axis }} />

            <YAxis
              yAxisId="eval"
              orientation="left"
              domain={evalDomain}
              ticks={evalTicks}
              width={30}
              tick={(props: Record<string, unknown>) => {
                const x = Number(props.x);
                const y = Number(props.y);
                const payload = props.payload as { value: number };
                if (Math.abs(payload.value) > evalDomainBound * 0.98) {
                  return <g />;
                }
                const realVal = Math.round(evalInverseTransform(payload.value));
                return (
                  <text x={x} y={y} dy={4} textAnchor="end" fill={CHART.axis} fontSize={11}>
                    {realVal}
                  </text>
                );
              }}
            />

            <YAxis
              yAxisId="cti"
              orientation="right"
              domain={[-1.2, 1.2]}
              width={30}
              ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
              tick={(props: Record<string, unknown>) => {
                const x = Number(props.x);
                const y = Number(props.y);
                const payload = props.payload as { value: number };
                if (payload.value < 0 || payload.value > 1) {
                  return <g />;
                }
                return (
                  <text x={x} y={y} dy={4} textAnchor="start" fill={CHART.axis} fontSize={11}>
                    {payload.value.toFixed(1)}
                  </text>
                );
              }}
            />

            <ReferenceArea
              yAxisId="eval"
              y1={evalDomain[0]}
              y2={evalDomain[1]}
              fill={CHART.evalBg}
              fillOpacity={1}
              stroke="none"
            />
            <Area
              yAxisId="eval"
              type="monotone"
              dataKey="evalPositive"
              fill={CHART.evalPositive}
              stroke="none"
              baseValue={0}
              isAnimationActive={false}
            />
            <Area
              yAxisId="eval"
              type="monotone"
              dataKey="evalNegative"
              fill={CHART.evalNegative}
              stroke="none"
              baseValue={0}
              isAnimationActive={false}
            />
            <ReferenceLine yAxisId="eval" y={0} stroke={CHART.zero} strokeWidth={1} />

            <Line
              yAxisId="eval"
              type="monotone"
              dataKey="epe"
              stroke={CHART.epe}
              strokeDasharray="2 3"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />

            <Tooltip content={<CustomTooltip />} defaultIndex={selectedIndex ?? undefined} />

            {perspective === "white" && (
              <Line
                yAxisId="cti"
                type="monotone"
                dataKey="ctiWhite"
                stroke={CHART.ctiWhite}
                name="CTI (White)"
                dot={false}
                strokeWidth={1}
                connectNulls
                activeDot={{
                  r: 5,
                  onClick: (dotProps: Record<string, unknown>) => {
                    const idx = dotProps.index;
                    if (idx != null) {
                      onSelectMove(Number(idx));
                    }
                  },
                }}
              />
            )}

            {perspective === "black" && (
              <Line
                yAxisId="cti"
                type="monotone"
                dataKey="ctiBlack"
                stroke={CHART.ctiBlack}
                name="CTI (Black)"
                dot={false}
                strokeWidth={1}
                connectNulls
                activeDot={{
                  r: 5,
                  onClick: (dotProps: Record<string, unknown>) => {
                    const idx = dotProps.index;
                    if (idx != null) {
                      onSelectMove(Number(idx));
                    }
                  },
                }}
              />
            )}

            {minefields.map((idx) => {
              const m = moves[idx];
              const d = data[idx];
              if (!m || !d || m.side !== perspective) {
                return null;
              }
              let fill = CHART.mineMissed;
              let stroke = CHART.mineMissedStroke;
              if (m.move === m.best_move) {
                fill = CHART.mineBest;
                stroke = CHART.mineBestStroke;
              } else if (m.good_moves.includes(m.move)) {
                fill = CHART.mineGood;
                stroke = CHART.mineGoodStroke;
              }
              const yValue = d.side === "white" ? d.ctiWhite : d.ctiBlack;
              return (
                <ReferenceDot
                  key={`mine-${idx}`}
                  x={d.label}
                  y={yValue ?? 0}
                  yAxisId="cti"
                  r={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={2}
                />
              );
            })}

            {moves.map((m, idx) => {
              if (m.side !== perspective || !m.mbi_classification) {
                return null;
              }
              const d = data[idx];
              const ctiVal = d?.side === "white" ? d?.ctiWhite : d?.ctiBlack;
              const yBase = (ctiVal ?? 0) + 0.02;
              const yOffset = m.is_minefield ? 0.02 : 0;

              if (m.mbi_classification === "cognitive_trap") {
                return (
                  <ReferenceDot
                    key={`mbi-trap-${idx}`}
                    x={d?.label}
                    y={yBase + yOffset}
                    yAxisId="cti"
                    r={0}
                    fill="none"
                    stroke="none"
                    shape={({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) => (
                      <DiamondShape cx={cx} cy={cy} fill={CHART.trap} stroke={CHART.trapStroke} />
                    )}
                  />
                );
              }

              if (m.mbi_classification === "random_oversight") {
                return (
                  <ReferenceDot
                    key={`mbi-over-${idx}`}
                    x={d?.label}
                    y={yBase + yOffset}
                    yAxisId="cti"
                    r={0}
                    fill="none"
                    stroke="none"
                    shape={({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) => (
                      <XMarkShape cx={cx} cy={cy} stroke={CHART.mineMissed} />
                    )}
                  />
                );
              }

              return (
                <ReferenceDot
                  key={`mbi-unc-${idx}`}
                  x={d?.label}
                  y={yBase + yOffset}
                  yAxisId="cti"
                  r={0}
                  fill="none"
                  stroke="none"
                  shape={({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) => (
                    <DiamondShape cx={cx} cy={cy} fill="none" stroke={CHART.trap} />
                  )}
                />
              );
            })}

            {moves.map((m, idx) => {
              if (m.side !== perspective || !m.is_eig_flagged) {
                return null;
              }
              const d = data[idx];
              const ctiVal = d?.side === "white" ? d?.ctiWhite : d?.ctiBlack;
              let yOffset = 0;
              if (m.is_minefield) yOffset += 0.03;
              if (m.mbi_classification) yOffset += 0.03;
              return (
                <ReferenceDot
                  key={`eig-${idx}`}
                  x={d?.label}
                  y={(ctiVal ?? 0) + yOffset}
                  yAxisId="cti"
                  r={0}
                  fill="none"
                  stroke="none"
                  shape={({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) => (
                    <SquareShape cx={cx} cy={cy} fill={CHART.intuition} stroke={CHART.intuitionStroke} />
                  )}
                />
              );
            })}

            {moves.map((m, idx) => {
              if (m.side !== perspective || !m.is_brilliant) {
                return null;
              }
              const d = data[idx];
              const ctiVal = d?.side === "white" ? d?.ctiWhite : d?.ctiBlack;
              let yOffset = 0;
              if (m.is_minefield) yOffset += 0.03;
              if (m.mbi_classification) yOffset += 0.03;
              if (m.is_eig_flagged) yOffset += 0.03;
              return (
                <ReferenceDot
                  key={`bri-${idx}`}
                  x={d?.label}
                  y={(ctiVal ?? 0) + yOffset}
                  yAxisId="cti"
                  r={0}
                  fill="none"
                  stroke="none"
                  shape={({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) => (
                    <StarShape cx={cx} cy={cy} fill="var(--accent-strong)" stroke="var(--accent)" />
                  )}
                />
              );
            })}

            {selectedIndex !== null && data[selectedIndex] && (() => {
              const d = data[selectedIndex];
              const isCtiSide = d.side === perspective;
              const ctiVal = d.side === "white" ? d.ctiWhite : d.ctiBlack;
              return (
                <ReferenceDot
                  x={d.label}
                  y={isCtiSide ? (ctiVal ?? 0) : d.stockfish_eval}
                  yAxisId={isCtiSide ? "cti" : "eval"}
                  r={8}
                  fill="none"
                  stroke={CHART.selected}
                  strokeWidth={2}
                />
              );
            })()}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex w-8 shrink-0 items-center justify-center">
        <span className="select-none whitespace-nowrap rotate-90 text-xs tracking-wide muted">CTI</span>
      </div>
    </div>
  );
}
