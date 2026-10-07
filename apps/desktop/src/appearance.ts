export type Appearance={mode:'system'|'light'|'dark';preset:'warm'|'neutral'|'forest';fontSize:'small'|'standard'|'large';background:'solid'|'gradient'};
export const defaultAppearance:Appearance={mode:'system',preset:'warm',fontSize:'standard',background:'solid'};
const storageKey='ailo-appearance-v1';
function read():Appearance{try{const v=JSON.parse(localStorage.getItem(storageKey)||'{}');return {mode:['system','light','dark'].includes(v.mode)?v.mode:'system',preset:['warm','neutral','forest'].includes(v.preset)?v.preset:'warm',fontSize:['small','standard','large'].includes(v.fontSize)?v.fontSize:'standard',background:['solid','gradient'].includes(v.background)?v.background:'solid'};}catch{return {...defaultAppearance};}}
let current=read();const media=window.matchMedia('(prefers-color-scheme: dark)');
function apply(){const root=document.documentElement;root.dataset.mode=current.mode==='system'?(media.matches?'dark':'light'):current.mode;root.dataset.preset=current.preset;root.dataset.background=current.background;root.dataset.fontSize=current.fontSize;root.style.setProperty('--font-scale',current.fontSize==='small'?'0.92':current.fontSize==='large'?'1.12':'1');root.style.colorScheme=root.dataset.mode;}
export function getAppearance(){return {...current};}
export function setAppearance(value:Appearance){try{localStorage.setItem(storageKey,JSON.stringify(value));}catch{return false;}current={...value};apply();window.dispatchEvent(new Event('ailo-appearance-change'));return true;}
media.addEventListener('change',()=>{if(current.mode==='system')apply();});
window.addEventListener('storage',e=>{if(e.key===storageKey){current=read();apply();window.dispatchEvent(new Event('ailo-appearance-change'));}});
apply();
