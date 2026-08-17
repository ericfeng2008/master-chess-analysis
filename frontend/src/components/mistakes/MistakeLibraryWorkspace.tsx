import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'

import { getStoredGame } from '../../api/mistakes'
import { useMistakeLibrary } from '../../hooks/useMistakeLibrary'
import type { MistakeOutcome, SavedMistake, StoredGame } from '../../types/mistakes'
import { ChessBoard } from '../ChessBoard'

interface Props { onBack:()=>void; onOpenGame:(game:StoredGame,ply:number)=>void }
type DetailView = 'study'|'notes'|'history'

const detailViews:DetailView[]=['study','notes','history']
const detailLabels:Record<DetailView,string>={study:'Study',notes:'Notes & Tags',history:'History'}
const label=(value:string)=>value.replaceAll('_',' ')
const pct=(value:number|null)=>value==null?'—':`${Math.round(value*100)}%`
const gameTitle=(item:SavedMistake)=>`${item.headers.White??'White'} — ${item.headers.Black??'Black'}`
const studySan=(item:SavedMistake,value:string)=>value&&`${item.side==='black'?'.. ':''}${value}`
function useCompactInspector(){
  const [compact,setCompact]=useState(false)
  useEffect(()=>{
    const media=window.matchMedia?.('(max-width: 1199px)')
    if(!media)return
    const update=()=>setCompact(media.matches)
    update();media.addEventListener?.('change',update)
    return()=>media.removeEventListener?.('change',update)
  },[])
  return compact
}

