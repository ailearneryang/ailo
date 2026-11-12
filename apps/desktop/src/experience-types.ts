export type ConversationOperation='rename'|'move'|'archive'|'restore'|'delete'|'branch'|'regenerate'|'export';
export type ProjectSource={id:string;name:string;text:string;createdAt:string};
export type DefaultTools={searchEnabled?:boolean;feishuEnabled?:boolean;amapEnabled?:boolean;mcpConnectionIds?:string[]};
export type LibraryFile={id:string;taskId:string;originIndex?:number;path:string;label:string;size:number;sha256?:string;kind:'delivery'|'material';projectId?:string;taskTitle:string;at:string;version:number;archived:boolean;text?:string|null};
export type TaskNotification={id:string;taskId:string;title:string;kind:'attention'|'completed'|'output'|'ended';status:string;message?:string;subject?:string;preview?:string;modelName?:string;durationMs?:number;read:boolean;at:string};
export type NotificationData={settings:{enabled:boolean;native:boolean;completed:boolean;attention:boolean;output:boolean};items:TaskNotification[]};
