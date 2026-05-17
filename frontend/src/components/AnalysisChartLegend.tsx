export function AnalysisChartLegend() {
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
      <span className="flex items-center gap-1">
        <svg width="20" height="14" viewBox="0 0 20 14">
          <line x1="0" y1="7" x2="20" y2="7" stroke="#22c55e" strokeWidth="2" />
        </svg>
        CTI (White)
      </span>

      <span className="flex items-center gap-1">
        <svg width="20" height="14" viewBox="0 0 20 14">
          <line x1="0" y1="7" x2="20" y2="7" stroke="#f97316" strokeWidth="2" />
        </svg>
        CTI (Black)
      </span>

      <span className="flex items-center gap-1">
        <svg width="20" height="14" viewBox="0 0 20 14">
          <line x1="0" y1="7" x2="20" y2="7" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="2 3" />
        </svg>
        EPE
      </span>

      <span className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="#22c55e" stroke="#16a34a" strokeWidth="1.5" />
        </svg>
        Minefield (Best)
      </span>

      <span className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5" />
        </svg>
        Minefield (Good)
      </span>

      <span className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="#ef4444" stroke="#dc2626" strokeWidth="1.5" />
        </svg>
        Minefield (Missed)
      </span>

      <span className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <polygon points="7,1 13,7 7,13 1,7" fill="#e879f9" stroke="#c026d3" strokeWidth="1" />
        </svg>
        Cognitive Trap
      </span>

      <span className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <line x1="3" y1="3" x2="11" y2="11" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
          <line x1="11" y1="3" x2="3" y2="11" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Random Oversight
      </span>

      <span className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <rect x="2" y="2" width="10" height="10" fill="#22d3ee" stroke="#06b6d4" strokeWidth="1" />
        </svg>
        Intuition Gap
      </span>

      <span className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <polygon
            points="7,1 8.9,5.1 13.4,5.5 10,8.6 10.9,13 7,10.8 3.1,13 4,8.6 0.6,5.5 5.1,5.1"
            fill="#fbbf24"
            stroke="#d97706"
            strokeWidth="0.8"
          />
        </svg>
        Brilliant
      </span>
    </div>
  );
}
