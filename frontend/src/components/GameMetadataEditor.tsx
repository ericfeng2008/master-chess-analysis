import { useState } from 'react'
import { patchGameMetadata } from '../api/mistakes'
import type { GameMetadata, MetadataKey, StoredGameMetadata } from '../types/mistakes'

type EditableGame = Pick<StoredGameMetadata, 'id'> & GameMetadata
const fields: Array<[MetadataKey, string]> = [['Event', 'Tournament / Event'], ['White', 'White player'], ['Black', 'Black player']]

export function GameMetadataEditor({ game, onClose, onSaved }: { game: EditableGame; onClose: () => void; onSaved: (game: StoredGameMetadata) => void }) {
  // Keep this boundary defensive: a frontend may briefly outlive an older local
  // backend during development and receive a pre-metadata saved-game summary.
  const metadata = game.metadata ?? {}
  const metadataSources = game.metadata_sources ?? { Event: 'missing', White: 'missing', Black: 'missing' }
  const [values, setValues] = useState<Record<MetadataKey, string>>({ Event: metadata.Event ?? '', White: metadata.White ?? '', Black: metadata.Black ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const changes: Partial<Record<MetadataKey, string | null>> = {}
    fields.forEach(([key]) => {
      if (values[key] !== (metadata[key] ?? '')) changes[key] = values[key].trim() || null
    })
    if (!Object.keys(changes).length) { onClose(); return }
    setSaving(true); setError(null)
    try { onSaved(await patchGameMetadata(game.id, changes)); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  return <div className="saved-game-dialog-backdrop" role="presentation"><section className="saved-game-dialog" role="dialog" aria-modal="true" aria-label="Game details">
    <header><div><span>Stored locally</span><h2>Game details</h2></div><button type="button" className="icon-button" aria-label="Close game details" onClick={onClose}>×</button></header>
    <p>Complete these details for your local game library. Empty values use the PGN value when available.</p>
    {fields.map(([key, label]) => <label className="review-field" key={key}><span>{label} <small>· {metadataSources[key] ?? 'missing'}</small></span><input value={values[key]} maxLength={200} onChange={event => setValues(current => ({...current,[key]:event.target.value}))}/></label>)}
    {error && <div className="review-alert" role="alert">{error}</div>}
    <footer><button type="button" className="text-button" onClick={onClose}>Skip for now</button><button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save details'}</button></footer>
  </section></div>
}
