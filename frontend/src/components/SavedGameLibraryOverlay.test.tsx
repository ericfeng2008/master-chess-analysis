import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredGameSummary } from '../types/mistakes'
import { SavedGameLibraryOverlay } from './SavedGameLibraryOverlay'

const library = vi.hoisted(() => ({
  query: '', setQuery: vi.fn(), analysisState: 'all', setAnalysisState: vi.fn(), sort: 'recent', setSort: vi.fn(), page: 1, setPage: vi.fn(), pageSize: 25,
  items: [] as StoredGameSummary[],
  total: 1, selected: null as StoredGameSummary | null, setSelected: vi.fn(), loading: false, error: null as string | null, refresh: vi.fn(),
}))
vi.mock('../hooks/useSavedGameLibrary', () => ({ useSavedGameLibrary: () => library }))

describe('SavedGameLibraryOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    library.query = ''
    library.analysisState = 'all'
    library.items = [game]
    library.total = 1
    library.selected = null
    library.loading = false
    library.error = null
  })

  it('previews a saved game before the user explicitly opens it', () => {
    const open = vi.fn(); const close = vi.fn()
    render(<SavedGameLibraryOverlay open disabled={false} onClose={close} onOpenGame={open} onEditMetadata={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Ada — Ben/i }))
    expect(library.setSelected).toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('closes without navigating away', () => {
    const close = vi.fn()
    render(<SavedGameLibraryOverlay open disabled={false} onClose={close} onOpenGame={vi.fn()} onEditMetadata={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close saved games' }))
    expect(close).toHaveBeenCalled()
  })

  it('distinguishes a filtered empty result and clears discovery controls', () => {
    library.query = 'missing player'
    library.items = []
    library.total = 0
    render(<SavedGameLibraryOverlay open disabled={false} onClose={vi.fn()} onOpenGame={vi.fn()} onEditMetadata={vi.fn()} />)
    expect(screen.getByText('No games match this view')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(library.setQuery).toHaveBeenCalledWith('')
    expect(library.setAnalysisState).toHaveBeenCalledWith('all')
  })

  it('shows open failures inside the selected-game preview', () => {
    library.selected = game
    render(<SavedGameLibraryOverlay open disabled={false} openError="Saved game could not be loaded" onClose={vi.fn()} onOpenGame={vi.fn()} onEditMetadata={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Saved game could not be loaded')
    expect(screen.getAllByText('Not analyzed').length).toBeGreaterThan(0)
  })
})

const game: StoredGameSummary = {
  id: 'game-1', headers: {}, metadata: { Event: 'Club', White: 'Ada', Black: 'Ben' },
  metadata_sources: { Event: 'imported', White: 'imported', Black: 'imported' }, metadata_missing: [],
  metadata_updated_at: null, source_headers: {}, imported_metadata: {}, metadata_overrides: {}, created_at: 'now',
  updated_at: 'now', last_opened_at: 'now', mistake_count: 0, move_count: 42, analysis_count: 0,
  preferred_analysis_run_id: null, result: '*',
}
