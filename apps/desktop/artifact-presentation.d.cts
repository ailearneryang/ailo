export type PresentationFile={path:string;label?:string};
export function isDevelopment(file:PresentationFile):boolean;
export function sourceRequested(request?:string):boolean;
export function previewRank(file:PresentationFile):number;
export function groupArtifacts<T extends PresentationFile>(files:T[],options?:{request?:string;changedPaths?:string[]}):{primary:T[];development:T[];current:T[];shown:T[];featured?:T;retained:boolean;sourceRequested:boolean};
export function summaryLines<T extends PresentationFile>(files:T[],options?:{request?:string;changedPaths?:string[];max?:number}):string[];
