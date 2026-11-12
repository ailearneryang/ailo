import type {Message} from './types';
// Hide only a structured answer that is completely represented by its source card.
// Keep the original transcript intact for execution, recovery, exports and search.
export function inlineAnswerFor(source:Message,messages:Message[]){
 if(source.role!=='assistant'||!source.clarification?.questions.length)return undefined;
 return [...messages].reverse().find(reply=>reply.role==='user'&&reply.clarificationReplyTo===source.id&&source.clarification!.questions.every(q=>reply.clarificationAnswers?.some(a=>a.questionId===q.id&&a.answer.trim())));
}
export function isInlineAnswer(message:Message,messages:Message[]){
 if(message.role!=='user'||!message.clarificationReplyTo)return false;
 const source=messages.find(m=>m.id===message.clarificationReplyTo);
 return !!source&&inlineAnswerFor(source,messages)?.id===message.id;
}