export function MistakeLibraryWorkspace({onBack,onOpenGame}:Props){
  const library=useMistakeLibrary()
  const [screen,setScreen]=useState<'library'|'practice'>('library')
  const [queue,setQueue]=useState<SavedMistake[]>([])
  const [detailView,setDetailView]=useState<DetailView>('study')
  const rowRefs=useRef(new Map<string,HTMLButtonElement>())
  const lastDetailTrigger=useRef<string|null>(null)
  const compactInspector=useCompactInspector()
  const startPractice=(items:SavedMistake[])=>{if(!items.length)return;setQueue(items.slice(0,100));setScreen('practice')}
  const openGame=async(item:SavedMistake)=>onOpenGame(await getStoredGame(item.analysis_run_id),item.ply)
  const openDetail=(id:string)=>{lastDetailTrigger.current=id;void library.openDetail(id)}
  const closeDetail=()=>{library.closeDetail();const id=lastDetailTrigger.current;if(id)rowRefs.current.get(id)?.focus()}
  const selectedItems=library.items.filter(item=>library.selected.has(item.id))
  const hasSecondaryFilters=Boolean(library.query.side||library.query.reason||library.query.tag||library.query.practice_state||library.query.lifecycle!=='active')
  const clearFilters=()=>library.setQuery({side:'',reason:'',tag:'',practice_state:'',lifecycle:'active'})
  const navigateRow=(item:SavedMistake,direction:-1|1)=>{
    const index=library.items.findIndex(candidate=>candidate.id===item.id)
    const next=library.items[index+direction]
    if(!next)return
    openDetail(next.id)
    rowRefs.current.get(next.id)?.focus()
  }
  if(screen==='practice')return <MistakePractice queue={queue} onExit={()=>{setScreen('library');void library.refresh()}} onOpenGame={openGame} onAssess={library.assess}/>
  return <main className="mistake-library-workspace">
    <header className="mistake-library-header">
      <div className="mistake-library-title"><div className="mistake-header-meta"><button type="button" className="review-back-link" onClick={onBack}>← Analysis</button><span>Local tournament notebook</span></div><div><h1>Mistake Library</h1><p>Study the positions worth carrying into your next game.</p></div></div>
      <button type="button" className="primary-button" disabled={!library.items.length} onClick={()=>startPractice(library.items)}>Practice this view</button>
    </header>
    <section className="mistake-library-tools" aria-label="Mistake filters">
      <label className="mistake-filter mistake-search"><span>Player</span><input aria-label="Player name" value={library.query.player_name} onChange={event=>library.setQuery({player_name:event.target.value})} placeholder="White or Black player…" /></label>
      <label className="mistake-filter mistake-search"><span>Game or note</span><input value={library.query.query} onChange={event=>library.setQuery({query:event.target.value})} placeholder="Event, move, or note…" /></label>
      <label className="mistake-filter"><span>Side</span><select aria-label="Mistake made by" value={library.query.side} onChange={event=>library.setQuery({side:event.target.value as typeof library.query.side})}><option value="">Either</option><option value="white">White</option><option value="black">Black</option></select></label>
      <label className="mistake-filter"><span>Reason</span><select aria-label="Capture reason" value={library.query.reason} onChange={event=>library.setQuery({reason:event.target.value as typeof library.query.reason})}><option value="">All reasons</option><option value="high_cti_mistake">High CTI</option><option value="human_natural_blunder">Natural blunder</option></select></label>
      <label className="mistake-filter"><span>Tag</span><select aria-label="Tag" value={library.query.tag} onChange={event=>library.setQuery({tag:event.target.value})}><option value="">All tags</option>{library.tags.map(tag=><option key={tag.id} value={tag.name}>{tag.name}</option>)}</select></label>
      <label className="mistake-filter"><span>Practice</span><select aria-label="Practice state" value={library.query.practice_state} onChange={event=>library.setQuery({practice_state:event.target.value as typeof library.query.practice_state})}><option value="">Any state</option><option value="again">Needs review</option><option value="understood">Understood</option></select></label>
      <label className="mistake-filter"><span>State</span><select aria-label="Library state" value={library.query.lifecycle} onChange={event=>library.setQuery({lifecycle:event.target.value as typeof library.query.lifecycle})}><option value="active">Active</option><option value="archived">Archive</option></select></label>
      <button type="button" className="text-button mistake-clear-filters" onClick={clearFilters} disabled={!hasSecondaryFilters}>Clear</button>
    </section>
    {library.error&&<div className="review-alert mistake-library-alert" role="alert">{library.error}<button type="button" className="text-button" onClick={()=>void library.refresh()}>Retry</button></div>}
    <div className="mistake-library-layout">
      <section className="mistake-folio" aria-busy={library.loading} aria-label="Saved mistakes">
        <div className="mistake-folio-heading"><div><span>{library.total} saved position{library.total===1?'':'s'}</span><p>System reasons are fixed. Notes and tags are yours.</p></div>{library.selected.size>0&&<div className="mistake-folio-selection"><strong>{library.selected.size} selected</strong><button type="button" className="primary-button" onClick={()=>startPractice(selectedItems)}>Practice selection</button><button type="button" className="text-button" onClick={library.clearSelected}>Clear</button></div>}</div>
        {!library.loading&&!library.items.length&&<div className="mistake-library-empty"><strong>{library.query.lifecycle==='archived'?'The archive is empty.':'No saved mistakes match this view.'}</strong><p>Analyze a completed PGN, choose your side, and save only the positions worth revisiting.</p></div>}
        {library.items.map(item=><article className="mistake-folio-row" key={item.id} data-active={library.detail?.id===item.id}>
          <label><input aria-label={`Select move ${item.move_number} ${item.played_move}`} type="checkbox" checked={library.selected.has(item.id)} onChange={()=>library.toggleSelected(item.id)} /></label>
          <button type="button" className="mistake-folio-main" data-mistake-row={item.id} ref={node=>{if(node)rowRefs.current.set(item.id,node);else rowRefs.current.delete(item.id)}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();navigateRow(item,1)}if(event.key==='ArrowUp'){event.preventDefault();navigateRow(item,-1)}}} onClick={()=>openDetail(item.id)}><span>{gameTitle(item)} · {item.headers.Event??'Local game'}</span><strong>{item.side==='white'?`${item.move_number}.`:`${item.move_number}…`} {item.played_move}</strong><small>{item.system_reasons.map(label).join(' · ')}</small><div>{item.tags.slice(0,3).map(tag=><i key={tag}>{tag}</i>)}{item.tags.length>3&&<i>+{item.tags.length-3}</i>}</div></button>
          <div className="mistake-folio-evidence"><span>CTI <b>{pct(item.cti_lower_bound)}</b></span><span>Loss <b>{item.objective_loss.toFixed(2)}</b></span>{item.mbi_maia_prob!=null&&<span>Maia <b>{pct(item.mbi_maia_prob)}</b></span>}</div>
        </article>)}
        <div className="mistake-pagination"><button type="button" className="text-button" disabled={library.query.page<=1} onClick={()=>library.setQuery({page:library.query.page-1})}>Previous</button><span>Page {library.query.page}</span><button type="button" className="text-button" disabled={library.items.length<library.query.page_size} onClick={()=>library.setQuery({page:library.query.page+1})}>Next</button></div>
      </section>
      {library.detail&&<MistakeDetail key={`${library.detail.id}-${library.detail.updated_at}`} item={library.detail} tags={library.tags.map(tag=>tag.name)} saving={library.saving} activeView={detailView} compact={compactInspector} onViewChange={setDetailView} onClose={closeDetail} onOpenGame={()=>void openGame(library.detail!)} onPractice={()=>startPractice([library.detail!])} onSaveNote={note=>void library.update({note})} onSaveTags={tags=>void library.saveTags(tags)} onLifecycle={()=>void library.update({lifecycle:library.detail!.lifecycle==='active'?'archived':'active'})} onDelete={()=>{if(window.confirm('Delete this saved mistake and its minimal practice history? The full game will remain.'))void library.remove()}}/>}
    </div>
  </main>
}

