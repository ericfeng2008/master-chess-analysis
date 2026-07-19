import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'

import { getStoredGame } from '../../api/mistakes'
import { useMistakeLibrary } from '../../hooks/useMistakeLibrary'
import type { MistakeOutcome, SavedMistake, StoredGame } from '../../types/mistakes'
import { ChessBoard } from '../ChessBoard'

interface Props { onBack:()=>void; onOpenGame:(game:StoredGame,ply:number)=>void }
const label=(value:string)=>value.replaceAll('_',' ')
const pct=(value:number|null)=>value==null?'—':`${Math.round(value*100)}%`
const gameTitle=(item:SavedMistake)=>`${item.headers.White??'White'} — ${item.headers.Black??'Black'}`

export function MistakeLibraryWorkspace({onBack,onOpenGame}:Props){
  const library=useMistakeLibrary()
  const [screen,setScreen]=useState<'library'|'practice'>('library')
  const [queue,setQueue]=useState<SavedMistake[]>([])
  const startPractice=(items:SavedMistake[])=>{if(!items.length)return;setQueue(items.slice(0,100));setScreen('practice')}
  const openGame=async(item:SavedMistake)=>onOpenGame(await getStoredGame(item.analysis_run_id),item.ply)
  if(screen==='practice')return <MistakePractice queue={queue} onExit={()=>{setScreen('library');void library.refresh()}} onOpenGame={openGame} onAssess={library.assess}/>
  const selectedItems=library.items.filter(item=>library.selected.has(item.id))
  return <main className="mistake-library-workspace">
    <header className="mistake-library-header"><div><div className="mistake-header-meta"><button type="button" className="review-back-link" onClick={onBack}>← Analysis</button><span>Local tournament notebook</span></div><h1>Mistake Library</h1><p>Saved difficult errors and human-natural blunders, anchored to their complete games.</p></div><button type="button" className="primary-button" disabled={!library.items.length} onClick={()=>startPractice(library.items)}>Practice this view</button></header>
    <section className="mistake-library-tools" aria-label="Mistake filters">
      <label className="mistake-filter mistake-search"><span>Player name</span><input value={library.query.player_name} onChange={event=>library.setQuery({player_name:event.target.value})} placeholder="White or Black player…" /></label>
      <label className="mistake-filter mistake-search"><span>Game or note</span><input value={library.query.query} onChange={event=>library.setQuery({query:event.target.value})} placeholder="Event, move, or note…" /></label>
      <label className="mistake-filter"><span>Mistake made by</span><select aria-label="Mistake made by" value={library.query.side} onChange={event=>library.setQuery({side:event.target.value as typeof library.query.side})}><option value="">Either player</option><option value="white">White player</option><option value="black">Black player</option></select></label>
      <label className="mistake-filter"><span>Why it was saved</span><select aria-label="Capture reason" value={library.query.reason} onChange={event=>library.setQuery({reason:event.target.value as typeof library.query.reason})}><option value="">All reasons</option><option value="high_cti_mistake">High-CTI mistake</option><option value="human_natural_blunder">Human-natural blunder</option></select></label>
      <label className="mistake-filter"><span>Your tag</span><select aria-label="Tag" value={library.query.tag} onChange={event=>library.setQuery({tag:event.target.value})}><option value="">All tags</option>{library.tags.map(tag=><option key={tag.id} value={tag.name}>{tag.name}</option>)}</select></label>
      <label className="mistake-filter"><span>Practice state</span><select aria-label="Practice state" value={library.query.practice_state} onChange={event=>library.setQuery({practice_state:event.target.value as typeof library.query.practice_state})}><option value="">Any state</option><option value="again">Needs another look</option><option value="understood">Understood</option></select></label>
      <button type="button" className="text-button" onClick={()=>library.setQuery({lifecycle:library.query.lifecycle==='active'?'archived':'active'})}>{library.query.lifecycle==='active'?'View archive':'View active'}</button>
    </section>
    {library.selected.size>0&&<div className="mistake-selection-bar"><strong>{library.selected.size} selected</strong><button type="button" className="primary-button" onClick={()=>startPractice(selectedItems)}>Practice selection</button><button type="button" className="text-button" onClick={library.clearSelected}>Clear</button></div>}
    {library.error&&<div className="review-alert" role="alert">{library.error}<button type="button" className="text-button" onClick={()=>void library.refresh()}>Retry</button></div>}
    <div className="mistake-library-layout">
      <section className="mistake-folio" aria-busy={library.loading}>
        <div className="mistake-folio-heading"><span>{library.total} saved position{library.total===1?'':'s'}</span><p>System reasons are fixed. Tags and notes are yours.</p></div>
        {!library.loading&&!library.items.length&&<div className="mistake-library-empty"><strong>{library.query.lifecycle==='archived'?'The archive is empty.':'No saved mistakes match this view.'}</strong><p>Analyze a completed PGN, choose your side, and save only the positions worth revisiting.</p></div>}
        {library.items.map(item=><article className="mistake-folio-row" key={item.id} data-active={library.detail?.id===item.id}>
          <label><input aria-label={`Select move ${item.move_number} ${item.played_move}`} type="checkbox" checked={library.selected.has(item.id)} onChange={()=>library.toggleSelected(item.id)} /></label>
          <button type="button" className="mistake-folio-main" onClick={()=>void library.openDetail(item.id)}><span>{gameTitle(item)} · {item.headers.Event??'Local game'}</span><strong>{item.side==='white'?`${item.move_number}.`:`${item.move_number}…`} {item.played_move}</strong><small>{item.system_reasons.map(label).join(' · ')}</small><div>{item.tags.map(tag=><i key={tag}>{tag}</i>)}</div></button>
          <div className="mistake-folio-evidence"><span>CTI <b>{pct(item.cti_lower_bound)}</b></span><span>Loss <b>{item.objective_loss.toFixed(2)}</b></span>{item.mbi_maia_prob!=null&&<span>Maia <b>{pct(item.mbi_maia_prob)}</b></span>}</div>
          <div className="mistake-folio-practice"><strong>{item.practice_count}</strong><span>{item.last_practice_state?label(item.last_practice_state):'not practiced'}</span><button type="button" className="text-button" onClick={()=>startPractice([item])}>Practice</button></div>
        </article>)}
        <div className="mistake-pagination"><button type="button" className="text-button" disabled={library.query.page<=1} onClick={()=>library.setQuery({page:library.query.page-1})}>Previous</button><span>Page {library.query.page}</span><button type="button" className="text-button" disabled={library.items.length<library.query.page_size} onClick={()=>library.setQuery({page:library.query.page+1})}>Next</button></div>
      </section>
      {library.detail&&<MistakeDetail key={`${library.detail.id}-${library.detail.updated_at}`} item={library.detail} tags={library.tags.map(tag=>tag.name)} saving={library.saving} onClose={library.closeDetail} onOpenGame={()=>void openGame(library.detail!)} onPractice={()=>startPractice([library.detail!])} onSaveNote={note=>void library.update({note})} onSaveTags={tags=>void library.saveTags(tags)} onLifecycle={()=>void library.update({lifecycle:library.detail!.lifecycle==='active'?'archived':'active'})} onDelete={()=>{if(window.confirm('Delete this saved mistake and its minimal practice history? The full game will remain.'))void library.remove()}}/>}
    </div>
  </main>
}

