import { useSyncExternalStore } from 'react';
export type PetPreferences = { visible: boolean; animated: boolean; name: string };
export const defaultPetPreferences: PetPreferences = { visible: true, animated: true, name: 'Ailo' };
const key = 'ailo-pet-v1';
function read(): PetPreferences {
  try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return { visible: typeof value.visible === 'boolean' ? value.visible : true, animated: typeof value.animated === 'boolean' ? value.animated : true, name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 20) : 'Ailo' }; }
  catch { return { ...defaultPetPreferences }; }
}
let current = read();
const listeners = new Set<() => void>();
function notify() { listeners.forEach(listener => listener()); }
window.addEventListener('storage', event => { if (event.key === key || event.key === null) { current = read(); notify(); } });
export function setPetPreferences(value: PetPreferences) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { return false; }
  current = { ...value }; notify(); return true;
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function usePetPreferences() { return useSyncExternalStore(subscribe, () => current); }