function MistakeDetail({item,tags,saving,activeView,compact,onViewChange,onClose,onOpenGame,onPractice,onSaveNote,onSaveTags,onLifecycle,onDelete}:{item:SavedMistake;tags:string[];saving:boolean;activeView:DetailView;compact:boolean;onViewChange:(view:DetailView)=>void;onClose:()=>void;onOpenGame:()=>void;onPractice:()=>void;onSaveNote:(value:string)=>void;onSaveTags:(values:string[])=>void;onLifecycle:()=>void;onDelete:()=>void}){
  const [note,setNote]=useState(item.note)
  const [solutionRevealed,setSolutionRevealed]=useState(false)
  const [lineOpen,setLineOpen]=useState(false)
  const [historyPage,setHistoryPage]=useState(0)
  const solutionRegionId=useId()
  const panelRef=useRef<HTMLElement>(null)
  const tabListRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(!compact)return
    const panel=panelRef.current
    const previous=document.activeElement as HTMLElement|null
    const focusFirst=()=>panel?.querySelector<HTMLElement>('[role="tab"]')?.focus()
    const timer=window.setTimeout(focusFirst,0)
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();return}
      if(event.key!=='Tab'||!panel)return
      const focusable=Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]'))
      if(!focusable.length)return
      const first=focusable[0],last=focusable[focusable.length-1]
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',onKeyDown)
    return()=>{window.clearTimeout(timer);document.removeEventListener('keydown',onKeyDown);if(previous?.isConnected)previous.focus()}
  },[compact,onClose])
  const handleTabKeys=(event:React.KeyboardEvent<HTMLButtonElement>)=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return
    event.preventDefault()
    const current=detailViews.indexOf(activeView)
    const nextIndex=event.key==='Home'?0:event.key==='End'?detailViews.length-1:(current+(event.key==='ArrowRight'?1:-1)+detailViews.length)%detailViews.length
    const next=detailViews[nextIndex]
    onViewChange(next)
    tabListRef.current?.querySelector<HTMLButtonElement>(`[data-detail-view="${next}"]`)?.focus()
  }
  return <div className="mistake-detail-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&compact)onClose()}}>
    <aside ref={panelRef} className="mistake-detail" aria-label="Saved mistake detail" role={compact?'dialog':undefined} aria-modal={compact||undefined}>
      <header className="mistake-detail-head"><div><span>{gameTitle(item)}</span><h2>Move {item.move_number} · {item.side}</h2><div className="mistake-system-reasons">{item.system_reasons.map(reason=><span key={reason}>{label(reason)}</span>)}</div></div><button type="button" className="icon-button" aria-label="Close detail" onClick={onClose}>×</button></header>
      <div className="mistake-detail-tabs" ref={tabListRef} role="tablist" aria-label="Mistake detail view">{detailViews.map(view=><button key={view} type="button" role="tab" data-detail-view={view} aria-selected={activeView===view} aria-controls={`mistake-detail-${view}`} tabIndex={activeView===view?0:-1} onKeyDown={handleTabKeys} onClick={()=>onViewChange(view)}>{detailLabels[view]}</button>)}</div>
      <div className="mistake-detail-view" id={`mistake-detail-${activeView}`} role="tabpanel">
        {activeView==='study'&&<StudyView item={item} solutionRevealed={solutionRevealed} solutionRegionId={solutionRegionId} onReveal={()=>setSolutionRevealed(true)} onOpenLine={()=>setLineOpen(true)}/>} 
        {activeView==='notes'&&<NotesTagsView item={item} note={note} tags={tags} onNoteChange={setNote} onSaveNote={onSaveNote} onSaveTags={onSaveTags}/>} 
        {activeView==='history'&&<HistoryView item={item} page={historyPage} onPageChange={setHistoryPage}/>} 
      </div>
      <footer className="mistake-detail-actions">
        <div className="mistake-detail-primary-actions"><button type="button" className="primary-button" onClick={onPractice}>Practice</button><button type="button" className="text-button" onClick={onOpenGame}>Open full game</button></div>
        <div className="mistake-detail-management-actions"><button type="button" className="text-button" onClick={onLifecycle}>{item.lifecycle==='active'?'Archive':'Restore'}</button><button type="button" className="danger-button" aria-label="Delete mistake" onClick={onDelete}>Delete</button></div>
      </footer>
      <small className="mistake-saving-status" aria-live="polite">{saving?'Saving locally…':'Stored locally · full game preserved'}</small>
    </aside>
    {lineOpen&&<BestLineDialog item={item} onClose={()=>setLineOpen(false)}/>} 
  </div>
}

