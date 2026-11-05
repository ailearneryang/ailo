const {hash}=require('./evidence.cjs');
function sources(o){const rows=[...(o.sources||[]),...(o.path&&o.sha256?[{path:o.path,sha256:o.sha256}]:[]),...(o.reference?.sha256?[{path:o.reference.path,sha256:o.reference.sha256}]:[])];const seen=new Set();return rows.filter(s=>{const key=JSON.stringify([s.path,s.sha256]);if(seen.has(key))return false;seen.add(key);return true;});}
function capture(o,at){const rows=sources(o),apk=rows.find(s=>/\.apk$/i.test(s.path)&&(!o.designBinding?.apkSha256||s.sha256===o.designBinding.apkSha256));return {eventId:o.eventId,revision:o.revision,at,image:o.path&&o.sha256?{path:o.path,sha256:o.sha256}:undefined,reference:o.reference,apk:apk?{path:apk.path,sha256:apk.sha256}:undefined,sourceSetHash:rows.length?hash(JSON.stringify(rows.slice().sort((a,b)=>a.path.localeCompare(b.path)||String(a.sha256).localeCompare(String(b.sha256))))):undefined,sourceCount:rows.length,presentationHash:hash(JSON.stringify([o.sha256,o.transform?.crop||null,o.pixelSize||null]))};}
function canConfirm(prior,o){
 if(prior?.certainty!=='suspected')return true;
 const version=capture(o);
 return o.eventId!==prior.evidenceId&&(prior.findingVersion?version.presentationHash!==prior.findingVersion.presentationHash:o.sha256!==prior.sha256||!!o.transform?.crop)&&!!o.sources?.length;
}
module.exports={sources,capture,canConfirm};
