// Only complete HTML documents become viewable outputs; examples and fragments stay code.
function documentHtml(value){
 const text=String(value||'').trim();
 const full=/<body\b/i.test(text)&&/<\/body\s*>/i.test(text)&&/<\/html\s*>\s*$/i.test(text);
 const fragment=/<meta\b/i.test(text)&&/<title\b[^>]*>[\s\S]*?<\/title>/i.test(text)&&/<style\b[^>]*>[\s\S]*?<\/style>/i.test(text)&&/<(?:main|article|section|div)\b/i.test(text)&&/<\/(?:main|article|section|div)>\s*$/i.test(text);
 return text.length<=1000000&&(full||fragment)?text:undefined;
}
function replyHtml(content){
 const out=[];for(const match of String(content||'').matchAll(/^```(?:html)?\s*\n([\s\S]*?)^```[ \t]*$/gim)){const html=documentHtml(match[1]);if(html)out.push(html);}
 if(!out.length){const html=documentHtml(content);if(html&&/^\s*(?:<!doctype html[^>]*>\s*)?<html\b/i.test(html))out.push(html);}
 return out;
}
module.exports={documentHtml,replyHtml};
