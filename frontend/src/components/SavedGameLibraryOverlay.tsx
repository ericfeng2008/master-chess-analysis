import { useSavedGameLibrary } from '../hooks/useSavedGameLibrary'
import type { StoredGameSummary } from '../types/mistakes'

interface SavedGameLibraryOverlayProps {
  open: boolean
  disabled: boolean
  refreshToken?: number
  openError?: string | null
  openingGameId?: string | null
  onClose: () => void
  onPreviewGame?: () => void
  onOpenGame: (game: StoredGameSummary) => void
  onEditMetadata: (game: StoredGameSummary) => void
}

function analysisLabel(count: number) {
  if (count === 0) return 'Not analyzed'
  return count === 1 ? '1 analysis' : `${count} analyses`
}

function resultLabel(result: string | null) {
  return !result || result === '*' ? 'Unfinished' : result
}

function dateLabel(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function SavedGameLibraryOverlay({ open, disabled, refreshToken, openError, openingGameId, onClose, onPreviewGame, onOpenGame, onEditMetadata }: SavedGameLibraryOverlayProps) {
  const library = useSavedGameLibrary(open, refreshToken)
  if (!open) return null
  const {selected} = library
  const hasActiveFilter = Boolean(library.query.trim()) || library.analysisState !== 'all'
  const clearFilters = () => {
    library.setQuery('')
    library.setAnalysisState('all')
    library.setPage(1)
  }

  return <div className="saved-game-dialog-backdrop" role="presentation"><section className="saved-game-library" role="dialog" aria-modal="true" aria-label="Saved games">
    <header><div><span>Local game library</span><h2>Open saved game</h2></div><button type="button" className="icon-button" aria-label="Close saved games" onClick={onClose}>×</button></header>
    <div className="saved-game-controls">
      <input aria-label="Search saved games" value={library.query} onChange={event => { library.setQuery(event.target.value); library.setPage(1) }} placeholder="Search tournament or player…" />
      <div className="segment-control" aria-label="Analysis state">{(['all','analyzed','not_analyzed'] as const).map(value => <button type="button" key={value} className="segment-button" data-active={library.analysisState === value} onClick={() => {library.setAnalysisState(value); library.setPage(1)}}>{value === 'all' ? 'All' : value === 'analyzed' ? 'Analyzed' : 'Not analyzed'}</button>)}</div>
      <label className="saved-game-sort">Sort <select aria-label="Saved game sort" value={library.sort} onChange={event => { library.setSort(event.target.value as typeof library.sort); library.setPage(1) }}><option value="recent">Recently opened</option><option value="added">Recently added</option><option value="players">Players</option></select></label>
    </div>
    {library.error ? <div className="review-alert" role="alert">{library.error}<button type="button" className="text-button" onClick={library.refresh}>Retry</button></div> : <div className="saved-game-grid">
      <div className="saved-game-list" aria-busy={library.loading}>
        {library.loading && !library.items.length && <div className="saved-game-loading">Loading saved games…</div>}
        {!library.loading && !library.items.length && <div className="saved-game-empty">{hasActiveFilter ? <div><strong>No games match this view</strong><span>Try another player or tournament, or clear the current filter.</span><br/><button type="button" className="text-button" onClick={clearFilters}>Clear search and filters</button></div> : <div><strong>No saved games yet</strong><span>Upload a PGN to add the first game to this local library.</span></div>}</div>}
        {library.items.map(game => { const metadata = game.metadata ?? {}; const missing = game.metadata_missing ?? []; return <button type="button" key={game.id} className="saved-game-row" data-active={selected?.id === game.id} onClick={() => { library.setSelected(game); onPreviewGame?.() }}><strong>{metadata.White ?? 'White'} — {metadata.Black ?? 'Black'}</strong><span>{metadata.Event ?? 'Tournament details missing'}</span><small>{analysisLabel(game.analysis_count)} · {game.move_count} moves · {resultLabel(game.result)}</small><i className="saved-game-row-status" data-incomplete={missing.length > 0}>{missing.length ? 'Details missing' : game.analysis_count ? 'Analyzed' : 'Ready'}</i></button> })}
        {!!library.items.length && <div className="saved-game-pagination"><button type="button" className="text-button" disabled={library.page <= 1} onClick={() => library.setPage(library.page - 1)}>Previous</button><span>Page {library.page} · {library.total} game{library.total === 1 ? '' : 's'}</span><button type="button" className="text-button" disabled={library.page * library.pageSize >= library.total} onClick={() => library.setPage(library.page + 1)}>Next</button></div>}
      </div>
      <aside className="saved-game-preview">{selected ? (() => { const metadata = selected.metadata ?? {}; const missing = selected.metadata_missing ?? []; const isOpening = openingGameId === selected.id; return <><span>{resultLabel(selected.result)}</span><h3>{metadata.White ?? 'White'} — {metadata.Black ?? 'Black'}</h3><p>{metadata.Event ?? 'Tournament / event not yet entered'}</p><dl><div><dt>Moves</dt><dd>{selected.move_count}</dd></div><div><dt>Analysis</dt><dd>{analysisLabel(selected.analysis_count)}</dd></div><div><dt>Added</dt><dd>{dateLabel(selected.created_at)}</dd></div><div><dt>Last opened</dt><dd>{dateLabel(selected.last_opened_at)}</dd></div></dl>{missing.length > 0 && <p className="status-line">Details missing: {missing.join(', ')}</p>}{openError && <div className="review-alert saved-game-open-error" role="alert">{openError}</div>}<div><button type="button" className="text-button" disabled={Boolean(openingGameId)} onClick={() => onEditMetadata(selected)}>Edit details</button><button type="button" className="primary-button" disabled={disabled || Boolean(openingGameId)} onClick={() => onOpenGame(selected)}>{isOpening ? 'Opening…' : 'Open game'}</button></div></> })() : <p className="status-line">Select a saved game to preview it.</p>}</aside>
    </div>}
  </section></div>
}
