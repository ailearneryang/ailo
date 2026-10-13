import {useSyncExternalStore} from 'react';
import type {CompanionData,CompanionInput,PetPreferences} from './companion-types';
export type {PetPreferences} from './companion-types';
export const defaultPetPreferences:PetPreferences={visible:true,animated:true,name:'Ailo',style:'warm',greetings:true,celebrations:true,reminders:true,accessory:'none'};
const listeners=new Set<()=>void>();
let current={...defaultPetPreferences},data:CompanionData|null=null,owner='',epoch=0,error='',stop:(()=>void)|undefined,dayTimer:ReturnType<typeof setTimeout>|undefined;
function watchDay(){if(dayTimer)clearTimeout(dayTimer);const next=new Date();next.setHours(24,0,1,0);dayTimer=setTimeout(()=>{void refreshCompanion();watchDay();},next.getTime()-Date.now());}
window.addEventListener('focus',()=>{void refreshCompanion();});
function notify(){listeners.forEach(fn=>fn());}
function apply(value:CompanionData,generation:number){if(generation!==epoch||value.owner!==owner)return;data=value;current=value.record.preferences;error='';notify();}
export async function initializeCompanion(account:string){
  const generation=++epoch;owner=account;data=null;current={...defaultPetPreferences};error='';interaction=null;if(timer)clearTimeout(timer);stop?.();if(dayTimer)clearTimeout(dayTimer);notify();
  if(!window.ailo?.companionRead){error='陪伴档案尚未连接，请重新启动 Ailo。';notify();return;}
  stop=window.ailo.onCompanionChanged(changed=>{if(changed===owner)void refreshCompanion();});
  try{
    const result=await window.ailo.companionRead(account);apply(result,generation);if(generation===epoch)watchDay();
    // Migrate the former local-only appearance once, bound to the current account.
    let legacy:string|null=null,migrated=false;try{legacy=localStorage.getItem('ailo-pet-v1');migrated=!!localStorage.getItem('ailo-pet-migrated-owner');}catch{}
    if(legacy&&!migrated){
      let old:Partial<PetPreferences>;try{old=JSON.parse(legacy);if(!old||typeof old!=='object')old={};}catch{old={};}
      if(generation===epoch){const value={...result.record.preferences,visible:typeof old.visible==='boolean'?old.visible:true,animated:typeof old.animated==='boolean'?old.animated:true,name:typeof old.name==='string'&&old.name.trim()?old.name.trim().slice(0,20):'Ailo'};apply(await window.ailo.companionUpdate(account,{action:'preferences',value}),generation);try{localStorage.setItem('ailo-pet-migrated-owner',account);}catch{}}
    }
  }catch(e){if(generation===epoch){error=e instanceof Error?e.message:'陪伴档案读取失败';notify();}}
}
export async function refreshCompanion(){const generation=epoch,key=owner;if(!key||!window.ailo?.companionRead)return;try{apply(await window.ailo.companionRead(key),generation);}catch(e){if(generation===epoch){error=e instanceof Error?e.message:'陪伴记录读取失败';notify();}}}
export async function updateCompanion(input:CompanionInput){const generation=epoch,key=owner;if(!key||!data)throw Error('陪伴档案尚未加载，请稍后重试');const result=await window.ailo.companionUpdate(key,input);if(generation!==epoch)throw Error('账号已切换');apply(result,generation);return result;}
export async function setPetPreferences(value:PetPreferences){try{await updateCompanion({action:'preferences',value});return true;}catch{return false;}}
function subscribe(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};}
export function usePetPreferences(){return useSyncExternalStore(subscribe,()=>current);}
export function useCompanion(){return useSyncExternalStore(subscribe,()=>data);}
export function useCompanionError(){return useSyncExternalStore(subscribe,()=>error);}
let interaction:{kind:'pat'|'feed'|'play';at:number}|null=null;let timer:ReturnType<typeof setTimeout>|undefined;
export async function interact(kind:'pat'|'feed'|'play'){
  await updateCompanion({action:'interaction',kind});interaction={kind,at:Date.now()};notify();if(timer)clearTimeout(timer);timer=setTimeout(()=>{interaction=null;notify();},2000);
}
export function usePetInteraction(){return useSyncExternalStore(subscribe,()=>interaction);}