function MistakeDetail({item,tags,saving,onClose,onOpenGame,onPractice,onSaveNote,onSaveTags,onLifecycle,onDelete}:{item:SavedMistake;tags:string[];saving:boolean;onClose:()=>void;onOpenGame:()=>void;onPractice:()=>void;onSaveNote:(value:string)=>void;onSaveTags:(values:string[])=>void;onLifecycle:()=>void;onDelete:()=>void}){
  const [note,setNote]=useState(item.note)
  return <aside className="mistake-detail" aria-label="Saved mistake detail">
    <div className="mistake-detail-head"><div><span>{gameTitle(item)}</span><h2>Move {item.move_number} · {item.side}</h2></div><button type="button" className="icon-button" aria-label="Close detail" onClick={onClose}>×</button></div>
    <div className="mistake-detail-board"><ChessBoard fen={item.decision_fen} orientation={item.side}/></div>
    <div className="mistake-verdict"><span>Played<strong>{item.played_move}</strong></span><i>→</i><span>Best<strong>{item.best_move??'—'}</strong></span></div>
    <div className="mistake-evidence-grid"><div><strong>{pct(item.cti_lower_bound)}–{pct(item.cti_upper_bound)}</strong><span>CTI interval</span></div><div><strong>{item.objective_loss.toFixed(2)}</strong><span>pawn loss</span></div><div><strong>{item.mbi_maia_prob==null?'—':pct(item.mbi_maia_prob)}</strong><span>Maia likelihood</span></div><div><strong>{item.evidence.analysis_depth??'—'}</strong><span>analysis depth</span></div></div>
    <div className="mistake-system-reasons">{item.system_reasons.map(reason=><span key={reason}>{label(reason)}</span>)}</div>
    <p className="mistake-model-note">Maia likelihood is model-estimated for White {item.evidence.maia3_white_elo} / Black {item.evidence.maia3_black_elo} Elo.</p>
    <div className="mistake-line"><span>Best line</span><p>{item.evidence.best_line.join(' ')||'No stored line'}</p></div>
    <label className="review-field"><span>Your note</span><textarea rows={3} value={note} onChange={event=>setNote(event.target.value)} onBlur={()=>{if(note!==item.note)onSaveNote(note)}} /></label>
    <TagEditor selected={item.tags} suggestions={tags} onChange={onSaveTags}/>
    <details><summary>Practice history ({item.practice_count})</summary><div className="mistake-attempt-history">{item.attempts?.length?item.attempts.map(attempt=><p key={attempt.id}><strong>{attempt.outcome}</strong><span>{attempt.chosen_move??'No move'} · {attempt.objective_acceptable?'acceptable':'not acceptable'} · {new Date(attempt.created_at).toLocaleDateString()}</span></p>):<p>No attempts yet.</p>}</div></details>
    <div className="mistake-detail-actions"><button type="button" className="primary-button" onClick={onPractice}>Practice</button><button type="button" className="text-button" onClick={onOpenGame}>Open full game</button><button type="button" className="text-button" onClick={onLifecycle}>{item.lifecycle==='active'?'Archive':'Restore'}</button><button type="button" className="danger-button" onClick={onDelete}>Delete mistake</button></div>
    <small aria-live="polite">{saving?'Saving locally…':'Stored locally · full game preserved'}</small>
  </aside>
}