function StudyView({item,solutionRevealed,solutionRegionId,onReveal,onOpenLine}:{item:SavedMistake;solutionRevealed:boolean;solutionRegionId:string;onReveal:()=>void;onOpenLine:()=>void}){
  const line=item.evidence.best_line
  const preview=line.slice(0,8).join(' ')
  const boardOrientation=item.side
  const shownTags=item.tags.slice(0,4)
  return <div className="mistake-study-view">
    <div className="mistake-detail-board"><ChessBoard fen={item.decision_fen} orientation={boardOrientation}/></div>
    <div className="mistake-study-ledger"><section className="mistake-solution-card" aria-label="Mistake solution"><div id={solutionRegionId} className="mistake-solution-ledger" role={solutionRevealed?'region':undefined} aria-label={solutionRevealed?'Best move and line':undefined}><div className="mistake-verdict"><span>Played<strong>{studySan(item,item.played_move)}</strong></span><i aria-hidden="true">→</i><span>Best<strong className={solutionRevealed?undefined:'mistake-solution-hidden'}>{solutionRevealed?(studySan(item,item.best_move??'')||'Best move unavailable'):'Hidden'}</strong></span></div><div className="mistake-solution-row"><div className="mistake-line"><span>Best Line</span><p className={solutionRevealed?undefined:'mistake-solution-placeholder'}>{solutionRevealed?(studySan(item,preview)||'No stored line'):'Hidden until revealed'}</p>{solutionRevealed&&line.length>8&&<button type="button" className="text-button mistake-line-expand" onClick={onOpenLine}>View complete line</button>}</div><button type="button" className="primary-button mistake-solution-reveal" aria-expanded={solutionRevealed} aria-controls={solutionRegionId} onClick={onReveal} disabled={solutionRevealed}>{solutionRevealed?'Best Move Revealed':'Reveal Best Move'}</button></div></div></section>
      <div className="mistake-evidence-grid"><div><strong>{pct(item.cti_lower_bound)}</strong><span>CTI</span></div><div><strong>{item.objective_loss.toFixed(2)}</strong><span>pawn loss</span></div><div><strong>{item.mbi_maia_prob==null?'—':pct(item.mbi_maia_prob)}</strong><span>Maia likelihood</span></div><div><strong>{item.evidence.analysis_depth??'—'}</strong><span>analysis depth</span></div></div>
      <p className="mistake-model-note">Maia likelihood is model-estimated for White {item.evidence.maia3_white_elo} / Black {item.evidence.maia3_black_elo} Elo.</p>
      <div className="mistake-tag-summary"><span>Your tags</span><div>{shownTags.map(tag=><i key={tag}>{tag}</i>)}{item.tags.length>shownTags.length&&<i>+{item.tags.length-shownTags.length} more</i>}{!item.tags.length&&<em>None yet</em>}</div></div>
    </div>
  </div>
}

function NotesTagsView({item,note,tags,onNoteChange,onSaveNote,onSaveTags}:{item:SavedMistake;note:string;tags:string[];onNoteChange:(value:string)=>void;onSaveNote:(value:string)=>void;onSaveTags:(values:string[])=>void}){
  return <div className="mistake-notes-view"><label className="review-field"><span>Your note</span><textarea rows={5} value={note} onChange={event=>onNoteChange(event.target.value)} onBlur={()=>{if(note!==item.note)onSaveNote(note)}} placeholder="What should you notice sooner next time?" /></label><CompactTagEditor selected={item.tags} suggestions={tags} onChange={onSaveTags}/></div>
}

