// Same independent checks for BOTH versions. No model calls and no grading by
// file-presence alone. Visual/semantic rubrics still need a human decision.
const {app,protocol,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {cases}=require('./agent-eval-cases.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'ailo-project',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);app.on('window-all-closed',()=>{});
const directory=path.resolve(process.argv[2]||'.local/evals/iteration-20261020');
const profile=path.join(directory,'electron-profiles','grade-'+process.pid);require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
app.whenReady().then(async()=>{
 let browser;
 try{
  let lastWindow;
  class TestWindow extends BrowserWindow{constructor(options){super(options);lastWindow=this;}}
  browser=require('../apps/desktop/agent/browser-observer.cjs').createBrowserObserver({BrowserWindow:TestWindow,session});
  for(const version of ['baseline','candidate'])for(const fixture of cases)for(let repeat=1;repeat<=3;repeat++){
   const trial=path.join(directory,version,fixture.id+'-'+repeat),file=path.join(trial,'result.json');let result;
   try{result=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
   if(result.externalChecks&&result.externalChecksVersion===2)continue;
   const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(path.join(trial,'workspace'),{id:'eval',projectId:'eval'}),checks=[],evidence=[];
   const check=(name,passed,detail)=>checks.push({check:name,passed:!!passed,...(detail?{detail}:{})});
   try{
    if(['web','document'].includes(fixture.category)){
     const name=fixture.outputs.find(p=>p.endsWith('.html')),width=fixture.id==='document-repair'?1000:800;
     const observed=await browser.execute(w,{operation:'open',path:name,width,height:fixture.category==='document'?800:600},new AbortController().signal);
     const capture=async(label,observation)=>{const dst=label+'.png';await fs.copyFile(path.join(w.files,observation.screenshot),path.join(trial,dst));evidence.push({label,path:dst,scope:observation.scope,dom:observation.dom});};
     await capture('independent-before',observed);
     check('no missing images or runtime errors',!observed.errors.length&&!observed.dom.missingImages.length);
     if(fixture.category==='web'){
      const initial=fixture.id==='web-normal'?'3':'0',expected=fixture.id==='web-normal'?'2':'1';
      const numericSnapshot=`(()=>{const values=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.parentElement.closest('button,input,select,textarea,script,style'))continue;const range=document.createRange();range.selectNodeContents(n);const r=range.getBoundingClientRect();if(!r.width||!r.height||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)continue;const css=getComputedStyle(n.parentElement);if(css.visibility==='hidden'||css.display==='none'||css.opacity==='0')continue;for(const x of n.textContent.match(/-?\\d+/g)||[])values.push(Number(x));}return values;})()`;
      const beforeNumbers=await lastWindow.webContents.executeJavaScript(numericSnapshot);
      check('initial state visible',beforeNumbers.includes(Number(initial)));
      const clicked=await lastWindow.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>${JSON.stringify(fixture.id==='web-normal'?'减':'加')}==='减'?/减|[-−]/.test(e.textContent):/加|[+＋]/.test(e.textContent));if(!b)return false;const r=b.getBoundingClientRect();if(r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight)return false;b.click();return true;})()`);
      check('required control visible and clickable',clicked);
      const after=await browser.execute(w,{operation:'inspect'},new AbortController().signal);await capture('independent-after',after);
      const afterNumbers=await lastWindow.webContents.executeJavaScript(numericSnapshot),count=(xs,n)=>xs.filter(x=>x===Number(n)).length;
      check('required numeric transition visible',clicked&&count(afterNumbers,expected)>count(beforeNumbers,expected)&&count(afterNumbers,initial)<count(beforeNumbers,initial));
     }else if(fixture.id==='document-normal'){
      const pdf=await lastWindow.webContents.printToPDF({pageSize:'A4',printBackground:true,preferCSSPageSize:true});const pdfPath=path.join(trial,'independent-print.pdf');await fs.writeFile(pdfPath,pdf);
      const parsed=await require('../apps/desktop/document-parser.cjs').parseDocument(pdfPath,'report.pdf');
      check('exactly two printed pages',parsed.segments.length===2,'实际打印页数：'+parsed.segments.length);
      const text=parsed.text.replace(/\s+/g,'');
      check('all trial counts retained',['20','16','10','9'].every(n=>text.includes(n)));
      check('sample limitation disclosed',/样本|推断|总体/.test(text));check('action owners retained',text.includes('林')&&text.includes('周'));
      check('conclusion and table on first page',/20/.test(parsed.segments[0]?.text||'')&&/16/.test(parsed.segments[0]?.text||''));
      check('action owners on second page',/林/.test(parsed.segments[1]?.text||'')&&/周/.test(parsed.segments[1]?.text||''));
     }else{
      check('all values visible',['120','90','80','100'].every(n=>observed.dom.visibleText.includes(n)));
      check('owners visible',observed.dom.visibleText.includes('林')&&observed.dom.visibleText.includes('周'));
      const geometry=await lastWindow.webContents.executeJavaScript(`(()=>{const cells=[...document.querySelectorAll('td,th')];return cells.length>0&&cells.every(e=>{const r=e.getBoundingClientRect();if(r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight)return false;for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),q=p.getBoundingClientRect();if(/hidden|clip/.test(c.overflow+c.overflowX+c.overflowY)&&(r.left<q.left||r.right>q.right||r.top<q.top||r.bottom>q.bottom))return false;}return true;});})()`);
      check('table cells inside viewport and unclipped',geometry);
     }
    }else if(fixture.category==='code'){
     const command=`python3 -B -c 'from ranges import merge_ranges; x=[[4,4],[1,2],[2,3],[8,9],[8,10]]; assert merge_ranges(x)==[[1,3],[4,4],[8,10]]; assert x==[[4,4],[1,2],[2,3],[8,9],[8,10]]; assert merge_ranges([])==[]; assert merge_ranges([[-3,-1],[-1,0]])==[[-3,0]]; print("PASS")'`;
     const r=await require('../apps/desktop/agent/tools.cjs').runCommand(w.files,command,new AbortController().signal,10000,{networkOutbound:false});check('independent edge and immutability checks',r.exitCode===0,r.output);
    }else if(fixture.id==='data-repair'){
     const root=path.join(trial,'independent-data');await fs.mkdir(root,{recursive:true});await fs.copyFile(path.join(w.files,'aggregate.py'),path.join(root,'aggregate.py'));await fs.writeFile(path.join(root,'sales.csv'),'id,region,amount,status\n');
     const r=await require('../apps/desktop/agent/tools.cjs').runCommand(root,'python3 -B aggregate.py',new AbortController().signal,10000,{networkOutbound:false});
     let parsed;try{parsed=JSON.parse(await fs.readFile(path.join(root,'result.json'),'utf8'));}catch{}
     check('empty-input aggregation succeeds',r.exitCode===0&&parsed?.total==='0.00',r.output);
    }
   }catch(e){check('independent grading completed',false,e.message);}finally{browser.close(w);}
   result.externalChecks=checks;result.externalChecksVersion=2;result.externalEvidence=evidence;await fs.writeFile(file,JSON.stringify(result,null,2),{mode:0o600});
   console.log(version,fixture.id,repeat,checks.every(c=>c.passed)?'CHECKS PASS':'CHECKS FAIL');
  }
  app.exit(0);
 }catch(e){console.error(e.message);app.exit(1);}finally{browser?.dispose();}
});
