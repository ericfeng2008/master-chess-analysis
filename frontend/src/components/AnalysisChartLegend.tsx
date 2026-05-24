export function AnalysisChartLegend() {
  return (
    <div className="mt-2 flex flex-col items-center gap-0.5 text-xs leading-none muted">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5">
        <span className="flex items-center gap-1">
          <svg width="20" height="14" viewBox="0 0 20 14">
            <line x1="0" y1="7" x2="20" y2="7" stroke="var(--chart-cti-white)" strokeWidth="2" />
          </svg>
          CTI White
        </span>

        <span className="flex items-center gap-1">
          <svg width="20" height="14" viewBox="0 0 20 14">
            <line x1="0" y1="7" x2="20" y2="7" stroke="var(--chart-cti-black)" strokeWidth="2" />
          </svg>
          CTI Black
        </span>

        <span className="flex items-center gap-1">
          <svg width="20" height="14" viewBox="0 0 20 14">
            <line x1="0" y1="7" x2="20" y2="7" stroke="var(--chart-epe)" strokeWidth="1.5" strokeDasharray="2 3" />
          </svg>
          EPE
        </span>

        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="5" fill="var(--chart-mine-best)" stroke="var(--chart-mine-best-stroke)" strokeWidth="1.5" />
          </svg>
          Minefield Best
        </span>

        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="5" fill="var(--chart-mine-good)" stroke="var(--chart-mine-good-stroke)" strokeWidth="1.5" />
          </svg>
          Minefield Good
        </span>

        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="5" fill="var(--chart-mine-missed)" stroke="var(--chart-mine-missed-stroke)" strokeWidth="1.5" />
          </svg>
          Minefield Missed
        </span>
      </div>

      <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5">
        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <polygon points="7,1 13,7 7,13 1,7" fill="var(--chart-trap)" stroke="var(--chart-trap-stroke)" strokeWidth="1" />
          </svg>
          Cognitive Trap
        </span>

        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <line x1="3" y1="3" x2="11" y2="11" stroke="var(--chart-mine-missed)" strokeWidth="3" strokeLinecap="round" />
            <line x1="11" y1="3" x2="3" y2="11" stroke="var(--chart-mine-missed)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Random Oversight
        </span>

        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <rect x="2" y="2" width="10" height="10" fill="var(--chart-intuition)" stroke="var(--chart-intuition-stroke)" strokeWidth="1" />
          </svg>
          Intuition Gap
        </span>

        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <polygon
              points="7,1 8.9,5.1 13.4,5.5 10,8.6 10.9,13 7,10.8 3.1,13 4,8.6 0.6,5.5 5.1,5.1"
              fill="var(--accent-strong)"
              stroke="var(--accent)"
              strokeWidth="0.8"
            />
          </svg>
          Brilliant
        </span>
      </div>
    </div>
  );
}
