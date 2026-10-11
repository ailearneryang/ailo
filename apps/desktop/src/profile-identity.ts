export function profileInitials(name:string){
  const parts=name.trim().split(/\s+/);
  return (parts.length>1?parts.slice(0,2).map(part=>Array.from(part)[0]).join(''):Array.from(name).slice(0,2).join('')).toUpperCase();
}