function TagEditor({selected,suggestions,onChange}:{selected:string[];suggestions:string[];onChange:(values:string[])=>void}){
  const [value,setValue]=useState('')
  const commit=(next:string[])=>onChange([...new Map(next.filter(Boolean).map(tag=>[tag.toLocaleLowerCase(),tag.trim()])).values()])
  const add=(tag:string)=>{const clean=tag.trim();if(!clean)return;commit([...selected,clean]);setValue('')}
  const choices=[...new Map([...selected,...suggestions].map(tag=>[tag.toLocaleLowerCase(),tag])).values()]
  const isSelected=(tag:string)=>selected.some(value=>value.toLocaleLowerCase()===tag.toLocaleLowerCase())
  const toggle=(tag:string,checked:boolean)=>commit(checked?[...selected,tag]:selected.filter(value=>value.toLocaleLowerCase()!==tag.toLocaleLowerCase()))
  return <section className="mistake-tag-editor" aria-labelledby="mistake-tags-title">
    <div className="mistake-tag-heading"><span id="mistake-tags-title">Your tags</span><small>{selected.length} assigned · multiple allowed</small></div>
    <fieldset className="mistake-tag-choices"><legend>Select all that apply</legend>{choices.map(tag=><label key={tag}><input type="checkbox" checked={isSelected(tag)} onChange={event=>toggle(tag,event.target.checked)}/><span>{tag}</span></label>)}</fieldset>
    <form className="mistake-tag-entry" onSubmit={event=>{event.preventDefault();add(value)}}><input aria-label="Add custom tag" value={value} onChange={event=>setValue(event.target.value)} placeholder="Add a custom tag" maxLength={80}/><button type="submit" className="text-button" disabled={!value.trim()}>Add tag</button></form>
  </section>
}

