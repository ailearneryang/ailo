import type {AgentRun} from './types';
export function deliveryStatus(run:AgentRun){
 const unverified=run.delivery?.unverified?.length||run.completionReview?.unverified?.length||0;
 const criteria=run.acceptanceCriteria||[];
 const coverage=run.delivery?.coverage||{passed:criteria.filter(c=>c.status==='passed').length,total:criteria.length};
 const counts=coverage.total?`原要求检查 ${coverage.passed}/${coverage.total} 项通过；不表示效果评分。`:'';
 if(run.status==='completed'&&run.delivery?.outcome!=='limited'&&run.delivery?.outcome!=='partial'&&run.delivery?.outcome!=='blocked'&&!unverified&&criteria.every(c=>c.status==='passed'))return {tone:'complete',icon:'✓',label:'完整完成',description:'原任务已完成。'+counts};
 if(run.delivery?.outcome==='limited')return {tone:'limited',icon:'◕',label:'已交付 · 有待确认',description:'成果已交付，仍有明确限制或未核验项。'+counts};
 if(run.delivery?.outcome==='partial')return {tone:'partial',icon:'◐',label:coverage.total>0&&coverage.passed/coverage.total>=.8?'大部分要求已核验':'已交付部分成果',description:'本轮已结束，原任务尚未全部完成。'+counts};
 return {tone:'incomplete',icon:'!',label:'尚未完成',description:'尚未形成完整交付。'+counts};
}
