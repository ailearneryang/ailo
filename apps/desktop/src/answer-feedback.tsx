import {useState} from 'react';
export type FeedbackDetails={reason?:string;detail?:string;remember?:boolean};
const reasons=[['verbose','太啰嗦'],['brief','太简略'],['disorganized','缺乏条理'],['conclusion','没有明确结论'],['inaccurate','内容不准确'],['offtopic','没有回答问题']];
export function AnswerFeedback({busy,onClose,onSave,canImprove}:{busy:boolean;onClose:()=>void;onSave:(details:FeedbackDetails,improve:boolean)=>Promise<boolean>;canImprove:boolean}){
 const [reason,setReason]=useState('');
 return <div className="answer-feedback-inline" role="group" aria-label="可选的改进建议"><span>已记录，可选填原因</span>{reasons.map(([value,label])=><button key={value} type="button" aria-pressed={reason===value} disabled={busy} onClick={async()=>{const next=reason===value?'':value;if(await onSave({reason:next||undefined,remember:false},false))setReason(next);}}>{label}</button>)}{canImprove&&<button type="button" className="feedback-improve" disabled={busy} onClick={()=>void onSave({reason:reason||undefined,remember:false},true)}>改进回答</button>}<button type="button" aria-label="收起改进建议" disabled={busy} onClick={onClose}>收起</button></div>;
}
