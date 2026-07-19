import { useCallback, useEffect, useRef, useState } from 'react'

import {
  addMistakeAttempt, deleteMistake, getMistake, listMistakes, listMistakeTags,
  patchMistake, replaceMistakeTags,
} from '../api/mistakes'
import type { MistakeOutcome, MistakeQuery, MistakeTag, SavedMistake } from '../types/mistakes'

export const initialMistakeQuery: MistakeQuery = {
  query:'',player_name:'',side:'',reason:'',tag:'',lifecycle:'active',practice_state:'',page:1,page_size:25,
}

export function useMistakeLibrary() {
  const [query,setQueryState]=useState(initialMistakeQuery)
  const [items,setItems]=useState<SavedMistake[]>([])
  const [total,setTotal]=useState(0)
  const [tags,setTags]=useState<MistakeTag[]>([])
  const [detail,setDetail]=useState<SavedMistake|null>(null)
  const [selected,setSelected]=useState<Set<string>>(new Set())
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const requestRef=useRef(0)

  const refresh=useCallback(async()=>{
    const token=++requestRef.current;setLoading(true);setError(null)
    try{
      const [result,tagResult]=await Promise.all([listMistakes(query),listMistakeTags()])
      if(token!==requestRef.current)return
      setItems(result.items);setTotal(result.total);setTags(tagResult.items)
      setDetail(current=>current&&!result.items.some(item=>item.id===current.id)?null:current)
    }catch(value){if(token===requestRef.current)setError(value instanceof Error?value.message:String(value))}
    finally{if(token===requestRef.current)setLoading(false)}
  },[query])
  useEffect(()=>{const timer=window.setTimeout(()=>void refresh(),query.query||query.player_name?280:0);return()=>window.clearTimeout(timer)},[query.query,query.player_name,refresh])

  const setQuery=(changes:Partial<MistakeQuery>)=>setQueryState(current=>({...current,...changes,page:changes.page??(Object.keys(changes).some(key=>key!=='page')?1:current.page)}))
  const openDetail=async(id:string)=>{setError(null);try{setDetail(await getMistake(id))}catch(value){setError(value instanceof Error?value.message:String(value))}}
  const toggleSelected=(id:string)=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})
  const update=async(changes:Partial<Pick<SavedMistake,'note'|'lifecycle'>>)=>{if(!detail)return;setSaving(true);try{const next=await patchMistake(detail.id,changes);setDetail(next);await refresh()}finally{setSaving(false)}}
  const saveTags=async(names:string[])=>{if(!detail)return;setSaving(true);try{const next=await replaceMistakeTags(detail.id,names);setDetail(next);await refresh()}finally{setSaving(false)}}
  const remove=async()=>{if(!detail)return;setSaving(true);try{await deleteMistake(detail.id);setDetail(null);await refresh()}finally{setSaving(false)}}
  const assess=async(id:string,chosenMove:string|null,outcome:MistakeOutcome)=>{setSaving(true);try{await addMistakeAttempt(id,chosenMove,outcome);if(detail?.id===id)setDetail(await getMistake(id));await refresh()}finally{setSaving(false)}}
  return {query,items,total,tags,detail,selected,loading,saving,error,setQuery,refresh,openDetail,closeDetail:()=>setDetail(null),toggleSelected,clearSelected:()=>setSelected(new Set()),update,saveTags,remove,assess}
}