function MistakePractice({queue,onExit,onOpenGame,onAssess}:{queue:SavedMistake[];onExit:()=>void;onOpenGame:(item:SavedMistake)=>void;onAssess:(id:string,move:string|null,outcome:MistakeOutcome)=>Promise<void>}){
  const [index,setIndex]=useState(0);const [phase,setPhase]=useState<'think'|'reveal'|'complete'>('think');const [move,setMove]=useState('');const [again,setAgain]=useState(0);const [understood,setUnderstood]=useState(0);const [error,setError]=useState<string|null>(null);const [confirmReveal,setConfirmReveal]=useState(false)
  const item=queue[index]
  const progress=useMemo(()=>queue.length?`${Math.min(index+1,queue.length)} / ${queue.length}`:'0 / 0',[index,queue.length])
  const assess=async(outcome:MistakeOutcome)=>{if(!item)return;setError(null);try{await onAssess(item.id,move||null,outcome);if(outcome==='again')setAgain(value=>value+1);else setUnderstood(value=>value+1);if(index+1>=queue.length)setPhase('complete');else{setIndex(value=>value+1);setMove('');setPhase('think')}}catch(value){setError(value instanceof Error?value.message:String(value))}}
  if(!item||phase==='complete')return <section className="mistake-practice-summary"><span>Practice complete</span><h1>{queue.length} positions revisited.</h1><div><strong>{again}<small>Again</small></strong><strong>{understood}<small>Understood</small></strong></div><p>No score and no streak—just a record of what deserves another look.</p><button type="button" className="primary-button" onClick={onExit}>Return to library</button></section>
  const playBoard=(from:string,to:string)=>{try{const game=new Chess(item.decision_fen);const played=game.move({from,to,promotion:'q'});if(!played)return false;setMove(played.san);return true}catch{return false}}
  return <main className="mistake-practice"><header><button type="button" className="review-back-link" onClick={onExit}>← Mistake Library</button><span>{progress}</span></header><div className="mistake-practice-layout"><aside><ChessBoard fen={item.decision_fen} orientation={item.side} interactive={phase==='think'} onMove={playBoard}/><p>Move {item.move_number} · {item.side} to decide</p></aside><section>
    {phase==='think'?<><span className="review-kicker">Think</span><h1>Find a better decision.</h1><p className="practice-spoiler-note">The played mistake, CTI verdict, Maia evidence, best move, and game continuation are hidden.</p><label className="review-field"><span>Your move (SAN)</span><input value={move} onChange={event=>setMove(event.target.value)} placeholder="Play on the board or type SAN" /></label><div className="mistake-practice-submit"><button type="button" className="primary-button" onClick={()=>{if(move)setPhase('reveal');else setConfirmReveal(true)}}>{move?'Reveal':'Reveal without move'}</button></div></>:<><span className="review-kicker">Reveal</span><h1>{move||'No submitted move'} <i>vs</i> {item.best_move??'—'}</h1><div className="practice-reveal-ledger"><div><span>Game mistake</span><strong>{item.played_move}</strong></div><div><span>Acceptable moves</span><strong>{item.evidence.good_moves.join(', ')||'—'}</strong></div><div><span>Objective loss</span><strong>{item.objective_loss.toFixed(2)} pawns</strong></div><div><span>CTI interval</span><strong>{pct(item.cti_lower_bound)}–{pct(item.cti_upper_bound)}</strong></div>{item.mbi_maia_prob!=null&&<div><span>Maia played-move likelihood</span><strong>{pct(item.mbi_maia_prob)}</strong></div>}</div><p className="mistake-practice-line">{item.evidence.best_line.join(' ')}</p><div className="mistake-practice-actions"><button type="button" className="danger-soft" onClick={()=>void assess('again')}>Again</button><button type="button" className="primary-button" onClick={()=>void assess('understood')}>Understood</button><button type="button" className="text-button" onClick={()=>void onOpenGame(item)}>Open full game</button></div></>}
    {error&&<div className="review-alert" role="alert">{error}</div>}
  </section></div>{confirmReveal&&<RevealConfirmDialog onCancel={()=>setConfirmReveal(false)} onConfirm={()=>{setConfirmReveal(false);setPhase('reveal')}}/>}</main>
}

function RevealConfirmDialog({onCancel,onConfirm}:{onCancel:()=>void;onConfirm:()=>void}){
  return <div className="mistake-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel()}}><section className="mistake-dialog" role="dialog" aria-modal="true" aria-labelledby="reveal-dialog-title" aria-describedby="reveal-dialog-description"><span>Reveal solution</span><h2 id="reveal-dialog-title">Continue without submitting a move?</h2><p id="reveal-dialog-description">The played move, engine evidence, and best continuation will become visible. This attempt will be recorded as revealed without a move only after you assess it.</p><div><button type="button" className="text-button" autoFocus onClick={onCancel}>Keep thinking</button><button type="button" className="primary-button" onClick={onConfirm}>Reveal solution</button></div></section></div>
}
