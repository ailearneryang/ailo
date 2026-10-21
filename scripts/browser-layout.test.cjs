const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {snapshotDOM}=require('../apps/desktop/agent/browser-observer.cjs');
function box(left,top,width,height){return {x:left,y:top,left,top,right:left+width,bottom:top+height,width,height};}
async function observe({scroll=false,negative=false,nested=false,axis=false,hidden=false,images=[]}={}){
 const style=(x='visible',y=x)=>({overflow:x===y?x:x+' '+y,overflowX:x,overflowY:y,visibility:'visible',display:'block',opacity:'1'});
 const element=(rect,css,parent)=>({tagName:'DIV',id:'',parentElement:parent,css,getBoundingClientRect:()=>rect,getAttribute:k=>hidden&&k==='aria-hidden'?'true':null,matches:()=>false,scrollLeft:0,scrollTop:0,scrollWidth:200,clientWidth:200,scrollHeight:1500,clientHeight:100});
 const body=element(box(0,0,800,1800),style(),null),outer=element(box(0,0,200,140),style('hidden'),body);
 const port=element(box(0,0,200,100),axis?style('visible','clip'):style(scroll?'auto':'hidden'),nested?outer:body);
 const nodes=Array.from({length:50},(_,i)=>({textContent:'Row '+i,parentElement:port,bounds:box(negative?-10000:axis?1000:0,axis?0:i*30,80,20)}));
 const elements=[body,...(nested?[outer]:[]),port];body.textContent=nodes.map(n=>n.textContent).join(' ');body.innerText=body.textContent;
 const context={location:{href:'ailo-project://local/index.html'},document:{images,fonts:{ready:Promise.resolve()},body,title:'Fixture',documentElement:{scrollWidth:800,scrollHeight:1800},querySelectorAll:()=>elements,querySelector:()=>port,createTreeWalker:()=>{let i=0;return {nextNode:()=>nodes[i++]||null};},createRange:()=>{let n;return {selectNodeContents:value=>{n=value;},getBoundingClientRect:()=>n.bounds};}},NodeFilter:{SHOW_TEXT:4},getComputedStyle:e=>e.css,requestAnimationFrame:callback=>callback(),innerWidth:800,innerHeight:600,scrollX:0,scrollY:0};
 return vm.runInNewContext('('+snapshotDOM.toString()+')(null)',context);
}
test('scrollable text remains reachable even inside an outer clipping container',async()=>{
 for(const nested of [false,true]){const d=await observe({scroll:true,nested});assert.equal(d.layoutHealth.clippedTextNodes,0);assert.ok(d.layoutHealth.scrollableTextNodes>40);assert.equal(d.layoutHealth.scope,'document');}
});
test('fixed-container clipping and unreachable negative scroll positions are defects',async()=>{
 assert.ok((await observe()).layoutHealth.clippedTextNodes>40);
 assert.equal((await observe({scroll:true,negative:true})).layoutHealth.clippedTextNodes,50);
});
test('clipping is checked per axis and intentionally hidden text is excluded',async()=>{
 assert.equal((await observe({axis:true})).layoutHealth.clippedTextNodes,0);
 assert.equal((await observe({hidden:true})).layoutHealth.textNodes,0);
});

test('pending lazy images are distinct from failed resources and every image has a load receipt',async()=>{
 const image=(src,complete,naturalWidth)=>({complete,naturalWidth,getAttribute:()=>src});
 const d=await observe({images:[image('lazy.png',false,0),image('ok.png',true,100),image('broken.png',true,0)]});
 assert.deepEqual(Array.from(d.missingImages),['broken.png']);
 assert.deepEqual(Array.from(d.imageHealth.items,i=>i.status),['pending','loaded','failed']);
 assert.equal(d.imageHealth.total,3);assert.equal(d.imageHealth.truncated,false);
});
