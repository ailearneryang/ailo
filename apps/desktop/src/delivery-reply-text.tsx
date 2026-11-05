import React,{useState} from 'react';
import type {AgentRun} from './types';
import {AssistantText} from './assistant-text';
import {pendingOutcomeMessage,isInternalPendingReply} from '../task-outcome.cjs';
import {deliveryStatus} from './delivery-status';
// Older saved replies may still contain hundreds of file/progress lines. Keep
// their original text available, but let the result card own files and status.
export function DeliveryReplyText({content,delivery,currentRun}:{content:string;delivery?:AgentRun;currentRun?:AgentRun}){
 const [open,setOpen]=useState(false);
 const pending=isInternalPendingReply(content)?pendingOutcomeMessage(delivery||currentRun):undefined;
 if(pending)return <AssistantText content={pending}/>;
 if(!delivery)return <AssistantText content={content}/>;
 const fileLines=content.split('\n').filter(line=>/^[\s*-]*.*(?:\/[^\s]+\.(?:kt|java|xml|json|ts|js|py|properties)|(?:gradle|package)\.)/.test(line)).length;
 const lines=content.split(/\r?\n/),diagnosticAt=lines.findIndex(line=>/^(?:原要求检查[：:]|尚未完成或未核验[：:]|仍有 \d+ 项问题待处理|本轮未能解决的问题[：:]|完整要求、问题状态与证据)/.test(line.trim()));
 if(diagnosticAt<0&&fileLines<5)return <AssistantText content={content}/>;
 if(delivery===currentRun&&(!delivery.artifacts?.length||content.length<=1000)&&fileLines<5)return <AssistantText content={content}/>;
 const status=deliveryStatus(delivery),first=(content.split(/\r?\n/).find(line=>line.trim())||'').slice(0,350);
 const lead=diagnosticAt>0?lines.slice(0,diagnosticAt).join('\n').trim():first;
 const summary=status.tone!=='complete'&&/全部完成|全部通过|交付完成|✅/.test(first)?`${status.label}。完整要求及未完成项保留在本轮记录中。`:lead||status.label;
 return <div className="delivery-reply-summary"><AssistantText content={summary}/><details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>查看完整交付说明</summary>{open&&<AssistantText content={content}/>}</details></div>;
}
