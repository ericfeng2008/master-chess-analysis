import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameMetadataEditor } from './GameMetadataEditor'

const api = vi.hoisted(() => ({ patch: vi.fn() }))
vi.mock('../api/mistakes', () => ({ patchGameMetadata: (...args: unknown[]) => api.patch(...args) }))

const game = {
  id: 'game-1',
  metadata: { Event: 'Imported event', White: 'Ada', Black: 'Ben' },
  metadata_sources: { Event: 'imported' as const, White: 'imported' as const, Black: 'imported' as const },
  metadata_missing: [], metadata_updated_at: null, source_headers: {}, imported_metadata: {}, metadata_overrides: {},
}

describe('GameMetadataEditor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves only a changed field and accepts a later correction', async () => {
    const saved = vi.fn(); const close = vi.fn()
    api.patch.mockResolvedValue({ ...game, metadata: { ...game.metadata, Event: 'Club final' } })
    render(<GameMetadataEditor game={game} onSaved={saved} onClose={close} />)
    fireEvent.change(screen.getByLabelText(/Tournament/i), { target: { value: 'Club final' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('game-1', { Event: 'Club final' }))
    expect(saved).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  it('allows skip without writing metadata', () => {
    const close = vi.fn()
    render(<GameMetadataEditor game={game} onSaved={vi.fn()} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(api.patch).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  it('keeps prior values visible when persistence fails', async () => {
    api.patch.mockRejectedValue(new Error('Local database unavailable'))
    const close = vi.fn()
    render(<GameMetadataEditor game={game} onSaved={vi.fn()} onClose={close} />)
    fireEvent.change(screen.getByLabelText(/White player/i), { target: { value: 'Corrected name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Local database unavailable')
    expect(screen.getByLabelText(/White player/i)).toHaveValue('Corrected name')
    expect(close).not.toHaveBeenCalled()
  })

  it('does not crash on a legacy saved-game summary from a stale backend', () => {
    const close = vi.fn()
    const legacyGame = { id: 'legacy-game' } as unknown as typeof game
    render(<GameMetadataEditor game={legacyGame} onSaved={vi.fn()} onClose={close} />)
    expect(screen.getByLabelText(/Tournament/i)).toHaveValue('')
    expect(screen.getAllByText(/· missing/i)).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(close).toHaveBeenCalled()
  })
})
