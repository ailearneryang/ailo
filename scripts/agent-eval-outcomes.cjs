// Independent, bounded post-task checks. These do not alter task acceptance.
const fs=require('node:fs/promises'),path=require('node:path');
function inventory(text,controlText){text=String(text);const m=text.match(/(?:库存|剩余|数量|件数|stock)\s*(?:数量\s*)?[:：]?\s*(-?\d+)/i);if(m)return Number(m[1]);const numbers=(controlText?text.replace(controlText,''):text).match(/-?\d+/g)||[];return numbers.length===1?Number(numbers[0]):null;}
async function webChecks({fixture,workspace,browser,signal}={}){
 if(!['single-ui-repair','live-material-amendment'].includes(fixture.id))return [];
 const checks=[],captures=[],add=(check,passed)=>checks.push({check,passed:passed===true});
 try{
  const open=await browser.execute(workspace,{action:'browser',operation:'open',path:'index.html',width:800,height:600},signal);captures.push(open);
  add('independent current-page runtime has no missing assets/errors',!open.errors?.length&&!open.dom?.missingImages?.length);
  const text=open.dom?.text||'',control=open.dom?.controls?.find(c=>c.tag==='BUTTON'&&(fixture.id==='single-ui-repair'?/加|\+/.test(c.text):/减|−|-/.test(c.text))),selector=control?.id&&/^[a-zA-Z_][\w-]*$/.test(control.id)?'#'+control.id:'button';
  add('required real button exists in page DOM',!!control);
  if(fixture.id==='single-ui-repair'){
   const before=await browser.execute(workspace,{action:'browser',operation:'inspect',selector},signal);captures.push(before);add('counter button is fully inside the requested viewport',before.scope?.kind==='element');
   const after=await browser.execute(workspace,{action:'browser',operation:'click',selector},signal);captures.push(after);
   add('real counter interaction changes 0 to 1',/(?:^|\D)0(?:\D|$)/.test(text)&&/(?:^|\D)1(?:\D|$)/.test(after.dom?.text||''));
  }else{
   add('new attached product name is rendered',text.includes('茶杯'));add('initial stock is exactly 3',inventory(text,control?.text)===3);
   for(let i=0;i<4;i++){const result=await browser.execute(workspace,{action:'browser',operation:'click',selector},signal);captures.push(result);add('independent decrement '+(i+1)+' has actual expected stock',inventory(result.dom?.text,control?.text)===Math.max(0,2-i));if(i>=2)add('zero-stock warning remains visible '+i,(result.dom?.text||'').includes('库存不足'));}
  }
 }catch(error){add('independent runtime and interaction checks completed',false);checks.at(-1).reason=String(error.message).slice(0,1000);}
 finally{browser.close(workspace);}
 return {checks,captures};
}
async function persistWeb(input,{trial}={}){const result=await webChecks(input);if(Array.isArray(result))return result;await fs.writeFile(path.join(trial,'independent-web-checks.json'),JSON.stringify(result,null,2),{mode:0o600});return result.checks;}
module.exports={inventory,webChecks,persistWeb};