function CompactTagEditor({selected,suggestions,onChange}:{selected:string[];suggestions:string[];onChange:(values:string[])=>void}){
  const [value,setValue]=useState('')
  const [pickerOpen,setPickerOpen]=useState(false)
  const commit=(next:string[])=>onChange([...new Map(next.filter(Boolean).map(tag=>[tag.toLocaleLowerCase(),tag.trim()])).values()])
  const add=(tag:string)=>{const clean=tag.trim();if(!clean)return;commit([...selected,clean]);setValue('')}
  const choices=[...new Map([...selected,...suggestions].map(tag=>[tag.toLocaleLowerCase(),tag])).values()]
  const isSelected=(tag:string)=>selected.some(candidate=>candidate.toLocaleLowerCase()===tag.toLocaleLowerCase())
  const toggle=(tag:string,checked:boolean)=>commit(checked?[...selected,tag]:selected.filter(candidate=>candidate.toLocaleLowerCase()!==tag.toLocaleLowerCase()))
  return <section className="mistake-tag-editor" aria-labelledby="mistake-tags-title"><div className="mistake-tag-heading"><div><span id="mistake-tags-title">Your tags</span><small>{selected.length?`${selected.length} assigned`:'Add a study label'}</small></div><button type="button" className="text-button" aria-expanded={pickerOpen} onClick={()=>setPickerOpen(open=>!open)}>Add tag</button></div><div className="mistake-tag-tokens">{selected.length?selected.map(tag=><span key={tag}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={()=>toggle(tag,false)}>×</button></span>):<em>No tags assigned yet.</em>}</div>{pickerOpen&&<div className="mistake-tag-picker"><fieldset><legend>Choose tags</legend>{choices.map(tag=><label key={tag}><input aria-label={tag} type="checkbox" checked={isSelected(tag)} onChange={event=>toggle(tag,event.target.checked)}/><span>{tag}</span></label>)}</fieldset><form className="mistake-tag-entry" onSubmit={event=>{event.preventDefault();add(value)}}><input aria-label="Add custom tag" value={value} onChange={event=>setValue(event.target.value)} placeholder="Add a custom tag" maxLength={80}/><button type="submit" className="text-button" disabled={!value.trim()}>Add</button></form></div>}</section>
}

function HistoryView({item,page,onPageChange}:{item:SavedMistake;page:number;onPageChange:(page:number)=>void}){
  const attempts=item.attempts??[]
  const pageSize=4
  const pages=Math.ceil(attempts.length/pageSize)
  const visible=attempts.slice(page*pageSize,page*pageSize+pageSize)
  return <section className="mistake-history-view" aria-label="Practice history">{!attempts.length?<div className="mistake-history-empty"><strong>No practice attempts yet.</strong><p>Practice this position when you are ready to test your recall.</p></div>:<><div className="mistake-attempt-history">{visible.map(attempt=><p key={attempt.id}><strong>{attempt.outcome}</strong><span>{attempt.chosen_move??'No move'} · {attempt.objective_acceptable?'acceptable':'not acceptable'} · {new Date(attempt.created_at).toLocaleDateString()}</span></p>)}</div>{pages>1&&<div className="mistake-history-pagination"><button type="button" className="text-button" disabled={page===0} onClick={()=>onPageChange(page-1)}>Previous</button><span>{page+1} / {pages}</span><button type="button" className="text-button" disabled={page+1>=pages} onClick={()=>onPageChange(page+1)}>Next</button></div>}</>}</section>
}

function BestLineDialog({item,onClose}:{item:SavedMistake;onClose:()=>void}){
  return <div className="mistake-dialog-backdrop mistake-line-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="mistake-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-line-title"><span>Stored solution</span><h2 id="complete-line-title">Complete best line</h2><p className="mistake-complete-line">{studySan(item,item.evidence.best_line.join(' '))||'No stored line'}</p><div><button type="button" className="primary-button" autoFocus onClick={onClose}>Back to study</button></div></section></div>
}

