import { useEffect, useMemo, useState } from 'react'

import { getMistakeSuggestions, saveMistakes } from '../../api/mistakes'
import type { MistakeSuggestion, StudySide } from '../../types/mistakes'

interface Props {
  analysisRunId: string
  studySide: StudySide
  players?: { white?: string; black?: string }
  onStudySideChange: (side: StudySide) => void
  onJumpToMove: (ply: number) => void
  onOpenLibrary: () => void
}

const reasonLabel = (reason: string) => reason === 'high_cti_mistake' ? 'High-CTI mistake' : 'Human-natural blunder'
const pct = (value: number | null) => value == null ? '—' : `${Math.round(value * 100)}%`

export function MistakeCapturePanel({ analysisRunId, studySide, players, onStudySideChange, onJumpToMove, onOpenLibrary }: Props) {
  const [items,setItems]=useState<MistakeSuggestion[]>([])
  const [selected,setSelected]=useState<Set<number>>(new Set())
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)

  useEffect(()=>{
    let active=true
    const timer=window.setTimeout(()=>{
      setLoading(true);setError(null);setMessage(null)
      getMistakeSuggestions(analysisRunId,studySide).then(result=>{
        if(!active)return
        setItems(result.items);setSelected(new Set(result.items.filter(item=>!item.saved).map(item=>item.ply)))
      }).catch(value=>{if(active)setError(value instanceof Error?value.message:String(value))}).finally(()=>{if(active)setLoading(false)})
    },0)
    return()=>{active=false;window.clearTimeout(timer)}
  },[analysisRunId,studySide])
  const unsaved=useMemo(()=>items.filter(item=>!item.saved),[items])
  const toggle=(ply:number)=>setSelected(current=>{const next=new Set(current);if(next.has(ply))next.delete(ply);else next.add(ply);return next})
  const save=async()=>{
    if(!selected.size)return;setSaving(true);setError(null)
    try{
      const result=await saveMistakes(analysisRunId,studySide,[...selected])
      const refreshed=await getMistakeSuggestions(analysisRunId,studySide)
      setItems(refreshed.items);setSelected(new Set());setMessage(`${result.created.length} saved · ${result.existing.length} already in your library`)
    }catch(value){setError(value instanceof Error?value.message:String(value))}finally{setSaving(false)}
  }
  return <section className="mistake-capture panel panel-radius" aria-labelledby="mistake-capture-title">
    <div className="panel-header mistake-capture-head"><h3 className="section-title" id="mistake-capture-title">Keep only what matters</h3><div className="mistake-side-control"><small className="mistake-side-label">Mistake made by</small><div className="segment-control" aria-label="Mistake made by"><button type="button" className="segment-button" aria-pressed={studySide==='white'} data-active={studySide==='white'} title={players?.white} onClick={()=>onStudySideChange('white')}>White</button><button type="button" className="segment-button" aria-pressed={studySide==='black'} data-active={studySide==='black'} title={players?.black} onClick={()=>onStudySideChange('black')}>Black</button></div></div></div>
    <div className="mistake-capture-body"><h4>Mistakes to revisit</h4><p className="mistake-capture-intro">Review either player. Only objectively wrong moves from high-CTI positions and Maia3 cognitive traps are shown; you decide what enters practice.</p>
    {loading&&<p className="status-line" role="status">Reading the completed analysis…</p>}
    {error&&<div className="review-alert" role="alert">{error}</div>}
    {!loading&&!items.length&&<div className="mistake-capture-empty"><strong>No additional mistakes for {studySide}.</strong><span>Moves already saved anywhere in this game’s history are deliberately excluded.</span></div>}
    <div className="mistake-suggestion-list">{items.map(item=><article key={item.ply} data-saved={item.saved}>
      <label><input type="checkbox" disabled={item.saved} checked={item.saved||selected.has(item.ply)} onChange={()=>toggle(item.ply)} /><span>{item.saved?'Saved':'Save'}</span></label>
      <button type="button" className="mistake-suggestion-main" onClick={()=>onJumpToMove(item.ply)}><span>Move {item.move_number} · {item.side}</span><strong>{item.played_move} <i>instead of {item.best_move??'—'}</i></strong><small>{item.system_reasons.map(reasonLabel).join(' · ')}</small></button>
      <div className="mistake-mini-metrics"><span><b>{pct(item.cti_lower_bound)}</b>CTI floor</span><span><b>{item.objective_loss.toFixed(2)}</b>pawn loss</span>{item.mbi_maia_prob!=null&&<span><b>{pct(item.mbi_maia_prob)}</b>Maia likelihood</span>}</div>
    </article>)}</div>
    <div className="mistake-capture-actions"><button type="button" className="primary-button" disabled={!selected.size||saving} onClick={()=>void save()}>{saving?'Saving locally…':`Save selected mistakes (${selected.size})`}</button><button type="button" className="text-button" onClick={onOpenLibrary}>Open Mistake Library</button></div>
    {message&&<p className="mistake-save-message" role="status">{message}</p>}
    {!loading&&unsaved.length>0&&<small>Maia likelihood is a model estimate for the selected Elo context, not an observed population percentage.</small>}
    </div>
  </section>
}
