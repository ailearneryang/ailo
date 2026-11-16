// Deliberately narrow shell grammar. Never infer safety from a model's label.
function isReadOnly(command){
 if(typeof command!=='string'||!command.trim()||command.length>20000)return false;
 const text=command.replace(/2>\/dev\/null\b|2>&1/g,' ');
 let words=[],word='',quote='',started=false,segments=[];
 const flush=()=>{if(started){words.push(word);word='';started=false;}};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quote){if(c===quote){quote='';continue;}if(quote==='"'&&/[\$`\\]/.test(c))return false;word+=c;continue;}
  if(c==='\''||c==='"'){quote=c;started=true;continue;}
  if(/[\$`\\<>(){}&>]/.test(c))return false;
  if(c===';'||c==='|'||c==='\n'){flush();if(!words.length)return false;segments.push(words);words=[];continue;}
  if(/\s/.test(c)){flush();continue;}word+=c;started=true;
 }
 if(quote)return false;flush();if(words.length)segments.push(words);else return false;
 return segments.length>0&&segments.every(([program,...args])=>{
  if(!/^(?:(?:\/usr)?\/bin\/)?(?:du|df|ls|echo|head|sort)$/.test(program))return false;
  const name=program.split('/').pop();
  if(name==='sort')return args.every(a=>/^-[rhn]+$/.test(a)); // Reject -o and all file output forms.
  if(name==='head')return args.every(a=>/^-\d+$|^-n$|^\d+$/.test(a));
  return true;
 });
}
module.exports={isReadOnly};
