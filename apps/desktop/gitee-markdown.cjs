// Gitee's gist API returns 500 for supplementary Unicode characters (including
// many emoji). Numeric HTML references preserve their Markdown preview without
// sending those characters to the endpoint. Keep code readable and copyable by
// using HTML code elements where Markdown code would display the references.
const supplementary=/[\u{10000}-\u{10ffff}]/u;
const entities=text=>text.replace(/[\u{10000}-\u{10ffff}]/gu,char=>`&#x${char.codePointAt(0).toString(16)};`);
const html=text=>entities(text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
function inline(text){
 let result='',offset=0;
 while(offset<text.length){
  const start=text.indexOf('`',offset);
  if(start<0)return result+entities(text.slice(offset));
  // Escaped backticks are ordinary text, not code delimiters.
  let slashes=0;for(let i=start-1;i>=0&&text[i]==='\\';i--)slashes++;
  if(slashes%2){result+=entities(text.slice(offset,start+1));offset=start+1;continue;}
  const ticks=/^`+/.exec(text.slice(start))[0];
  let end=start+ticks.length,found=-1;
  while(end<text.length){const next=text.indexOf('`',end);if(next<0)break;const run=/^`+/.exec(text.slice(next))[0];if(run.length===ticks.length){found=next;break;}end=next+run.length;}
  if(found<0)return result+entities(text.slice(offset));
  const code=text.slice(start+ticks.length,found);
  result+=entities(text.slice(offset,start));
  if(supplementary.test(code)){let normalized=code.replace(/\r\n?|\n/g,' ');if(/^ .* $/.test(normalized)&&/[^ ]/.test(normalized))normalized=normalized.slice(1,-1);result+=`<code>${html(normalized)}</code>`;}
  else result+=text.slice(start,found+ticks.length);
  offset=found+ticks.length;
 }
 return result;
}
function giteeMarkdown(content){
 if(!supplementary.test(content))return content;
 const lines=content.match(/[^\n]*\n|[^\n]+$/g)||[];let result='',plain='';
 for(let i=0;i<lines.length;i++){
  const open=/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/.exec(lines[i]);
  if(!open){plain+=lines[i];continue;}
  result+=inline(plain);plain='';
  const close=new RegExp('^ {0,3}'+open[1][0]+'{'+open[1].length+',}[^\\S\\r\\n]*\\r?\\n?$');
  let j=i+1;while(j<lines.length&&!close.test(lines[j]))j++;
  const body=lines.slice(i+1,j).join('');
  if(supplementary.test(body))result+=`\n<pre><code>${html(body)}</code></pre>\n\n`;
  else result+=lines.slice(i,Math.min(j+1,lines.length)).join('');
  i=j;
 }
 return result+inline(plain);
}
module.exports={giteeMarkdown};
