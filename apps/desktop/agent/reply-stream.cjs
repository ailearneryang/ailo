// Progressive preview of a reply's text while its tool-call arguments are still
// streaming. The preview is display-only: the runner still decodes and
// validates the complete action before anything is recorded or executed.
const escapes={n:'\n',t:'\t',r:'\r',b:'\b',f:'\f','"':'"','\\':'\\','/':'/'};
const replyNames=new Set(['reply','functions.reply']);
const menuNames=new Set(['ailo_action','functions.ailo_action']);
const actionPattern=/"action"\s*:\s*"([a-z_]*)"?/;

// Decode the prefix of a JSON string body (text after the opening quote).
// Stops at the closing quote or at an incomplete escape sequence.
function decodePartialString(body){
 let out='';
 for(let i=0;i<body.length;i++){
  const c=body[i];
  if(c==='"')return {text:out,closed:true};
  if(c!=='\\'){out+=c;continue;}
  if(i+1>=body.length)break;
  const next=body[i+1];
  if(next==='u'){
   if(i+5>=body.length)break;
   const hex=body.slice(i+2,i+6);
   if(!/^[0-9a-fA-F]{4}$/.test(hex))break;
   out+=String.fromCharCode(parseInt(hex,16));i+=5;continue;
  }
  out+=escapes[next]??next;i++;
 }
 return {text:out,closed:false};
}

// Returns the visible text so far when the streaming call is a reply, '' when it
// is a reply without text yet, and undefined when the call is not a reply.
function replyText(name,args){
 if(typeof args!=='string'||!args)return undefined;
 const tool=String(name||'');
 if(menuNames.has(tool)){
  const action=actionPattern.exec(args);
  if(!action)return undefined;
  if(action[1]!=='reply'){
   // Still streaming the action name: only a prefix of "reply" keeps it open.
   if(args.endsWith(action[0])&&!/"$/.test(action[0])&&'reply'.startsWith(action[1]))return '';
   return undefined;
  }
 } else if(!replyNames.has(tool)) return undefined;
 const start=/"text"\s*:\s*"/.exec(args);
 if(!start)return '';
 return decodePartialString(args.slice(start.index+start[0].length)).text;
}

module.exports={replyText,decodePartialString};
