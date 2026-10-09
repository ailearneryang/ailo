export type MCPPermission='ask'|'read'|'disabled';
export type MCPTool={name:string;description:string;inputSchema:Record<string,unknown>;readOnly:boolean;permission:MCPPermission;fingerprint:string};
export type MCPConnection={id:string;name:string;description:string;url:string;authType:'none'|'token'|'oauth';headerName:string;clientId:string;hasCredential:boolean;enabled:boolean;connected:boolean;verifiedAt:string|null;error:string;authorizing:boolean;pendingCalls:{id:string;tool:string;purpose:string;params:Record<string,unknown>;at:string}[];tools:MCPTool[]};
export type MCPConnectionInput={id?:string;name:string;description:string;url:string;authType:'none'|'token'|'oauth';headerName?:string;token?:string;clientId?:string};
export type ConnectionTarget='feishu'|'amap'|{mcpId:string};
export type ArtifactPreview={kind:'image'|'text'|'markdown'|'html'|'pdf'|'spreadsheet';content:string;version:string;truncated?:boolean;sheets?:{name:string;cells:{address:string;text:string}[]}[]};
export type ProjectMemoryData={revision:number;notes:string;hiddenTaskIds?:string[];records:{taskId:string;title:string;goal:string;status:string;decisions:unknown[];steps:unknown[];updatedAt?:string}[]};
export type KnowledgeDocument={id:string;name:string;chars:number;chunks:number;createdAt:string};
export type KnowledgeLibrary={id:string;name:string;description:string;createdAt:string;documents:KnowledgeDocument[]};
export type KnowledgeHit={libraryId:string;libraryName:string;documentId:string;name:string;chunk:number;offset:number;end:number;text:string;citation:string};
export type KnowledgePage={libraryId:string;documentId:string;name:string;text:string;offset:number;total:number;next:number|null;citation:string};
export type AMapState={configured:boolean;connected:boolean;verifiedAt:string|null;tools:string[];endpoint:string};
export type ScheduleInput={id?:string;title:string;prompt:string;modelId:string;frequency:'once'|'daily'|'weekly';at?:string;time?:string;weekday?:number;searchEnabled?:boolean;feishuEnabled?:boolean};
export type Schedule=ScheduleInput & {id:string;enabled:boolean;nextAt:string|null;runs:{id:string;taskId:string;at:string;startedAt?:string;status:'queued'|'running'|'completed'|'failed';error?:string}[]};
export type SearchState={configured:boolean;connected:boolean;provider:"baidu"|"tavily";limit:number;used:number;verifiedAt:string|null};
export type FeishuConnectionState = {installed:boolean;enabled:boolean;connected:boolean;configured?:boolean;name?:string;phase:string;url?:string;message:string};
export type ClarificationOption = { id: string; label: string; description?: string; recommended: boolean };
export type ClarificationQuestion = { id: string; kind: "choice" | "attachment"; title: string; description?: string; options?: ClarificationOption[] };
export type Clarification = { title: string; questions: ClarificationQuestion[]; defaults: string[] };
export type ClarificationAnswer = { questionId: string; answer: string };
export type Extension = { id: string; kind: "expert" | "skill"; name: string; description: string; instructions: string; enabled: boolean };
export type Material = {
  sourceId?: string;
  name: string;
  text: string | null;
  size: number;
  summary?: string;
  archive?: { entries: { name: string; status: string }[] };
};
export type ContextCheckpoint = { summary: string; covered: number; fingerprint: string; updatedAt: string };
export type Model = {
  contextWindow?: number;
  maxOutputTokens?: number;
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  hasKey?: boolean;
  apiKey?: string;
};
export type Project = { description?:string; pinned?:boolean; localPath?:string; source?:'local'; id: string; name: string; extensionIds?: string[] };
export type Message = {
  clarification?: Clarification;
  clarificationReplyTo?: string;
  clarificationAnswers?: ClarificationAnswer[];
  id: string;
  role: "user" | "assistant";
  content: string;
  materials?: Material[];
  modelName?: string;
};
export type Task = {
  reasoningEffort?: 'low'|'medium'|'high';
  petReadToken?: string;
  knowledgeIds?:string[];
  scheduledTaskId?: string;
  scheduledRunId?: string;
  scheduledAt?: string;
  scheduledArchived?: boolean;
  parentAssistantId?: string;
  parentMessageId?: string;
  assistantPaused?: boolean;
  assistantReferences?: Record<string, string[]>;
  assistantScheduleLinks?: {messageId: string; id: string; title: string}[];
  agentRun?: AgentRun;
  contextCheckpoint?: ContextCheckpoint;
  promptTokens?: number;
  extensionIds?: string[];
  feishuEnabled?: boolean;
  amapEnabled?: boolean;
  mcpConnectionIds?: string[];
  searchEnabled?: boolean;
  messages?: Message[];
  lastError?: string;
  partialReply?: string;
  id: string;
  title: string;
  request: string;
  answer?: string;
  materials: Material[];
  created: string;
  projectId?: string;
  modelId?: string;
  modelName?: string;
};
export type RequestContextUsage = {
  requestId: string; at: string; completedAt?: string; modelId?: string; modelName?: string;
  status: 'sending' | 'completed' | 'failed'; capacityConfigured: boolean;
  rows: {label:string;color:string;tokens:number}[];
  used:number;window:number;reserve:number;ratio:number;threshold:number;
  providerUsage?: {inputTokens?:number;outputTokens?:number;reasoningTokens?:number};
};
export type AgentRun = {
  executionId?: string;
  afterMessageId?: string;
  progressInputId?: string;
  history?: AgentRun[];
  inFlight?: {action:string;path?:string;purpose?:string;name?:string;entry?:string;at:string};
  contextUsage?: RequestContextUsage;
  status: string; mode: 'chat' | 'task'; goal: string;
  steps: {id:string;title:string;status:string}[];
  decisions: string[]; acceptance: string[];
  artifacts: {path:string;label:string;size:number;sha256:string}[];
  events: {id:string;type:string;at:string;detail:{purpose?:string;exitCode?:number;path?:string;name?:string;entry?:string;offset?:number;message?:string;output?:string}}[];
  updatedAt?: string;
};
export type Workspace = {
  extensions: Extension[];
  tasks: Task[];
  projects: Project[];
  models: Model[];
  defaultModelId: string;
};
export type User = { id: string; name: string; email: string };
export const demoModel: Model = {
  id: "demo",
  name: "选择模型",
  model: "demo",
  baseUrl: "",
};
export const emptyWorkspace: Workspace = {
  extensions: [],
  tasks: [],
  projects: [],
  models: [],
  defaultModelId: "demo",
};
declare global {
  interface Window {
    ailo: {
      projectMemory:(id:string)=>Promise<ProjectMemoryData>;
      saveProjectMemory:(id:string,input:{notes:string;revision:number;hiddenTaskIds?:string[]})=>Promise<unknown>;
      schedulesList:()=>Promise<Schedule[]>;
      schedulesSave:(input:ScheduleInput)=>Promise<Schedule>;
      schedulesToggle:(input:{id:string;enabled:boolean})=>Promise<void>;
      schedulesRemove:(id:string)=>Promise<void>;
      schedulesRun:(id:string)=>Promise<void>;
      openLocalProject:()=>Promise<Project|null>;
      feishuCliPermissions:()=>Promise<void>;
      removeProject:(id:string)=>Promise<boolean>;
      openProjectFolder:(id:string)=>Promise<void>;
      openWeb:(url:string)=>Promise<void>;
      knowledgeList:()=>Promise<KnowledgeLibrary[]>;
      knowledgeSave:(input:{id?:string;name:string;description:string})=>Promise<KnowledgeLibrary>;
      knowledgeImport:(id:string)=>Promise<{name:string;status:string;error?:string;notice?:string}[]>;
      knowledgeRemove:(id:string)=>Promise<boolean>;
      knowledgeRemoveDocument:(input:{libraryId:string;documentId:string})=>Promise<void>;
      knowledgeSearch:(input:{libraryIds:string[];query:string})=>Promise<{hits:KnowledgeHit[];notice:string}>;
      knowledgeRead:(input:{libraryId:string;documentId:string;offset?:number})=>Promise<KnowledgePage>;
      mcpList:()=>Promise<MCPConnection[]>;
      mcpSave:(input:MCPConnectionInput)=>Promise<MCPConnection>;
      mcpTest:(id:string)=>Promise<MCPConnection>;
      mcpAuthorize:(id:string)=>Promise<MCPConnection>;
      mcpDisconnect:(id:string)=>Promise<MCPConnection>;
      mcpRemove:(id:string)=>Promise<void>;
      mcpResolveCall:(input:{id:string;callId:string})=>Promise<MCPConnection>;
      mcpPermissions:(input:{id:string;permissions:Record<string,MCPPermission>})=>Promise<MCPConnection>;
      amapStatus:()=>Promise<AMapState>;
      amapSave:(input:{key:string})=>Promise<AMapState>;
      amapTest:()=>Promise<AMapState>;
      amapDisconnect:()=>Promise<AMapState>;
      searchStatus:()=>Promise<SearchState>;
      searchSave:(input:{provider:string;key:string;limit:number})=>Promise<SearchState>;
      searchTest:()=>Promise<SearchState>;
      searchDisconnect:()=>Promise<SearchState>;
      feishuCliStatus:()=>Promise<FeishuConnectionState>;
      feishuCliConnect:(input?:{scopes?:string})=>Promise<FeishuConnectionState>;
      feishuCliDisconnect:()=>Promise<FeishuConnectionState>;
      feishuCliAuthorize:()=>Promise<void>;
      feishuCliInstallGuide:()=>Promise<void>;
      feishuStatus:()=>Promise<{configured:boolean;appId:string}>;
      feishuSave:(input:{appId:string;secret:string})=>Promise<{configured:boolean;appId:string}>;
      feishuTest:()=>Promise<{ok:boolean}>;
      feishuDisconnect:()=>Promise<{configured:boolean;appId:string}>;
      feishuRead:(url:string)=>Promise<Material>;
      feishuGuide:()=>Promise<void>;
      complete: (input: {
        knowledgeIds?:string[];
        id: string;
        modelId: string;
        reasoningEffort?: 'low'|'medium'|'high';
        taskId?: string;
        contextCheckpoint?: ContextCheckpoint;
        extensionIds?: string[];
  feishuEnabled?: boolean;
  amapEnabled?: boolean;
  mcpConnectionIds?: string[];
  searchEnabled?: boolean;
        messages: { role: "user" | "assistant"; content: string }[];
      }) => Promise<{ content: string; clarification?: Clarification; modelName: string; contextCheckpoint?: ContextCheckpoint; promptTokens?: number }>;
      onChatStatus: (callback: (status: { id: string; message?: string; content?: string; taskId?:string; finished?:boolean; run?:AgentRun }) => void) => () => void;
      cancel: (id: string) => Promise<void>;
      sessions: () => Promise<{id:string;taskId:string;status:string;content:string;updatedAt?:string}[]>;
      editLastMessage: (id:string,messageId:string,content:string) => Promise<Task>;
      patchTask: (id:string,patch:Partial<Task>,append?:Message[]) => Promise<Task>;
      steer: (input:{id:string;taskId:string;content:string}) => Promise<Message>;
      projectFiles: (taskId:string) => Promise<{files:{path:string;label:string;size:number;sha256:string}[];truncated:boolean}>;
      reveal: (taskId:string, artifactPath?:string, projectFile?:boolean) => Promise<void>;
      editArtifact:(taskId:string,path:string,input:{version:string;operation?:string;text?:string;sheet?:string;address?:string})=>Promise<ArtifactPreview>;
      preview: (taskId:string, artifactPath:string, projectFile?:boolean) => Promise<ArtifactPreview>;
      read: () => Promise<Workspace>;
      save: (state: Workspace) => Promise<void>;
      pasteFiles: (entries: { name: string; bytes: Uint8Array }[]) => Promise<Material[]>;
      pick: () => Promise<Material[]>;
      account: () => Promise<User | null>;
      register: (credentials: {
        name: string;
        email: string;
        password: string;
      }) => Promise<User>;
      login: (credentials: {
        email: string;
        password: string;
      }) => Promise<User>;
      logout: () => Promise<void>;
    };
  }
}
