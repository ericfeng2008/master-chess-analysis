import type { AnalysisHistoryEntry } from '../types'

interface Props {
  history: AnalysisHistoryEntry[]
  activeRunId: string | null
  cacheHit: boolean
  disabled?: boolean
  onSelect: (runId: string) => void
}

const identityLabel = (value: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return 'unknown runtime'
}

export function AnalysisHistoryPanel({ history, activeRunId, cacheHit, disabled, onSelect }: Props) {
  const active = history.find((entry) => entry.id === activeRunId) ?? history[0]
  if (!active) return null

  const date = new Date(active.created_at)
  const dateLabel = Number.isNaN(date.getTime()) ? active.created_at : date.toLocaleString()
  const engine = identityLabel(active.engine, 'name')
  const model = identityLabel(active.maia, 'model', 'checkpoint')
  const activeScope = active.request.analysis_scope === 'white'
    ? 'White only'
    : active.request.analysis_scope === 'black'
      ? 'Black only'
      : 'Both sides'

  return <section className="analysis-history-panel panel panel-radius" aria-label="Saved analysis history">
    <div className="analysis-history-summary">
      <span>{cacheHit ? 'Loaded saved analysis' : 'Analysis saved locally'}</span>
      <strong>{activeScope} · Depth {active.engine_depth} · {dateLabel}</strong>
      <small>{engine} · {model}</small>
      {active.is_legacy && <small>Legacy metric evidence · reanalyze for current CTI</small>}
    </div>
    {history.length > 1 && <label className="analysis-history-select">
      <span>Analysis history</span>
      <select
        aria-label="Analysis history"
        value={active.id}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      >
        {history.map((entry) => {
          const entryDate = new Date(entry.created_at)
          const label = Number.isNaN(entryDate.getTime()) ? entry.created_at : entryDate.toLocaleString()
          const scope = entry.request.analysis_scope === 'white' ? 'White' : entry.request.analysis_scope === 'black' ? 'Black' : 'Both'
          return <option key={entry.id} value={entry.id}>{scope} · Depth {entry.engine_depth} · {label}{entry.is_legacy ? ' · Legacy' : ''}</option>
        })}
      </select>
    </label>}
  </section>
}