function MistakePractice({queue,onExit,onOpenGame,onAssess}:{queue:SavedMistake[];onExit:()=>void;onOpenGame:(item:SavedMistake)=>void;onAssess:(id:string,move:string|null,outcome:MistakeOutcome)=>Promise<void>}){
  const [index,setIndex]=useState(0);const [phase,setPhase]=useState<'think'|'reveal'|'complete'>('think');const [move,setMove]=useState('');const [again,setAgain]=useState(0);const [understood,setUnderstood]=useState(0);const [error,setError]=useState<string|null>(null);const [confirmReveal,setConfirmReveal]=useState(false)
  const item=queue[index]
  const progress=useMemo(()=>queue.length?`${Math.min(index+1,queue.length)} / ${queue.length}`:'0 / 0',[index,queue.length])
  const assess=async(outcome:MistakeOutcome)=>{if(!item)return;setError(null);try{await onAssess(item.id,move||null,outcome);if(outcome==='again')setAgain(value=>value+1);else setUnderstood(value=>value+1);if(index+1>=queue.length)setPhase('complete');else{setIndex(value=>value+1);setMove('');setPhase('think')}}catch(value){setError(value instanceof Error?value.message:String(value))}}
  if(!item||phase==='complete')return <section className="mistake-practice-summary"><span>Practice complete</span><h1>{queue.length} positions revisited.</h1><div><strong>{again}<small>Again</small></strong><strong>{understood}<small>Understood</small></strong></div><p>No score and no streak—just a record of what deserves another look.</p><button type="button" className="primary-button" onClick={onExit}>Return to library</button></section>
  const playBoard=(from:string,to:string)=>{try{const game=new Chess(item.decision_fen);const played=game.move({from,to,promotion:'q'});if(!played)return false;setMove(played.san);return true}catch{return false}}
  const boardOrientation=item.side
  return <main className="mistake-practice"><header><button type="button" className="review-back-link" onClick={onExit}>← Mistake Library</button><span>{progress}</span></header><div className="mistake-practice-layout"><aside><ChessBoard fen={item.decision_fen} orientation={boardOrientation} interactive={phase==='think'} onMove={playBoard}/><p>Move {item.move_number} · {item.side} to decide</p></aside><section>
    {phase==='think'?<><span className="review-kicker">Think</span><h1>Find a better decision.</h1><p className="practice-spoiler-note">The played mistake, CTI verdict, Maia evidence, best move, and game continuation are hidden.</p><label className="review-field"><span>Your move (SAN)</span><input value={move} onChange={event=>setMove(event.target.value)} placeholder="Play on the board or type SAN" /></label><div className="mistake-practice-submit"><button type="button" className="primary-button" onClick={()=>{if(move)setPhase('reveal');else setConfirmReveal(true)}}>{move?'Reveal':'Reveal without move'}</button></div></>:<><span className="review-kicker">Reveal</span><h1>{move||'No submitted move'} <i>vs</i> {item.best_move??'—'}</h1><div className="practice-reveal-ledger"><div><span>Game mistake</span><strong>{item.played_move}</strong></div><div><span>Acceptable moves</span><strong>{item.evidence.good_moves.join(', ')||'—'}</strong></div><div><span>Objective loss</span><strong>{item.objective_loss.toFixed(2)} pawns</strong></div><div><span>CTI interval</span><strong>{pct(item.cti_lower_bound)}–{pct(item.cti_upper_bound)}</strong></div>{item.mbi_maia_prob!=null&&<div><span>Maia played-move likelihood</span><strong>{pct(item.mbi_maia_prob)}</strong></div>}</div><p className="mistake-practice-line">{item.evidence.best_line.join(' ')}</p><div className="mistake-practice-actions"><button type="button" className="danger-soft" onClick={()=>void assess('again')}>Again</button><button type="button" className="primary-button" onClick={()=>void assess('understood')}>Understood</button><button type="button" className="text-button" onClick={()=>void onOpenGame(item)}>Open full game</button></div></>}
    {error&&<div className="review-alert" role="alert">{error}</div>}
  </section></div>{confirmReveal&&<RevealConfirmDialog onCancel={()=>setConfirmReveal(false)} onConfirm={()=>{setConfirmReveal(false);setPhase('reveal')}}/>}</main>
}

function RevealConfirmDialog({onCancel,onConfirm}:{onCancel:()=>void;onConfirm:()=>void}){
  return <div className="mistake-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel()}}><section className="mistake-dialog" role="dialog" aria-modal="true" aria-labelledby="reveal-dialog-title" aria-describedby="reveal-dialog-description"><span>Reveal solution</span><h2 id="reveal-dialog-title">Continue without submitting a move?</h2><p id="reveal-dialog-description">The played move, engine evidence, and best continuation will become visible. This attempt will be recorded as revealed without a move only after you assess it.</p><div><button type="button" className="text-button" autoFocus onClick={onCancel}>Keep thinking</button><button type="button" className="primary-button" onClick={onConfirm}>Reveal solution</button></div></section></div>
}
