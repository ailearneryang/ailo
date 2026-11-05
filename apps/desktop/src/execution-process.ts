// This is the lifecycle of a response/execution turn. Requirement verification,
// delivery success and failures stay in the canonical task record and reply body.
export function replyProcessStatus(status?:string):string {
 return status==='waiting_permission'||status==='waiting_user'?'待输入':'已完成';
}
