async function inspect(workspace,files){
 const run=workspace.run,rows=require('./problem-state.cjs').rows(run),prior=new Map((run.inputTurn?.problemBaseline||[]).map(p=>[p.id,p.status]));
 const resolved=rows.filter(p=>p.status==='resolved'&&prior.get(p.id)!=='resolved'),dismissed=rows.filter(p=>p.status==='dismissed'&&prior.get(p.id)!=='dismissed'),pending=rows.filter(p=>!p.optional&&!['resolved','dismissed'].includes(p.status)),optional=rows.filter(p=>p.optional&&!['resolved','dismissed'].includes(p.status));
 const apk=files.find(f=>/\.apk$/i.test(f.path));
 let build,install,shot,buildCurrent=false;
 if(apk){
  const matches=e=>e.type==='build_android'&&e.detail.result?.exitCode===0&&e.detail.result?.buildArtifacts?.some(a=>a.path===apk.path&&a.sha256===apk.sha256);
  build=(run.events||[]).findLast(matches)||await workspace.findEvent?.(matches);
  if(build)try{await require('./evidence.cjs').event(workspace,build.id);buildCurrent=true;}catch{}
  const installed=e=>e.type==='android_device'&&e.detail.operation==='install'&&e.detail.result?.installed&&e.detail.result?.apkSha256===apk.sha256;
  install=(run.events||[]).findLast(installed)||await workspace.findEvent?.(installed);
  const captured=e=>e.type==='android_device'&&e.detail.operation==='screenshot'&&e.detail.result?.apkSha256===apk.sha256&&!!e.detail.result?.pixelSize;
  shot=(run.events||[]).findLast(captured)||await workspace.findEvent?.(captured);
 }
 const observed=apk&&(run.visualObservations||[]).some(o=>o.delivered&&(o.modelReviews?.length||Object.values(run.designRegionReviews||{}).some(r=>r.evidenceId===o.eventId))&&(o.designBinding?.apkSha256===apk.sha256||o.sources?.some(s=>s.path===apk.path&&s.sha256===apk.sha256)));
 return {optionalProblemIds:optional.map(p=>p.id),qualityCoverage:require('./acceptance.cjs').qualitySummary(run),resolvedProblemIds:resolved.map(p=>p.id),dismissedProblemIds:dismissed.map(p=>p.id),pendingProblemIds:pending.map(p=>p.id),resolvedDescriptions:resolved.map(p=>p.description),apk:apk?{path:apk.path,sha256:apk.sha256,changed:run.inputTurn?.artifacts?.[apk.path]!==apk.sha256,buildEvidenceId:build?.id,buildCurrent,installEvidenceId:install?.id,screenshotEvidenceId:shot?.id,hasVisualReview:!!observed}:undefined};
}
module.exports={inspect};
