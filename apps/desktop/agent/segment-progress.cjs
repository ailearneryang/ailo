// Tool aliases and repeated overlapping pages do not create new progress.
function newCoverage(before,after){
 const group=r=>JSON.stringify([r.path||r.id,r.entry,r.pointer,r.sha256]);
 const previous=new Map();for(const r of before||[]){const k=group(r);previous.set(k,[...(previous.get(k)||[]),r]);}
 let count=0;for(const r of after||[]){const k=group(r),rows=previous.get(k)||[];
  let covered=rows.length>0;
  if(Number.isInteger(r.offset)&&Number.isInteger(r.end)){let cursor=r.offset;for(const p of rows.filter(p=>Number.isInteger(p.offset)&&Number.isInteger(p.end)).sort((a,b)=>a.offset-b.offset)){if(p.offset>cursor)break;cursor=Math.max(cursor,p.end);if(cursor>=r.end)break;}covered=rows.length>0&&cursor>=r.end;}
  if(!covered)count++;previous.set(k,[...rows,r]);
 }return count;
}
const decision=(result,options)=>require('./recovery-control.cjs').segmentDecision(result,options);
module.exports={newCoverage,decision};
